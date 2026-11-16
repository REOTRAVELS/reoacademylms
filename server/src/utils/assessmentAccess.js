import prisma from '../config/database.js';
import { activeProgramEnrollmentWhere } from './intakeAccess.js';

export const assessmentOfferingForStudentWhere = (studentId) => ({
  OR: [
    { programOfferingId: null },
    {
      programOffering: {
        is: {
          programEnrollments: {
            some: activeProgramEnrollmentWhere(studentId),
          },
        },
      },
    },
  ],
});

export const canAccessAssessmentOffering = async (assessment, studentId, database = prisma) => {
  if (!assessment.programOfferingId) return true;
  const enrollment = await database.programEnrollment.findFirst({
    where: {
      ...activeProgramEnrollmentWhere(studentId),
      programOfferingId: assessment.programOfferingId,
    },
    select: { id: true },
  });
  return Boolean(enrollment);
};
