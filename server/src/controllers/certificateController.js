import pdfkit from 'pdfkit';
import fs from 'fs';
import path from 'path';
import prisma from '../config/database.js';
import { ok, fail } from '../utils/response.js';
import { audit } from '../utils/audit.js';
import { hasCompletedCourseRequirements } from '../utils/certificateEligibility.js';
import { studentCourseAccessWhere, studentProgramCourseWhere } from '../utils/courseAccess.js';
import { assessmentCompletionFilter, getScoreableAssessmentIds } from '../utils/assessmentCompletion.js';
import { assessmentOfferingForStudentWhere } from '../utils/assessmentAccess.js';
import { getObjectStorage, isObjectStorageEnabled } from '../services/objectStorage.js';

const isEligible = async (studentId, courseId) => {
  const course = await prisma.course.findFirst({
    where: {
      id: courseId,
      ...studentCourseAccessWhere(studentId),
    },
    select: {
      id: true,
      title: true,
      completionRequirements: true,
      modules: {
        select: {
          lessons: {
            where: { isPublished: true },
            select: { id: true },
          },
        },
      },
      assessments: {
        where: {
          AND: [
            assessmentCompletionFilter,
            assessmentOfferingForStudentWhere(studentId),
          ],
        },
        select: { id: true, passMarkPercent: true, type: true, resultsReleased: true },
      },
    },
  });
  if (!course) return null;

  const lessonIds = course.modules.flatMap(({ lessons }) => lessons.map(({ id }) => id));
  let completionSettings = {};
  try {
    completionSettings = JSON.parse(course.completionRequirements || '{}');
  } catch {
    completionSettings = {};
  }
  const minimumLessonCompletionPercent = Number.isInteger(completionSettings.minimumLessonCompletionPercent)
    && completionSettings.minimumLessonCompletionPercent >= 1
    && completionSettings.minimumLessonCompletionPercent <= 100
    ? completionSettings.minimumLessonCompletionPercent
    : 100;
  const requireAssessment = completionSettings.requireAssessment === true;
  const assessmentPassMarks = new Map(course.assessments.map(({ id, passMarkPercent }) => [id, passMarkPercent]));
  const assessmentIds = requireAssessment ? [...assessmentPassMarks.keys()] : [];
  const scoreableAssessmentIds = requireAssessment ? getScoreableAssessmentIds(course.assessments) : [];
  const [completedLessons, attempts] = await Promise.all([
    prisma.lessonProgress.count({
      where: { studentId, lessonId: { in: lessonIds }, completed: true },
    }),
    assessmentIds.length
      ? prisma.assessmentAttempt.findMany({
        where: {
          studentId,
          assessmentId: { in: scoreableAssessmentIds },
          submittedAt: { not: null },
          status: 'GRADED',
          score: { not: null },
          maxScore: { gt: 0 },
        },
        select: { assessmentId: true, score: true, maxScore: true },
      })
      : [],
  ]);
  const passedAssessments = new Set(attempts
    .filter((attempt) => (attempt.score / attempt.maxScore) * 100
      >= assessmentPassMarks.get(attempt.assessmentId))
    .map(({ assessmentId }) => assessmentId));
  if (!hasCompletedCourseRequirements({
    lessonCount: lessonIds.length,
    completedLessonCount: completedLessons,
    assessmentCount: assessmentIds.length,
    submittedAssessmentCount: passedAssessments.size,
    minimumLessonCompletionPercent,
    requireAssessment,
  })) return null;
  return course;
};

