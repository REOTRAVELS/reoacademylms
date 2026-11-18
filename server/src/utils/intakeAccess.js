import prisma from '../config/database.js';

export const activeProgramEnrollmentWhere = (studentId, now = new Date()) => ({
  studentId,
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
});

const accessEnrollmentInclude = {
  programOffering: {
    select: {
      programmeId: true,
      intakeId: true,
      programme: { select: { title: true } },
      academicStartDate: true,
      intake: {
        select: {
          id: true,
          gateNumber: true,
          season: true,
          year: true,
          timezone: true,
        },
      },
    },
  },
};

export const getStudentIntakeAccess = async (studentId, now = new Date()) => {
  const baseWhere = activeProgramEnrollmentWhere(studentId, now);
  const eligible = await prisma.programEnrollment.findFirst({
    where: {
      ...baseWhere,
      programOffering: {
        is: { academicStartDate: { lte: now } },
      },
    },
    include: accessEnrollmentInclude,
    orderBy: { effectiveAt: 'desc' },
  });
  if (eligible) return { state: 'ELIGIBLE', enrollment: eligible };

  const waiting = await prisma.programEnrollment.findFirst({
    where: {
      ...baseWhere,
      programOffering: {
        is: { academicStartDate: { gt: now } },
      },
    },
    include: accessEnrollmentInclude,
    orderBy: { programOffering: { academicStartDate: 'asc' } },
  });
  return waiting
    ? { state: 'WAITING', enrollment: waiting }
    : { state: 'NONE', enrollment: null };
};
