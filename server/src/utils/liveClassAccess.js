import prisma from '../config/database.js';
import { activeProgramCohortForStudent, canManageCourse } from './courseAccess.js';

export const canManageLiveClass = async (liveClass, user) => {
  if (user.role.name === 'SUPER_ADMIN') return true;
  if (user.role.name !== 'TRAINER') return false;
  if (liveClass.createdById === user.id) return true;
  if (liveClass.courseId && await canManageCourse(liveClass.courseId, user)) return true;
  if (!liveClass.cohortId) return false;
  return Boolean(await prisma.cohortTrainer.findUnique({
    where: { cohortId_trainerId: { cohortId: liveClass.cohortId, trainerId: user.id } },
    select: { id: true },
  }));
};

export const findAccessibleLiveClass = async (id, user) => {
  const liveClass = await prisma.liveClass.findUnique({
    where: { id },
    select: {
      id: true, title: true, roomName: true, courseId: true, cohortId: true,
      createdById: true, status: true, description: true, startsAt: true, durationMins: true,
    },
  });
  if (!liveClass) return null;
  if (await canManageLiveClass(liveClass, user)) return liveClass;
  // Instant classes with no course or cohort are staff rooms: any trainer may join.
  if (!liveClass.courseId && !liveClass.cohortId) return user.role.name === 'TRAINER' ? liveClass : null;
  if (user.role.name !== 'STUDENT' || !liveClass.cohortId) return null;
  const enrolment = await prisma.enrolment.findFirst({
    where: {
      studentId: user.id,
      cohortId: liveClass.cohortId,
      cohort: activeProgramCohortForStudent(user.id),
    },
    select: { id: true },
  });
  return enrolment ? liveClass : null;
};
