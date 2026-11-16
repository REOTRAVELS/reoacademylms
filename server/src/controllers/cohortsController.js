import prisma from '../config/database.js';
import { ok, fail } from '../utils/response.js';
import { audit } from '../utils/audit.js';
import { revalidateLiveClassAccess } from '../services/liveClassRealtime.js';

const cohortIncludes = {
  programme: true,
  intakeProgramOffering: {
    include: {
      intake: { select: { id: true, gateNumber: true, season: true, year: true } },
    },
  },
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
  return ok(res, items);
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
  return ok(res, c);
};

export const createCohort = async (req, res) => {
  const { name, programmeId, intakeProgramOfferingId, startDate, endDate, status, schedule } = req.body || {};
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
  await audit({ actorId: req.user.id, action: 'CREATE_COHORT', entity: 'Cohort', entityId: c.id, ipAddress: req.ip });
  return ok(res, c, 'Created', 201);
};

export const updateCohort = async (req, res) => {
  const { name, startDate, endDate, status, schedule, intakeProgramOfferingId } = req.body || {};
  const current = await prisma.cohort.findUnique({
    where: { id: req.params.id },
    select: { id: true, programmeId: true },
  });
  if (!current) return fail(res, 'Cohort not found', 404);
  const data = {};
  if (name) data.name = name;
  if (startDate !== undefined) data.startDate = startDate ? new Date(startDate) : null;
  if (endDate !== undefined) data.endDate = endDate ? new Date(endDate) : null;
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
  await audit({ actorId: req.user.id, action: 'UPDATE_COHORT', entity: 'Cohort', entityId: c.id, ipAddress: req.ip });
  await revalidateLiveClassAccess();
  return ok(res, c, 'Updated');
};

export const deleteCohort = async (req, res) => {
  const cohort = await prisma.cohort.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!cohort) return fail(res, 'Cohort not found', 404);
  await prisma.cohort.delete({ where: { id: cohort.id } });
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
  return ok(res, c, 'Assigned', 201);
};

export const removeCourse = async (req, res) => {
  const assignment = await prisma.cohortCourse.findFirst({
    where: { id: req.params.assignmentId, cohortId: req.params.id },
    select: { id: true },
  });
  if (!assignment) return fail(res, 'Course assignment not found', 404);
  await prisma.cohortCourse.delete({ where: { id: assignment.id } });
  return ok(res, null, 'Course unassigned');
};
