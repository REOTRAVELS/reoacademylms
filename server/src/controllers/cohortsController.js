import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import prisma from '../config/database.js';
import { env } from '../config/env.js';
import { ok, fail } from '../utils/response.js';
import { audit } from '../utils/audit.js';
import { revalidateLiveClassAccess } from '../services/liveClassRealtime.js';
import { ensureGeneratedOrdinaryClasses } from '../services/cohortTimetable.js';
import { parseCohortSchedule } from '../utils/liveClassScheduling.js';
import { getObjectStorage, isObjectStorageEnabled } from '../services/objectStorage.js';
import { hasAllowedUploadType, resourceFileMatchesType } from '../utils/uploadValidation.js';
import { activeProgramCohortForStudent } from '../utils/courseAccess.js';

const timetableFileTypes = new Map([
  ['.pdf', ['application/pdf']],
  ['.doc', ['application/msword']],
  ['.docx', ['application/vnd.openxmlformats-officedocument.wordprocessingml.document']],
  ['.ppt', ['application/vnd.ms-powerpoint']],
  ['.pptx', ['application/vnd.openxmlformats-officedocument.presentationml.presentation']],
  ['.xls', ['application/vnd.ms-excel']],
  ['.xlsx', ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']],
  ['.csv', ['text/csv', 'application/vnd.ms-excel']],
]);

const timetableUploadDetails = (body = {}) => {
  const originalName = path.posix.basename(String(body.originalName || '').replace(/\\/g, '/')).trim();
  const mimeType = body.mimeType;
  const sizeBytes = Number(body.sizeBytes);
  if (
    !originalName
    || originalName.length > 255
    || /[\u0000-\u001f\u007f]/.test(originalName)
    || typeof mimeType !== 'string'
    || !hasAllowedUploadType(timetableFileTypes, originalName, mimeType)
  ) return { error: 'Choose a PDF, Word, PowerPoint, or Excel timetable file', status: 400 };
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > env.maxFileSizeMb * 1024 * 1024) {
    return { error: `File must be no larger than ${env.maxFileSizeMb} MB`, status: 413 };
  }
  return { originalName, mimeType, sizeBytes };
};

const readTimetableFileHeader = (filePath) => {
  const descriptor = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(16);
    const bytesRead = fs.readSync(descriptor, header, 0, header.length, 0);
    return header.subarray(0, bytesRead);
  } finally {
    fs.closeSync(descriptor);
  }
};

const canManageCohort = async (cohortId, user) => {
  if (user.role.name === 'SUPER_ADMIN') return true;
  if (user.role.name !== 'TRAINER') return false;
  const cohort = await prisma.cohort.findFirst({
    where: {
      id: cohortId,
      OR: [
        { trainers: { some: { trainerId: user.id } } },
        { courses: { some: { course: { trainers: { some: { trainerId: user.id } } } } } },
      ],
    },
    select: { id: true },
  });
  return Boolean(cohort);
};

const canAccessCohortTimetable = async (cohortId, user) => {
  if (user.role.name === 'SUPER_ADMIN') return true;
  if (user.role.name === 'TRAINER') return canManageCohort(cohortId, user);
  if (user.role.name !== 'STUDENT') return false;
  const cohort = await prisma.cohort.findFirst({
    where: { id: cohortId, ...activeProgramCohortForStudent(user.id) },
    select: { id: true },
  });
  return Boolean(cohort);
};

const cleanupTimetableFile = async (storagePath) => {
  if (!storagePath) return;
  if (storagePath.startsWith('cohort-timetables/')) {
    if (isObjectStorageEnabled()) await getObjectStorage().deleteObject(storagePath);
  } else if (fs.existsSync(storagePath)) {
    fs.unlinkSync(storagePath);
  }
};

