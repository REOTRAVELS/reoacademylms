import prisma from '../config/database.js';
import { activeProgramEnrollmentWhere } from './intakeAccess.js';

export const activeProgramForStudent = (studentId, now = new Date()) => ({
  intakeOfferings: {
    some: {
      academicStartDate: { lte: now },
      programEnrollments: { some: activeProgramEnrollmentWhere(studentId, now) },
    },
  },
});

export const activeProgramOfferingForStudent = (studentId, now = new Date()) => ({
  academicStartDate: { lte: now },
  programEnrollments: { some: activeProgramEnrollmentWhere(studentId, now) },
});

export const activeProgramCohortForStudent = (studentId, now = new Date()) => ({
  programme: activeProgramForStudent(studentId, now),
  enrolments: { some: { studentId } },
  intakeProgramOffering: { is: activeProgramOfferingForStudent(studentId, now) },
});

export const studentProgramCourseWhere = (studentId, now = new Date()) => ({
  OR: [
    {
      programme: { is: activeProgramForStudent(studentId, now) },
      cohorts: { some: { cohort: activeProgramCohortForStudent(studentId, now) } },
    },
    {
      programmeId: null,
      cohorts: { some: { cohort: activeProgramCohortForStudent(studentId, now) } },
    },
  ],
});

export const studentCourseAccessWhere = (studentId, now = new Date()) => ({
  status: 'PUBLISHED',
  AND: [
    studentProgramCourseWhere(studentId, now),
    { OR: [{ startDate: null }, { startDate: { lte: now } }] },
    { OR: [{ endDate: null }, { endDate: { gte: now } }] },
  ],
});

export const canManageCourse = async (courseId, user) => {
  if (user.role.name === 'SUPER_ADMIN') return true;
  if (user.role.name !== 'TRAINER') return false;
  const assignment = await prisma.courseTrainer.findUnique({
    where: { courseId_trainerId: { courseId, trainerId: user.id } },
    select: { id: true },
  });
  return Boolean(assignment);
};

export const canAccessCourse = async (courseId, user, now = new Date()) => {
  if (user.role.name === 'SUPER_ADMIN') return true;
  if (user.role.name === 'TRAINER') return canManageCourse(courseId, user);
  if (user.role.name !== 'STUDENT') return false;
  const course = await prisma.course.findFirst({
    where: {
      id: courseId,
      ...studentCourseAccessWhere(user.id, now),
    },
    select: { id: true },
  });
  return Boolean(course);
};
