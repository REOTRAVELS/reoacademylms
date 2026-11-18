import prisma from '../config/database.js';
import { ok, fail } from '../utils/response.js';
import { audit } from '../utils/audit.js';
import { AdmissionsError, createApplication, listOpenOfferings } from '../services/admissions.js';
import { getStudentIntakeAccess } from '../utils/intakeAccess.js';

const offeringInclude = {
  programme: { select: { id: true, title: true, qualificationType: true } },
  intake: {
    select: {
      id: true,
      gateNumber: true,
      season: true,
      year: true,
      timezone: true,
    },
  },
};

const applicationInclude = {
  programOffering: { include: offeringInclude },
  history: {
    include: { changedBy: { select: { firstName: true, lastName: true } } },
    orderBy: { createdAt: 'asc' },
  },
};

const respondWithError = (res, error, fallbackMessage) => {
  if (error instanceof AdmissionsError) return fail(res, error.message, error.status);
  if (error.code === 'P2002') return fail(res, 'A pending application or active Program enrollment already exists', 409);
  if (error.code === 'P2034') return fail(res, "The student's Program application or enrollment changed concurrently. Refresh and retry.", 409);
  throw error || new Error(fallbackMessage);
};

export const getOpenOfferings = async (_req, res) => (
  ok(res, await listOpenOfferings())
);

export const getMyApplication = async (req, res) => {
  const [application, enrollment, intakeAccess] = await Promise.all([
    prisma.programApplication.findFirst({
      where: { studentId: req.user.id },
      include: applicationInclude,
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
    }),
    prisma.programEnrollment.findFirst({
      where: { studentId: req.user.id, status: 'ACTIVE' },
      include: { programOffering: { include: offeringInclude } },
    }),
    getStudentIntakeAccess(req.user.id),
  ]);
  return ok(res, {
    application,
    activeEnrollment: enrollment,
    academicAccess: intakeAccess.state === 'ELIGIBLE',
    intakeAccessState: intakeAccess.state,
    canApply: !enrollment && application?.status !== 'PENDING',
  });
};

export const submitApplication = async (req, res) => {
  const { programOfferingId } = req.validated.body;
  try {
    const application = await createApplication({
      studentId: req.user.id,
      programOfferingId,
    });
    await audit({
      actorId: req.user.id,
      action: 'SUBMIT_PROGRAM_APPLICATION',
      entity: 'ProgramApplication',
      entityId: application.id,
      ipAddress: req.ip,
    });
    return ok(res, application, 'Application submitted for review', 201);
  } catch (error) {
    return respondWithError(res, error, 'Could not submit Program application');
  }
};

export const listApplications = async (req, res) => {
  const allowedStatuses = new Set(['PENDING', 'APPROVED', 'REJECTED']);
  const status = req.query.status;
  if (status && status !== 'ALL' && !allowedStatuses.has(status)) {
    return fail(res, 'Invalid application status filter', 400);
  }
  const items = await prisma.programApplication.findMany({
    where: status && status !== 'ALL' ? { status } : undefined,
    include: {
      student: {
        select: { id: true, firstName: true, lastName: true, email: true, phone: true, status: true },
      },
      programOffering: { include: offeringInclude },
      reviewedBy: { select: { firstName: true, lastName: true } },
    },
    orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
  });
  return ok(res, items);
};

export const getApplication = async (req, res) => {
  const application = await prisma.programApplication.findUnique({
    where: { id: req.params.id },
    include: {
      ...applicationInclude,
      student: {
        select: { id: true, firstName: true, lastName: true, email: true, phone: true, status: true },
      },
      reviewedBy: { select: { firstName: true, lastName: true } },
    },
  });
  if (!application) return fail(res, 'Application not found', 404);
  return ok(res, application);
};

