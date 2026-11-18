import prisma from '../config/database.js';
import { ok, fail } from '../utils/response.js';
import { audit } from '../utils/audit.js';
import { validateIntake, validateOfferingAcademicPeriod } from '../validators/intake.js';
import { revalidateLiveClassAccess } from '../services/liveClassRealtime.js';

const isPrismaError = (error, code) => error && typeof error === 'object' && error.code === code;
const asDateInput = (date) => date.toISOString().slice(0, 10);

const intakeWithOfferings = {
  programOfferings: {
    include: {
      programme: true,
      _count: { select: { cohorts: true, applications: true, programEnrollments: true, assessments: true } },
    },
    orderBy: { createdAt: 'asc' },
  },
};

const intakeDetailInclude = {
  programOfferings: {
    include: {
      programme: true,
      _count: { select: { cohorts: true, applications: true, programEnrollments: true, assessments: true } },
      cohorts: { select: { id: true, name: true, status: true } },
    },
    orderBy: { createdAt: 'asc' },
  },
};

const withStudentCounts = async (intakes, now = new Date()) => {
  if (!intakes.length) return intakes;
  const enrollments = await prisma.programEnrollment.findMany({
    where: {
      intakeId: { in: intakes.map(({ id }) => id) },
      status: 'ACTIVE',
      effectiveAt: { lte: now },
      student: {
        is: {
          status: 'ACTIVE',
          role: { is: { name: 'STUDENT' } },
        },
      },
      AND: [
        { OR: [{ endedAt: null }, { endedAt: { gt: now } }] },
        { OR: [{ applicationId: null }, { application: { is: { status: 'APPROVED' } } }] },
      ],
    },
    select: {
      intakeId: true,
      studentId: true,
      status: true,
      effectiveAt: true,
      endedAt: true,
      application: { select: { status: true } },
      student: { select: { status: true } },
      programOffering: { select: { academicStartDate: true } },
    },
  });
  const countsByIntake = new Map(intakes.map(({ id }) => [id, {
    approved: new Set(),
    waiting: new Set(),
    eligible: new Set(),
  }]));
  const intakeById = new Map(intakes.map((intake) => [intake.id, intake]));
  for (const enrollment of enrollments) {
    const counts = countsByIntake.get(enrollment.intakeId);
    const intake = intakeById.get(enrollment.intakeId);
    if (!counts || !intake) continue;
    counts.approved.add(enrollment.studentId);
    counts[enrollment.programOffering.academicStartDate > now ? 'waiting' : 'eligible'].add(enrollment.studentId);
  }
  return intakes.map((intake) => {
    const counts = countsByIntake.get(intake.id);
    return {
      ...intake,
      studentCounts: {
        approved: counts.approved.size,
        waiting: counts.waiting.size,
        eligible: counts.eligible.size,
      },
    };
  });
};

export const listIntakes = async (_req, res) => {
  const intakes = await prisma.intake.findMany({
    include: intakeWithOfferings,
    orderBy: [{ year: 'desc' }, { gateNumber: 'asc' }],
  });
  return ok(res, await withStudentCounts(intakes));
};

export const getIntake = async (req, res) => {
  const intake = await prisma.intake.findUnique({
    where: { id: req.params.id },
    include: intakeDetailInclude,
  });
  if (!intake) return fail(res, 'Intake not found.', 404);
  const [withCounts, auditEntries] = await Promise.all([
    withStudentCounts([intake]),
    intake.programOfferings.length
      ? prisma.auditLog.findMany({
        where: {
          entity: 'IntakeProgramOffering',
          entityId: { in: intake.programOfferings.map(({ id }) => id) },
          action: 'UPDATE_INTAKE_PROGRAM_OFFERING',
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true,
          entityId: true,
          action: true,
          metadata: true,
          createdAt: true,
          actor: { select: { firstName: true, lastName: true } },
        },
      })
      : Promise.resolve([]),
  ]);
  const histories = new Map(intake.programOfferings.map(({ id }) => [id, []]));
  for (const entry of auditEntries) {
    if (!histories.has(entry.entityId)) continue;
    histories.get(entry.entityId).push({
      ...entry,
      actor: entry.actor ? `${entry.actor.firstName} ${entry.actor.lastName}` : 'System',
    });
  }
  const programOfferings = withCounts[0].programOfferings.map((offering) => ({
    ...offering,
    auditHistory: histories.get(offering.id).slice(0, 20),
  }));
  return ok(res, {
    ...withCounts[0],
    programOfferings,
  });
};

