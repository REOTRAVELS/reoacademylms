import prisma from '../config/database.js';
import { ok, fail } from '../utils/response.js';
import { isStudentLessonAvailable } from '../utils/lessonAccess.js';
import { canAccessCourse, studentCourseAccessWhere } from '../utils/courseAccess.js';

const studentCanAccessLesson = async (lessonId, user) => {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: {
      isPublished: true,
      module: {
        select: {
          course: {
            select: {
              id: true,
              status: true,
              programmeId: true,
              visibility: true,
              startDate: true,
              endDate: true,
              cohorts: {
                where: { cohort: { enrolments: { some: { studentId: user.id } } } },
                select: { id: true },
              },
            },
          },
        },
      },
    },
  });
  const courseId = lesson?.module?.course?.id;
  return Boolean(
    isStudentLessonAvailable(lesson)
    && courseId
    && (await canAccessCourse(courseId, user)),
  );
};

export const markComplete = async (req, res) => {
  if (req.user.role.name !== 'STUDENT') return fail(res, 'Only students can update lesson progress', 403);
  const { lessonId } = req.body || {};
  if (typeof lessonId !== 'string' || !lessonId.trim()) return fail(res, 'lessonId is required', 400);
  if (!(await studentCanAccessLesson(lessonId, req.user))) {
    return fail(res, 'Lesson is not available', 404);
  }
  const lp = await prisma.lessonProgress.upsert({
    where: { studentId_lessonId: { studentId: req.user.id, lessonId } },
    create: { studentId: req.user.id, lessonId, completed: true, completedAt: new Date() },
    update: { completed: true, completedAt: new Date() },
  });
  return ok(res, lp, 'Updated');
};

export const recordLessonAccess = async (req, res) => {
  if (req.user.role.name !== 'STUDENT') return fail(res, 'Only students can update lesson progress', 403);
  const { lessonId } = req.body || {};
  if (typeof lessonId !== 'string' || !lessonId.trim()) return fail(res, 'lessonId is required', 400);
  if (!(await studentCanAccessLesson(lessonId, req.user))) {
    return fail(res, 'Lesson is not available', 404);
  }

  const progress = await prisma.lessonProgress.upsert({
    where: { studentId_lessonId: { studentId: req.user.id, lessonId } },
    create: { studentId: req.user.id, lessonId, completed: false },
    update: { updatedAt: new Date() },
    include: {
      lesson: {
        select: {
          id: true,
          title: true,
          module: {
            select: {
              id: true,
              title: true,
              course: { select: { id: true, title: true } },
            },
          },
        },
      },
    },
  });
  return ok(res, progress, 'Lesson access recorded');
};

export const myProgress = async (req, res) => {
  const items = await prisma.lessonProgress.findMany({
    where: {
      studentId: req.user.id,
      lesson: { isPublished: true, module: { course: studentCourseAccessWhere(req.user.id) } },
    },
    include: {
      lesson: {
        select: {
          id: true,
          title: true,
          module: {
            select: {
              id: true,
              title: true,
              course: { select: { id: true, title: true } },
            },
          },
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });
  return ok(res, items);
};