const replaceCohortTimetable = async (cohortId, file, req) => {
  const previous = await prisma.cohort.findUnique({
    where: { id: cohortId },
    select: { timetableStoragePath: true },
  });
  if (!previous) return null;
  const updated = await prisma.cohort.update({
    where: { id: cohortId },
    data: {
      timetableFileName: file.originalName,
      timetableMimeType: file.mimeType,
      timetableStoragePath: file.storagePath,
      timetableSizeBytes: file.sizeBytes,
    },
    select: {
      id: true,
      timetableFileName: true,
      timetableMimeType: true,
      timetableSizeBytes: true,
    },
  });
  if (previous.timetableStoragePath && previous.timetableStoragePath !== file.storagePath) {
    try {
      await cleanupTimetableFile(previous.timetableStoragePath);
    } catch (error) {
      console.error('Could not remove the replaced cohort timetable file', error);
    }
  }
  await audit({
    actorId: req.user.id,
    action: 'UPLOAD_COHORT_TIMETABLE',
    entity: 'Cohort',
    entityId: cohortId,
    ipAddress: req.ip,
  });
  return updated;
};

const cohortIncludes = {
  programme: true,
  intakeProgramOffering: {
    include: {
      intake: { select: { id: true, gateNumber: true, season: true, year: true, timezone: true } },
    },
  },
};

const withoutTimetableStoragePath = (cohort) => {
  const publicCohort = { ...cohort };
  delete publicCohort.timetableStoragePath;
  return publicCohort;
};

export const listCohorts = async (req, res) => {
  const where = {};
  if (req.query.programmeId) where.programmeId = req.query.programmeId;
  if (req.user.role.name === 'TRAINER') {
    where.OR = [
      { trainers: { some: { trainerId: req.user.id } } },
      { courses: { some: { course: { trainers: { some: { trainerId: req.user.id } } } } } },
    ];
  }
  const items = await prisma.cohort.findMany({
    where,
    include: { ...cohortIncludes, _count: { select: { enrolments: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return ok(res, items.map(withoutTimetableStoragePath));
};

export const getCohort = async (req, res) => {
  const where = { id: req.params.id };
  if (req.user.role.name === 'TRAINER') {
    where.OR = [
      { trainers: { some: { trainerId: req.user.id } } },
      { courses: { some: { course: { trainers: { some: { trainerId: req.user.id } } } } } },
    ];
  }
  const c = await prisma.cohort.findFirst({
    where,
    include: {
      ...cohortIncludes,
      enrolments: {
        include: {
          student: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, status: true } },
        },
      },
      courses: { include: { course: true } },
      trainers: {
        include: {
          trainer: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, status: true } },
        },
      },
    },
  });
  if (!c) return fail(res, 'Not found', 404);
  return ok(res, withoutTimetableStoragePath(c));
};

export const createCohortTimetableUploadIntent = async (req, res) => {
  const details = timetableUploadDetails(req.body);
  if (details.error) return fail(res, details.error, details.status);
  const cohort = await prisma.cohort.findUnique({
    where: { id: req.params.id },
    select: { id: true },
  });
  if (!cohort) return fail(res, 'Cohort not found', 404);
  if (!(await canManageCohort(cohort.id, req.user))) return fail(res, 'You are not assigned to this cohort', 403);
  if (!isObjectStorageEnabled()) return ok(res, { mode: 'local' });

  const extension = path.extname(details.originalName).toLowerCase();
  const storageKey = `cohort-timetables/${req.user.id}/${randomUUID()}${extension}`;
  const intent = await getObjectStorage().createUploadIntent({
    key: storageKey,
    contentType: details.mimeType,
    ownerId: req.user.id,
    sizeBytes: details.sizeBytes,
  });
  return ok(res, { mode: 's3', storageKey, ...intent });
};

export const uploadCohortTimetable = async (req, res) => {
  if (req.is('application/json')) {
    if (!isObjectStorageEnabled()) return fail(res, 'Object storage uploads are unavailable', 503);
    const details = timetableUploadDetails(req.body);
    if (details.error) return fail(res, details.error, details.status);
    if (!(await canManageCohort(req.params.id, req.user))) {
      return fail(res, 'You are not assigned to this cohort', 403);
    }

    const { storageKey } = req.body;
    if (typeof storageKey !== 'string') return fail(res, 'Upload key is invalid', 400);
    const keyParts = storageKey.split('/');
    const extension = path.extname(details.originalName).toLowerCase();
    if (
      keyParts.length !== 3
      || keyParts[0] !== 'cohort-timetables'
      || keyParts[1] !== req.user.id
      || path.extname(keyParts[2]).toLowerCase() !== extension
      || !/^[0-9a-f-]{36}\.[a-z0-9]+$/i.test(keyParts[2])
    ) return fail(res, 'Upload key is invalid', 400);

    const storage = getObjectStorage();
    let header;
    try {
      header = await storage.verifyUpload({
        key: storageKey,
        contentType: details.mimeType,
        ownerId: req.user.id,
        sizeBytes: details.sizeBytes,
      });
    } catch (error) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return fail(res, 'Upload was not found or has expired', 400);
      }
      throw error;
    }
    if (!header || !resourceFileMatchesType(header, details.originalName, details.mimeType)) {
      await storage.deleteObject(storageKey);
      return fail(res, 'Uploaded file content does not match its file type', 400);
    }
    try {
      const timetable = await replaceCohortTimetable(req.params.id, {
        ...details,
        storagePath: storageKey,
      }, req);
      if (!timetable) {
        await storage.deleteObject(storageKey);
        return fail(res, 'Cohort not found', 404);
      }
      return ok(res, timetable, 'Timetable uploaded', 201);
    } catch (error) {
      try {
        await storage.deleteObject(storageKey);
      } catch (cleanupError) {
        console.error('Could not remove unreferenced cohort timetable upload', cleanupError);
      }
      throw error;
    }
  }

  if (!req.file) return fail(res, 'No timetable file uploaded', 400);
  const details = {
    originalName: path.posix.basename(req.file.originalname.replace(/\\/g, '/')).trim(),
    mimeType: req.file.mimetype,
    sizeBytes: req.file.size,
  };
  if (
    !hasAllowedUploadType(timetableFileTypes, details.originalName, details.mimeType)
    || !resourceFileMatchesType(readTimetableFileHeader(req.file.path), details.originalName, details.mimeType)
  ) {
    fs.unlinkSync(req.file.path);
    return fail(res, 'Choose a supported timetable file with matching file contents', 400);
  }
  if (!(await canManageCohort(req.params.id, req.user))) {
    fs.unlinkSync(req.file.path);
    return fail(res, 'You are not assigned to this cohort', 403);
  }
  let timetable;
  try {
    timetable = await replaceCohortTimetable(req.params.id, {
      ...details,
      storagePath: req.file.path,
    }, req);
  } catch (error) {
    try {
      fs.unlinkSync(req.file.path);
    } catch (cleanupError) {
      console.error('Could not remove unreferenced cohort timetable upload', cleanupError);
    }
    throw error;
  }
  if (!timetable) {
    fs.unlinkSync(req.file.path);
    return fail(res, 'Cohort not found', 404);
  }
  return ok(res, timetable, 'Timetable uploaded', 201);
};