export const createIntake = async (req, res) => {
  const result = validateIntake(req.body);
  if (result.error) return fail(res, result.error, 400);
  const { data } = result;

  try {
    const intake = await prisma.intake.create({
      data: {
        ...data,
        timezone: data.timezone || 'UTC',
        status: data.status || 'UPCOMING',
        admissionsOpen: data.admissionsOpen ?? !['ARCHIVED', 'COMPLETED'].includes(data.status),
      },
    });
    await audit({
      actorId: req.user.id,
      action: 'CREATE_INTAKE',
      entity: 'Intake',
      entityId: intake.id,
      ipAddress: req.ip,
    });
    return ok(res, intake, 'Intake created.', 201);
  } catch (error) {
    if (isPrismaError(error, 'P2002')) return fail(res, 'An intake already exists for this gate and year.', 409);
    throw error;
  }
};

export const updateIntake = async (req, res) => {
  const current = await prisma.intake.findUnique({
    where: { id: req.params.id },
    include: { programOfferings: { select: { id: true, academicStartDate: true, academicEndDate: true } } },
  });
  if (!current) return fail(res, 'Intake not found.', 404);

  const currentInput = {
    gateNumber: current.gateNumber,
    season: current.season,
    year: current.year,
    timezone: current.timezone,
    admissionsOpen: current.admissionsOpen,
    status: current.status,
  };
  const merged = { ...currentInput, ...req.body };
  if ((req.body?.status === 'ARCHIVED' || req.body?.status === 'COMPLETED') &&
      req.body?.admissionsOpen === undefined) {
    merged.admissionsOpen = false;
  }
  const result = validateIntake(merged);
  if (result.error) return fail(res, result.error, 400);
  for (const offering of current.programOfferings) {
    const dates = validateOfferingAcademicPeriod(offering, result.data);
    if (dates.error) {
      return fail(
        res,
        'The intake GATE, season, year, or timezone change would put existing program dates outside the intake period.',
        409,
      );
    }
  }

  try {
    const intake = await prisma.intake.update({
      where: { id: current.id },
      data: result.data,
    });
    await audit({
      actorId: req.user.id,
      action: 'UPDATE_INTAKE',
      entity: 'Intake',
      entityId: intake.id,
      ipAddress: req.ip,
    });
    await revalidateLiveClassAccess();
    return ok(res, intake, 'Intake updated.');
  } catch (error) {
    if (isPrismaError(error, 'P2002')) return fail(res, 'An intake already exists for this gate and year.', 409);
    throw error;
  }
};

export const addIntakeOfferings = async (req, res) => {
  const { offerings: requestedOfferings, status = 'ACTIVE' } = req.body || {};
  if (!Array.isArray(requestedOfferings) || requestedOfferings.length === 0 ||
      requestedOfferings.some((offering) => (
        !offering
        || typeof offering.programmeId !== 'string'
        || offering.programmeId.trim() === ''
      ))) {
    return fail(res, 'Choose one or more programs and set their academic dates.', 400);
  }
  const programmeIds = requestedOfferings.map(({ programmeId }) => programmeId);
  if (new Set(programmeIds).size !== programmeIds.length) {
    return fail(res, 'Choose one or more distinct programmes.', 400);
  }
  if (!['ACTIVE', 'INACTIVE'].includes(status)) {
    return fail(res, 'Offering status must be Active or Inactive.', 400);
  }

  const intake = await prisma.intake.findUnique({
    where: { id: req.params.id },
    select: { id: true, status: true, gateNumber: true, season: true, year: true, timezone: true },
  });
  if (!intake) return fail(res, 'Intake not found.', 404);
  if (intake.status === 'ARCHIVED' || intake.status === 'COMPLETED') {
    return fail(res, 'Offerings cannot be added to a completed or archived intake.', 409);
  }
  const offeringData = [];
  for (const requestedOffering of requestedOfferings) {
    const dates = validateOfferingAcademicPeriod(requestedOffering, intake);
    if (dates.error) return fail(res, dates.error, 400);
    offeringData.push({
      programmeId: requestedOffering.programmeId,
      ...dates.data,
      status,
    });
  }
  const programmes = await prisma.programme.findMany({
    where: { id: { in: programmeIds }, status: { not: 'ARCHIVED' } },
    select: { id: true },
  });
  if (programmes.length !== programmeIds.length) {
    return fail(res, 'One or more selected programmes do not exist or are archived.', 400);
  }

  const existing = await prisma.intakeProgramOffering.findMany({
    where: { intakeId: intake.id, programmeId: { in: programmeIds } },
    select: { programmeId: true },
  });
  if (existing.length) return fail(res, 'One or more programmes are already offered in this intake.', 409);

  try {
    const createdOfferings = await prisma.$transaction(async (transaction) => {
      await transaction.intakeProgramOffering.createMany({
        data: offeringData.map((offering) => ({
          intakeId: intake.id,
          ...offering,
        })),
      });
      return transaction.intakeProgramOffering.findMany({
        where: { intakeId: intake.id, programmeId: { in: programmeIds } },
        include: { programme: true, _count: { select: { cohorts: true, applications: true, programEnrollments: true, assessments: true } } },
        orderBy: { createdAt: 'asc' },
      });
    });
    await audit({
      actorId: req.user.id,
      action: 'ADD_INTAKE_PROGRAM_OFFERINGS',
      entity: 'Intake',
      entityId: intake.id,
      metadata: { offerings: offeringData.map(({ programmeId, academicStartDate, academicEndDate }) => ({
        programmeId,
        academicStartDate: academicStartDate.toISOString(),
        academicEndDate: asDateInput(academicEndDate),
      })), status },
      ipAddress: req.ip,
    });
    return ok(res, createdOfferings, 'Program offerings added.', 201);
  } catch (error) {
    if (isPrismaError(error, 'P2002')) return fail(res, 'One or more programmes are already offered in this intake.', 409);
    throw error;
  }
};