const reviewApplication = async (req, res, decision) => {
  const applicationId = req.params.id;
  const { rejectionReason, adminNotes } = req.validated.body;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const application = await tx.programApplication.findUnique({
        where: { id: applicationId },
        include: {
          student: { select: { id: true, status: true } },
          programOffering: {
            select: {
              id: true,
              intakeId: true,
              programmeId: true,
              status: true,
              academicStartDate: true,
              intake: {
                select: {
                  status: true,
                  gateNumber: true,
                  season: true,
                  year: true,
                  timezone: true,
                },
              },
              programme: { select: { status: true, title: true } },
            },
          },
        },
      });
      if (!application) throw new AdmissionsError('Application not found', 404);
      if (application.status !== 'PENDING') {
        throw new AdmissionsError('This application has already been reviewed', 409);
      }
      if (application.student.status !== 'PENDING') {
        throw new AdmissionsError('The student account is not awaiting admission review', 409);
      }

      if (decision === 'approve') {
        const offering = application.programOffering;
        if (
          offering.status !== 'ACTIVE'
          || !['UPCOMING', 'ACTIVE'].includes(offering.intake.status)
          || offering.programme.status !== 'ACTIVE'
        ) {
          throw new AdmissionsError('The selected Program offering is no longer available for approval', 409);
        }
        const activeEnrollment = await tx.programEnrollment.findFirst({
          where: { studentId: application.studentId, status: 'ACTIVE' },
          select: { id: true },
        });
        if (activeEnrollment) {
          throw new AdmissionsError('This student already has an active Program enrollment', 409);
        }
        const cohort = await tx.cohort.findFirst({
          where: {
            programmeId: offering.programmeId,
            intakeProgramOfferingId: offering.id,
          },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        if (!cohort) {
          throw new AdmissionsError('This Program offering is not ready for student enrollment. Contact an administrator.', 409);
        }
        await tx.programEnrollment.create({
          data: {
            studentId: application.studentId,
            programOfferingId: offering.id,
            intakeId: offering.intakeId,
            programmeId: offering.programmeId,
            applicationId: application.id,
            status: 'ACTIVE',
          },
        });
        const existingCohortEnrollment = await tx.enrolment.findUnique({
          where: {
            studentId_cohortId: {
              studentId: application.studentId,
              cohortId: cohort.id,
            },
          },
          select: { id: true },
        });
        if (!existingCohortEnrollment) {
          await tx.enrolment.create({
            data: {
              studentId: application.studentId,
              cohortId: cohort.id,
            },
          });
        }
      }

      const nextStatus = decision === 'approve' ? 'APPROVED' : 'REJECTED';
      const update = await tx.programApplication.updateMany({
        where: { id: application.id, status: 'PENDING' },
        data: {
          status: nextStatus,
          rejectionReason: decision === 'reject' ? rejectionReason.trim() : null,
          adminNotes: adminNotes?.trim() || null,
          reviewedAt: new Date(),
          reviewedById: req.user.id,
        },
      });
      if (update.count !== 1) {
        throw new AdmissionsError('This application has already been reviewed', 409);
      }
      const studentUpdate = await tx.user.updateMany({
        where: { id: application.studentId, status: 'PENDING' },
        data: { status: decision === 'approve' ? 'ACTIVE' : 'REJECTED' },
      });
      if (studentUpdate.count !== 1) {
        throw new AdmissionsError('The student account changed during review', 409);
      }
      await tx.programApplicationStatusHistory.create({
        data: {
          applicationId: application.id,
          fromStatus: 'PENDING',
          toStatus: nextStatus,
          reason: decision === 'reject' ? rejectionReason.trim() : adminNotes?.trim() || null,
          changedById: req.user.id,
        },
      });
      await tx.notification.create({
        data: {
          userId: application.studentId,
          programmeId: application.programmeId,
          programOfferingId: application.programOfferingId,
          audienceStatus: 'CLASSIFIED',
          isGlobal: false,
          type: decision === 'approve' ? 'SUCCESS' : 'WARNING',
          title: decision === 'approve' ? 'Program application approved' : 'Program application update',
          body: decision === 'approve'
            ? `Your application for ${application.programOffering.programme.title}, GATE ${String(application.programOffering.intake.gateNumber).padStart(2, '0')} ${application.programOffering.intake.season} ${application.programOffering.intake.year}, was approved. Academic access begins ${new Intl.DateTimeFormat('en-US', {
              dateStyle: 'long',
              timeStyle: 'short',
              timeZone: application.programOffering.intake.timezone,
            }).format(application.programOffering.academicStartDate)} (${application.programOffering.intake.timezone}).`
            : `Your application was not approved. ${rejectionReason.trim()}`,
        },
      });
      return tx.programApplication.findUnique({
        where: { id: application.id },
        include: applicationInclude,
      });
    });
    await audit({
      actorId: req.user.id,
      action: `PROGRAM_APPLICATION_${decision.toUpperCase()}`,
      entity: 'ProgramApplication',
      entityId: applicationId,
      ipAddress: req.ip,
    });
    return ok(res, result, decision === 'approve' ? 'Application approved' : 'Application rejected');
  } catch (error) {
    return respondWithError(res, error, 'Could not review Program application');
  }
};

export const approveApplication = (req, res) => reviewApplication(req, res, 'approve');
export const rejectApplication = (req, res) => reviewApplication(req, res, 'reject');