export const downloadCohortTimetable = async (req, res) => {
  const cohort = await prisma.cohort.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      timetableFileName: true,
      timetableMimeType: true,
      timetableStoragePath: true,
    },
  });
  if (!cohort?.timetableStoragePath || !(await canAccessCohortTimetable(req.params.id, req.user))) {
    return fail(res, 'Timetable not found', 404);
  }
  if (cohort.timetableStoragePath.startsWith('cohort-timetables/')) {
    const url = await getObjectStorage().createDownloadUrl({
      key: cohort.timetableStoragePath,
      fileName: cohort.timetableFileName,
      contentType: cohort.timetableMimeType,
    });
    return res.redirect(302, url);
  }
  const filePath = path.resolve(cohort.timetableStoragePath);
  if (!fs.existsSync(filePath)) return fail(res, 'Timetable file missing', 404);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', cohort.timetableMimeType);
  return res.download(filePath, path.basename(cohort.timetableFileName));
};

export const createCohort = async (req, res) => {
  const { name, programmeId, intakeProgramOfferingId, startDate, endDate, status, schedule } = req.body || {};
  const parsedSchedule = parseCohortSchedule(schedule);
  if (schedule && (!parsedSchedule.days.length || parsedSchedule.startMinutes === null)) {
    return fail(res, 'Choose at least one weekday and a valid class start time for the timetable.', 400);
  }
  if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
    return fail(res, 'The timetable end date must be on or after its start date.', 400);
  }
  if (intakeProgramOfferingId) {
    const offering = await prisma.intakeProgramOffering.findFirst({
      where: {
        id: intakeProgramOfferingId,
        programmeId,
        status: 'ACTIVE',
        programme: { status: { not: 'ARCHIVED' } },
        intake: { status: { notIn: ['COMPLETED', 'ARCHIVED'] } },
      },
      select: { id: true },
    });
    if (!offering) return fail(res, 'Choose an active offering for the selected programme.', 400);
  }
  const c = await prisma.cohort.create({
    data: {
      name,
      programmeId,
      intakeProgramOfferingId: intakeProgramOfferingId || null,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      status: status || 'PLANNED',
      schedule,
    },
    include: cohortIncludes,
  });
  if (schedule) await ensureGeneratedOrdinaryClasses(prisma, c.id);
  await audit({ actorId: req.user.id, action: 'CREATE_COHORT', entity: 'Cohort', entityId: c.id, ipAddress: req.ip });
  return ok(res, withoutTimetableStoragePath(c), 'Created', 201);
};