export const updateIntakeOffering = async (req, res) => {
  const { status } = req.body || {};
  if (status !== undefined && !['ACTIVE', 'INACTIVE'].includes(status)) {
    return fail(res, 'Offering status must be Active or Inactive.', 400);
  }
  if (!req.body || Object.keys(req.body).some((field) => !['status', 'academicStartDate', 'academicEndDate'].includes(field))
    || Object.keys(req.body).length === 0) {
    return fail(res, 'Provide offering status or academic dates to update.', 400);
  }
  const offering = await prisma.intakeProgramOffering.findFirst({
    where: { id: req.params.offeringId, intakeId: req.params.id },
    include: {
      intake: { select: { status: true, season: true, year: true, timezone: true } },
      programme: { select: { status: true } },
    },
  });
  if (!offering) return fail(res, 'Program offering not found.', 404);
  if (status === 'ACTIVE' &&
      (offering.intake.status === 'ARCHIVED' || offering.intake.status === 'COMPLETED' ||
       offering.programme.status === 'ARCHIVED')) {
    return fail(res, 'A completed or archived intake or programme cannot have an active offering.', 409);
  }

  let dateData = {};
  if (req.body.academicStartDate !== undefined || req.body.academicEndDate !== undefined) {
    const dates = validateOfferingAcademicPeriod({
      academicStartDate: req.body.academicStartDate ?? offering.academicStartDate,
      academicEndDate: req.body.academicEndDate ?? offering.academicEndDate,
    }, offering.intake);
    if (dates.error) return fail(res, dates.error, 400);
    dateData = dates.data;
  }
  const metadata = { intakeId: req.params.id };
  if (status !== undefined) metadata.status = status;
  if (Object.keys(dateData).length) {
    metadata.previousAcademicStartDate = offering.academicStartDate.toISOString();
    metadata.academicStartDate = dateData.academicStartDate.toISOString();
    metadata.previousAcademicEndDate = asDateInput(offering.academicEndDate);
    metadata.academicEndDate = asDateInput(dateData.academicEndDate);
  }
  const updated = await prisma.intakeProgramOffering.update({
    where: { id: offering.id },
    data: { ...dateData, ...(status !== undefined ? { status } : {}) },
    include: { programme: true, _count: { select: { cohorts: true, applications: true, programEnrollments: true, assessments: true } } },
  });
  await audit({
    actorId: req.user.id,
    action: 'UPDATE_INTAKE_PROGRAM_OFFERING',
    entity: 'IntakeProgramOffering',
    entityId: updated.id,
    metadata,
    ipAddress: req.ip,
  });
  await revalidateLiveClassAccess();
  return ok(res, updated, 'Program offering updated.');
};

export const removeIntakeOffering = async (req, res) => {
  const offering = await prisma.intakeProgramOffering.findFirst({
    where: { id: req.params.offeringId, intakeId: req.params.id },
    include: { _count: { select: { cohorts: true, applications: true, programEnrollments: true, assessments: true } } },
  });
  if (!offering) return fail(res, 'Program offering not found.', 404);
  if (
    offering._count.cohorts > 0
    || offering._count.applications > 0
    || offering._count.programEnrollments > 0
    || offering._count.assessments > 0
  ) {
    return fail(res, 'This offering has academic or admissions records and cannot be removed. Deactivate it instead.', 409);
  }

  try {
    await prisma.intakeProgramOffering.delete({ where: { id: offering.id } });
  } catch (error) {
    if (isPrismaError(error, 'P2003')) {
      return fail(res, 'This offering has academic or admissions records and cannot be removed. Deactivate it instead.', 409);
    }
    throw error;
  }
  await audit({
    actorId: req.user.id,
    action: 'REMOVE_INTAKE_PROGRAM_OFFERING',
    entity: 'IntakeProgramOffering',
    entityId: offering.id,
    metadata: { intakeId: req.params.id },
    ipAddress: req.ip,
  });
  return ok(res, null, 'Program offering removed.');
};