export const createCertificate = async (req, res) => {
  const { studentId } = req.body || {};
  if (typeof studentId !== 'string' || !studentId.trim()) return fail(res, 'studentId is required', 400);
  const { courseId } = req.params;

  const course = await isEligible(studentId, courseId);
  if (!course) return fail(res, 'Student has not completed all published lessons and assessments for this course', 403);

  const existingCertificate = await prisma.certificate.findFirst({
    where: { studentId, courseId },
  });
  if (existingCertificate) return fail(res, 'Certificate already issued for this student and course', 409);

  const student = await prisma.user.findUnique({ where: { id: studentId }, include: { role: true } });
  if (!student || student.role.name !== 'STUDENT') return fail(res, 'Student not found', 404);

  const fileName = `certificate-${studentId}-${Date.now()}.pdf`;
  const doc = pdfkit({ margin: 50 });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const pdfBuffer = await new Promise((resolve, reject) => {
    doc.once('end', () => resolve(Buffer.concat(chunks)));
    doc.once('error', reject);
    doc.fontSize(20).text('REO TRAVEL ACADEMY');
    doc.fontSize(14).text('Certificate of Completion', { align: 'center' });
    doc.fontSize(12).text('This is to certify that', { align: 'center' });
    doc.fontSize(12).text(`${student.firstName} ${student.lastName}`, { align: 'center' });
    doc.fontSize(12).text(`has completed ${course.title}.`, { align: 'center' });
    doc.fontSize(12).text(`Date: ${new Date().toLocaleDateString()}`, { align: 'center' });
    doc.fontSize(12).text('REO Travel Academy', { align: 'center' });
    doc.end();
  });

  const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads');
  const filePath = path.join(uploadDir, fileName);
  const storageKey = `certificates/${studentId}/${fileName}`;
  if (isObjectStorageEnabled()) {
    await getObjectStorage().putObject({
      key: storageKey,
      body: pdfBuffer,
      contentType: 'application/pdf',
    });
  } else {
    await fs.promises.mkdir(uploadDir, { recursive: true });
    await fs.promises.writeFile(filePath, pdfBuffer);
  }

  const fileUrl = `/api/courses/certificates/download/${fileName}`;
  let certificate;
  try {
    certificate = await prisma.certificate.create({
      data: {
        studentId,
        courseId,
        title: `Certificate of Completion for ${course.title}`,
        issuedAt: new Date(),
        fileUrl,
      },
    });
  } catch (error) {
    if (error.code === 'P2002') {
      if (isObjectStorageEnabled()) await getObjectStorage().deleteObject(storageKey);
      else await fs.promises.unlink(filePath);
      return fail(res, 'Certificate already issued for this student and course', 409);
    }
    if (isObjectStorageEnabled()) {
      try {
        await getObjectStorage().deleteObject(storageKey);
      } catch (cleanupError) {
        console.error('Could not remove unreferenced certificate file', cleanupError);
      }
    } else {
      await fs.promises.unlink(filePath);
    }
    throw error;
  }
  await audit({ actorId: req.user.id, action: 'CREATE_CERTIFICATE', entity: 'Certificate', entityId: certificate.id, ipAddress: req.ip });
  return ok(res, certificate, 'Certificate generated', 201);
};

export const listCertificates = async (req, res) => {
  if (!['SUPER_ADMIN', 'STUDENT'].includes(req.user.role.name)) return fail(res, 'Forbidden', 403);
  const certificates = await prisma.certificate.findMany({
    where: req.user.role.name === 'STUDENT'
      ? {
        studentId: req.user.id,
        course: { is: studentProgramCourseWhere(req.user.id) },
      }
      : undefined,
    orderBy: { issuedAt: 'desc' }
  })
  return ok(res, certificates)
}

export const downloadCertificate = async (req, res) => {
  if (!['SUPER_ADMIN', 'STUDENT'].includes(req.user.role.name)) return fail(res, 'Forbidden', 403);
  const { fileName } = req.params
  if (!/^certificate-[A-Za-z0-9_-]+-\d+\.pdf$/.test(fileName)) return fail(res, 'Certificate not found', 404);
  const certificate = await prisma.certificate.findFirst({
    where: {
      fileUrl: { endsWith: fileName },
      ...(req.user.role.name === 'STUDENT'
        ? {
          studentId: req.user.id,
          course: { is: studentProgramCourseWhere(req.user.id) },
        }
        : {}),
    },
    select: { id: true, studentId: true },
  });
  if (!certificate) return fail(res, 'Certificate not found', 404);
  if (isObjectStorageEnabled()) {
    const url = await getObjectStorage().createDownloadUrl({
      key: `certificates/${certificate.studentId}/${fileName}`,
      fileName,
      contentType: 'application/pdf',
    });
    return res.redirect(302, url);
  }
  const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads')
  const filePath = path.resolve(uploadDir, fileName)
  if (path.dirname(filePath) !== uploadDir) return fail(res, 'Certificate not found', 404);

  if (!fs.existsSync(filePath)) return fail(res, 'Certificate not found', 404)

  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="${fileName}"`)
  fs.createReadStream(filePath).pipe(res)
}