export const updateCohort = async (req, res) => {
  const { name, startDate, endDate, status, schedule, intakeProgramOfferingId } = req.body || {};
  const parsedSchedule = parseCohortSchedule(schedule);
  if (schedule && (!parsedSchedule.days.length || parsedSchedule.startMinutes === null)) {
    return fail(res, 'Choose at least one weekday and a valid class start time for the timetable.', 400);
  }
  const current = await prisma.cohort.findUnique({
    where: { id: req.params.id },
    select: { id: true, programmeId: true, startDate: true, endDate: true, schedule: true },
  });
  if (!current) return fail(res, 'Cohort not found', 404);
  const data = {};
  if (name) data.name = name;
  if (startDate !== undefined) data.startDate = startDate ? new Date(startDate) : null;
  if (endDate !== undefined) data.endDate = endDate ? new Date(endDate) : null;
  const nextStartDate = startDate === undefined ? current.startDate : startDate ? new Date(startDate) : null;
  const nextEndDate = endDate === undefined ? current.endDate : endDate ? new Date(endDate) : null;
  if (nextStartDate && nextEndDate && nextStartDate > nextEndDate) {
    return fail(res, 'The timetable end date must be on or after its start date.', 400);
  }
  if (status) data.status = status;
  if (schedule !== undefined) data.schedule = schedule;
  if (intakeProgramOfferingId !== undefined) {
    if (intakeProgramOfferingId === null || intakeProgramOfferingId === '') {
      data.intakeProgramOfferingId = null;
    } else {
      if (typeof intakeProgramOfferingId !== 'string' || intakeProgramOfferingId.trim() !== intakeProgramOfferingId) {
        return fail(res, 'Choose a valid Program Offering for this cohort', 400);
      }
      const offering = await prisma.intakeProgramOffering.findFirst({
        where: {
          id: intakeProgramOfferingId,
          programmeId: current.programmeId,
          status: 'ACTIVE',
          programme: { status: 'ACTIVE' },
          intake: { status: { in: ['UPCOMING', 'ACTIVE'] } },
        },
        select: { id: true },
      });
      if (!offering) return fail(res, 'Choose an active offering for this cohort’s Program', 400);
      data.intakeProgramOfferingId = offering.id;
    }
  }
  if (!Object.keys(data).length) return ok(res, null, 'No cohort changes were provided');
  const c = await prisma.cohort.update({ where: { id: req.params.id }, data });
  if (
    schedule !== undefined
    || startDate !== undefined
    || endDate !== undefined
    || status !== undefined
    || (intakeProgramOfferingId !== undefined && current.schedule)
  ) {
    await ensureGeneratedOrdinaryClasses(prisma, c.id);
  }
  await audit({ actorId: req.user.id, action: 'UPDATE_COHORT', entity: 'Cohort', entityId: c.id, ipAddress: req.ip });
  await revalidateLiveClassAccess();
  return ok(res, withoutTimetableStoragePath(c), 'Updated');
};

