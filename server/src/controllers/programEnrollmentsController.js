import prisma from '../config/database.js';
import { fail, ok } from '../utils/response.js';
import { parseListOptions, parseOptionalId } from '../utils/notificationPolicies.js';

const legacyStudentWhere = (search) => ({
  status: 'ACTIVE',
  role: { name: 'STUDENT' },
  enrolments: { some: {} },
  programEnrollments: { none: { status: 'ACTIVE' } },
  programApplications: { none: { status: 'PENDING' } },
  ...(search ? {
    OR: [
      { firstName: { contains: search, mode: 'insensitive' } },
      { lastName: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ],
  } : {}),
});

export const listLegacyStudents = async (req, res) => {
  const search = req.query.search;
  const pagination = parseListOptions(req.query, 25);
  if (
    !pagination
    || (search !== undefined && (
      typeof search !== 'string'
      || search.trim() !== search
      || search.length > 100
    ))
  ) return fail(res, 'Invalid student search or pagination options', 400);

  const where = legacyStudentWhere(search || '');
  if (pagination.cursor) {
    const cursor = await prisma.user.findFirst({
      where: { ...where, id: pagination.cursor.id },
      select: { id: true },
    });
    if (!cursor) return fail(res, 'Invalid student cursor', 400);
  }
  const students = await prisma.user.findMany({
    where,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      enrolments: {
        select: {
          cohortId: true,
          cohort: { select: { name: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
      programApplications: {
        select: {
          id: true,
          status: true,
          programOfferingId: true,
          intakeId: true,
          programmeId: true,
          submittedAt: true,
          reviewedAt: true,
        },
        orderBy: { submittedAt: 'asc' },
      },
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
    ...pagination,
  });
  return ok(res, {
    items: students,
    nextCursor: students.length === pagination.take ? students.at(-1).id : null,
  });
};

export const listAssignableOfferings = async (_req, res) => {
  const offerings = await prisma.intakeProgramOffering.findMany({
    where: {
      status: 'ACTIVE',
      intake: { status: { in: ['UPCOMING', 'ACTIVE'] } },
      programme: { status: 'ACTIVE' },
    },
    select: {
      id: true,
      intakeId: true,
      programmeId: true,
      programme: { select: { id: true, title: true } },
      intake: {
        select: {
          id: true,
          gateNumber: true,
          season: true,
          year: true,
          status: true,
        },
      },
    },
    orderBy: [
      { intake: { year: 'desc' } },
      { intake: { gateNumber: 'asc' } },
      { programme: { title: 'asc' } },
    ],
  });
  return ok(res, offerings);
};

export const listAssignmentHistory = async (req, res) => {
  const search = req.query.search;
  const pagination = parseListOptions(req.query, 25);
  if (
    !pagination
    || (search !== undefined && (
      typeof search !== 'string'
      || search.trim() !== search
      || search.length > 100
    ))
  ) return fail(res, 'Invalid assignment history search or pagination options', 400);

  const where = search ? {
    student: {
      is: {
        OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      },
    },
  } : {};
  if (pagination.cursor) {
    const cursor = await prisma.programEnrollmentAssignmentHistory.findFirst({
      where: { ...where, id: pagination.cursor.id },
      select: { id: true },
    });
    if (!cursor) return fail(res, 'Invalid assignment history cursor', 400);
  }
  const items = await prisma.programEnrollmentAssignmentHistory.findMany({
    where,
    select: {
      id: true,
      assignedAt: true,
      previousState: true,
      newAssignment: true,
      student: { select: { id: true, firstName: true, lastName: true, email: true } },
      assignedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      enrollment: {
        select: {
          id: true,
          programOffering: {
            select: {
              id: true,
              programme: { select: { title: true } },
              intake: { select: { gateNumber: true, season: true, year: true } },
            },
          },
        },
      },
    },
    orderBy: [{ assignedAt: 'desc' }, { id: 'desc' }],
    ...pagination,
  });
  return ok(res, {
    items,
    nextCursor: items.length === pagination.take ? items.at(-1).id : null,
  });
};

export const assignLegacyStudent = async (req, res) => {
  const { studentId } = req.params;
  const body = req.body;
  const programOfferingId = parseOptionalId(body?.programOfferingId);
  if (
    !body
    || typeof body !== 'object'
    || Array.isArray(body)
    || Object.keys(body).some((key) => key !== 'programOfferingId')
    || !programOfferingId
  ) return fail(res, 'Provide exactly one valid Program Offering id', 400);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const student = await tx.user.findUnique({
        where: { id: studentId },
        select: {
          id: true,
          status: true,
          role: { select: { name: true } },
          enrolments: {
            select: { cohortId: true, cohort: { select: { id: true, name: true } } },
            orderBy: { createdAt: 'asc' },
          },
          programEnrollments: {
            select: {
              id: true,
              status: true,
              programOfferingId: true,
              intakeId: true,
              programmeId: true,
              createdAt: true,
              effectiveAt: true,
              endedAt: true,
            },
            orderBy: { createdAt: 'asc' },
          },
          programApplications: {
            select: {
              id: true,
              status: true,
              programOfferingId: true,
              intakeId: true,
              programmeId: true,
              submittedAt: true,
              reviewedAt: true,
            },
            orderBy: { submittedAt: 'asc' },
          },
        },
      });
      if (!student) return { error: 'Student not found', status: 404 };
      if (student.role.name !== 'STUDENT' || student.status !== 'ACTIVE') {
        return { error: 'Only active student accounts can be manually assigned', status: 409 };
      }
      if (!student.enrolments.length) {
        return { error: 'This student has no legacy Cohort enrolment', status: 409 };
      }
      if (student.programEnrollments.some(({ status }) => status === 'ACTIVE')) {
        return { error: 'This student already has an active Program enrollment', status: 409 };
      }
      if (student.programApplications.some(({ status }) => status === 'PENDING')) {
        return { error: 'This student has a pending Program application that must be reviewed first', status: 409 };
      }

      const offering = await tx.intakeProgramOffering.findUnique({
        where: { id: programOfferingId },
        select: {
          id: true,
          intakeId: true,
          programmeId: true,
          status: true,
          programme: { select: { id: true, title: true, status: true } },
          intake: {
            select: {
              id: true,
              gateNumber: true,
              season: true,
              year: true,
              status: true,
            },
          },
        },
      });
      if (!offering) return { error: 'Program Offering not found', status: 404 };
      if (
        offering.status !== 'ACTIVE'
        || offering.programme.status !== 'ACTIVE'
        || !['UPCOMING', 'ACTIVE'].includes(offering.intake.status)
      ) return { error: 'The selected Program Offering is not available for assignment', status: 409 };

      const enrollment = await tx.programEnrollment.create({
        data: {
          studentId: student.id,
          programOfferingId: offering.id,
          intakeId: offering.intakeId,
          programmeId: offering.programmeId,
          status: 'ACTIVE',
        },
      });
      const previousState = {
        activeProgramEnrollment: null,
        historicalProgramEnrollments: student.programEnrollments.map((enrollment) => ({
          ...enrollment,
          createdAt: enrollment.createdAt?.toISOString() ?? null,
          effectiveAt: enrollment.effectiveAt?.toISOString() ?? null,
          endedAt: enrollment.endedAt?.toISOString() ?? null,
        })),
        previousApplications: student.programApplications.map((application) => ({
          ...application,
          submittedAt: application.submittedAt?.toISOString() ?? null,
          reviewedAt: application.reviewedAt?.toISOString() ?? null,
        })),
        legacyCohorts: student.enrolments.map(({ cohortId, cohort }) => ({
          cohortId,
          cohortName: cohort.name,
        })),
      };
      const newAssignment = {
        enrollmentId: enrollment.id,
        programOfferingId: offering.id,
        intakeId: offering.intake.id,
        intake: {
          gateNumber: offering.intake.gateNumber,
          season: offering.intake.season,
          year: offering.intake.year,
        },
        programmeId: offering.programme.id,
        programmeTitle: offering.programme.title,
      };
      const history = await tx.programEnrollmentAssignmentHistory.create({
        data: {
          enrollmentId: enrollment.id,
          studentId: student.id,
          assignedById: req.user.id,
          previousState,
          newAssignment,
        },
      });
      return { enrollment, history };
    }, { isolationLevel: 'Serializable' });
    if (result.error) return fail(res, result.error, result.status);
    return ok(res, result, 'Student assigned to the Program Offering', 201);
  } catch (error) {
    if (error?.code === 'P2002') {
      return fail(res, 'This student already has an active Program enrollment', 409);
    }
    if (error?.code === 'P2034') {
      return fail(res, "The student's Program application or enrollment changed concurrently. Refresh and retry.", 409);
    }
    throw error;
  }
};
