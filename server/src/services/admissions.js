import prisma from '../config/database.js';

export class AdmissionsError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'AdmissionsError';
    this.status = status;
  }
}

export const isOfferingOpenForApplications = (offering, now = new Date()) => {
  if (
    !offering
    || offering.status !== 'ACTIVE'
    || !offering.intake?.admissionsOpen
    || !['UPCOMING', 'ACTIVE'].includes(offering.intake.status)
    || offering.programme?.status !== 'ACTIVE'
  ) return false;
  const academicStartDate = new Date(offering.academicStartDate);
  return Number.isFinite(academicStartDate.getTime()) && academicStartDate > now;
};

export const listOpenOfferings = async (now = new Date()) => {
  const offerings = await prisma.intakeProgramOffering.findMany({
    where: {
      status: 'ACTIVE',
      intake: {
        admissionsOpen: true,
        status: { in: ['UPCOMING', 'ACTIVE'] },
      },
      academicStartDate: { gt: now },
      programme: { status: 'ACTIVE' },
    },
    include: {
      programme: { select: { id: true, title: true, qualificationType: true, status: true } },
      intake: {
        select: {
          id: true,
          gateNumber: true,
          season: true,
          year: true,
          timezone: true,
          admissionsOpen: true,
          status: true,
        },
      },
    },
    orderBy: [{ intake: { year: 'asc' } }, { intake: { gateNumber: 'asc' } }, { programme: { title: 'asc' } }],
  });
  return offerings.filter((offering) => isOfferingOpenForApplications(offering, now));
};

const findOpenOffering = async (tx, programOfferingId, now) => {
  const offering = await tx.intakeProgramOffering.findFirst({
    where: {
      id: programOfferingId,
      status: 'ACTIVE',
      intake: {
        admissionsOpen: true,
        status: { in: ['UPCOMING', 'ACTIVE'] },
      },
      academicStartDate: { gt: now },
      programme: { status: 'ACTIVE' },
    },
    include: {
      intake: {
        select: {
          id: true,
          admissionsOpen: true,
          status: true,
        },
      },
      programme: { select: { id: true, status: true } },
    },
  });
  return isOfferingOpenForApplications(offering, now) ? offering : null;
};

export const createApplicationInTransaction = async (tx, { studentId, programOfferingId, now = new Date() }) => {
  const user = await tx.user.findUnique({
    where: { id: studentId },
    select: { id: true, status: true, role: { select: { name: true } } },
  });
  if (!user || user.role.name !== 'STUDENT') {
    throw new AdmissionsError('Student account not found', 404);
  }
  if (!['PENDING', 'ACTIVE', 'REJECTED'].includes(user.status)) {
    throw new AdmissionsError('This account cannot submit a Program application', 403);
  }

  const [activeEnrollment, pendingApplication, offering] = await Promise.all([
    tx.programEnrollment.findFirst({
      where: { studentId, status: 'ACTIVE' },
      select: { id: true },
    }),
    tx.programApplication.findFirst({
      where: { studentId, status: 'PENDING' },
      select: { id: true },
    }),
    findOpenOffering(tx, programOfferingId, now),
  ]);
  if (activeEnrollment) {
    throw new AdmissionsError('This student already has an active Program enrollment', 409);
  }
  if (pendingApplication) {
    throw new AdmissionsError('A Program application is already awaiting review', 409);
  }
  if (!offering) {
    throw new AdmissionsError('This Program offering is not currently accepting applications', 400);
  }

  const application = await tx.programApplication.create({
    data: {
      studentId,
      programOfferingId: offering.id,
      intakeId: offering.intake.id,
      programmeId: offering.programme.id,
      status: 'PENDING',
    },
  });
  await tx.programApplicationStatusHistory.create({
    data: {
      applicationId: application.id,
      toStatus: 'PENDING',
    },
  });
  if (user.status !== 'PENDING') {
    await tx.user.update({ where: { id: studentId }, data: { status: 'PENDING' } });
  }
  return application;
};

export const createApplication = async (data) => (
  prisma.$transaction(
    (tx) => createApplicationInTransaction(tx, data),
    { isolationLevel: 'Serializable' },
  )
);