export const deleteCohort = async (req, res) => {
  const cohort = await prisma.cohort.findUnique({
    where: { id: req.params.id },
    select: { id: true, timetableStoragePath: true },
  });
  if (!cohort) return fail(res, 'Cohort not found', 404);
  await prisma.cohort.delete({ where: { id: cohort.id } });
  try {
    await cleanupTimetableFile(cohort.timetableStoragePath);
  } catch (error) {
    console.error('Could not remove timetable file for deleted cohort', error);
  }
  await audit({ actorId: req.user.id, action: 'DELETE_COHORT', entity: 'Cohort', entityId: cohort.id, ipAddress: req.ip });
  await revalidateLiveClassAccess();
  return ok(res, null, 'Deleted');
};

export const enrolStudent = async (req, res) => {
  const { studentId } = req.body || {};
  if (typeof studentId !== 'string' || !studentId.trim()) return fail(res, 'studentId is required', 400);
  const [cohort, student] = await Promise.all([
    prisma.cohort.findUnique({
      where: { id: req.params.id },
      select: { id: true, programmeId: true, intakeProgramOfferingId: true },
    }),
    prisma.user.findUnique({
      where: { id: studentId },
      include: { role: { select: { name: true } } },
    }),
  ]);
  if (!cohort) return fail(res, 'Cohort not found', 404);
  if (!student || student.role.name !== 'STUDENT' || student.status !== 'ACTIVE') {
    return fail(res, 'Choose an active student account', 400);
  }
  const matchingEnrollment = await prisma.programEnrollment.findFirst({
    where: {
      studentId,
      status: 'ACTIVE',
      programmeId: cohort.programmeId,
      ...(cohort.intakeProgramOfferingId ? { programOfferingId: cohort.intakeProgramOfferingId } : {}),
    },
    select: { id: true },
  });
  if (!matchingEnrollment) {
    return fail(res, 'The student must have an active enrollment in this cohort’s Program first', 409);
  }
  const e = await prisma.enrolment.create({ data: { studentId, cohortId: req.params.id } });
  await audit({ actorId: req.user.id, action: 'ENROL_STUDENT', entity: 'Enrolment', entityId: e.id, ipAddress: req.ip });
  return ok(res, e, 'Enrolled', 201);
};

export const removeEnrolment = async (req, res) => {
  await prisma.enrolment.delete({ where: { id: req.params.enrolmentId } });
  await revalidateLiveClassAccess();
  return ok(res, null, 'Removed');
};

export const assignTrainer = async (req, res) => {
  const { trainerId } = req.body || {};
  const t = await prisma.cohortTrainer.create({ data: { cohortId: req.params.id, trainerId } });
  return ok(res, t, 'Assigned', 201);
};

export const removeTrainer = async (req, res) => {
  const assignment = await prisma.cohortTrainer.findFirst({
    where: { id: req.params.assignmentId, cohortId: req.params.id },
    select: { id: true },
  });
  if (!assignment) return fail(res, 'Trainer assignment not found', 404);
  await prisma.cohortTrainer.delete({ where: { id: assignment.id } });
  await revalidateLiveClassAccess();
  return ok(res, null, 'Trainer unassigned');
};

export const assignCourse = async (req, res) => {
  const { courseId } = req.body || {};
  const c = await prisma.cohortCourse.create({ data: { cohortId: req.params.id, courseId } });
  await ensureGeneratedOrdinaryClasses(prisma, req.params.id);
  return ok(res, c, 'Assigned', 201);
};

export const removeCourse = async (req, res) => {
  const assignment = await prisma.cohortCourse.findFirst({
    where: { id: req.params.assignmentId, cohortId: req.params.id },
    select: { id: true },
  });
  if (!assignment) return fail(res, 'Course assignment not found', 404);
  await prisma.cohortCourse.delete({ where: { id: assignment.id } });
  await ensureGeneratedOrdinaryClasses(prisma, req.params.id);
  return ok(res, null, 'Course unassigned');
};
