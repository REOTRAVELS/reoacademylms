import prisma from '../config/database.js';
import { studentCourseAccessWhere } from './courseAccess.js';

const unique = (values) => [...new Set(values.filter(Boolean))];

export const resolveCourseDiscussionScope = async (courseId, user, database = prisma) => {
  const course = await database.course.findUnique({
    where: { id: courseId },
    select: {
      id: true,
      title: true,
      programmeId: true,
      status: true,
      cohorts: {
        select: {
          cohort: {
            select: {
              programmeId: true,
              intakeProgramOfferingId: true,
              trainers: { select: { trainerId: true } },
              enrolments: {
                where: { studentId: user.id },
                select: { id: true },
              },
            },
          },
        },
      },
    },
  });
  if (!course?.programmeId) return { error: 'NOT_FOUND' };

  const matchingCohorts = course.cohorts
    .map(({ cohort }) => cohort)
    .filter((cohort) => cohort?.programmeId === course.programmeId && cohort.intakeProgramOfferingId);
  let allowedOfferingIds = [];
  if (user.role.name === 'STUDENT') {
    const accessibleCourse = await database.course.findFirst({
      where: {
        id: course.id,
        ...studentCourseAccessWhere(user.id),
      },
      select: { id: true },
    });
    if (!accessibleCourse) return { error: 'NOT_FOUND' };
    const enrolledOfferingIds = matchingCohorts
      .filter((cohort) => cohort.enrolments.length > 0)
      .map((cohort) => cohort.intakeProgramOfferingId);
    if (!enrolledOfferingIds.length) return { error: 'NOT_FOUND' };
    const enrollments = await database.programEnrollment.findMany({
      where: {
        studentId: user.id,
        programmeId: course.programmeId,
        programOfferingId: { in: unique(enrolledOfferingIds) },
        status: 'ACTIVE',
      },
      select: { programOfferingId: true },
    });
    const activeOfferingIds = new Set(enrollments.map(({ programOfferingId }) => programOfferingId));
    allowedOfferingIds = unique(enrolledOfferingIds).filter((id) => activeOfferingIds.has(id));
    if (!allowedOfferingIds.length) return { error: 'NOT_FOUND' };
  } else if (user.role.name === 'TRAINER') {
    const courseAssignment = await database.courseTrainer.findUnique({
      where: { courseId_trainerId: { courseId: course.id, trainerId: user.id } },
      select: { id: true },
    });
    if (!courseAssignment) return { error: 'FORBIDDEN' };
    allowedOfferingIds = unique(matchingCohorts
      .filter((cohort) => cohort.trainers.some(({ trainerId }) => trainerId === user.id))
      .map((cohort) => cohort.intakeProgramOfferingId));
    if (!allowedOfferingIds.length) return { error: 'FORBIDDEN' };
  } else if (user.role.name === 'SUPER_ADMIN') {
    allowedOfferingIds = unique(matchingCohorts.map((cohort) => cohort.intakeProgramOfferingId));
  } else {
    return { error: 'FORBIDDEN' };
  }

  const offerings = allowedOfferingIds.length
    ? await database.intakeProgramOffering.findMany({
      where: {
        id: { in: allowedOfferingIds },
        programmeId: course.programmeId,
      },
      select: {
        id: true,
        programmeId: true,
        intake: { select: { gateNumber: true, season: true, year: true } },
      },
      orderBy: [{ intake: { year: 'desc' } }, { intake: { gateNumber: 'asc' } }],
    })
    : [];
  return {
    course,
    offerings,
    offeringIds: offerings.map(({ id }) => id),
    canModerate: user.role.name === 'SUPER_ADMIN' || user.role.name === 'TRAINER',
  };
};

export const resolveDiscussionPostScope = async (postId, user, database = prisma) => {
  const post = await database.courseDiscussionPost.findUnique({
    where: { id: postId },
    select: {
      id: true,
      courseId: true,
      programmeId: true,
      programOfferingId: true,
      lessonId: true,
      parentId: true,
      type: true,
      authorId: true,
      title: true,
      body: true,
      isAnnouncement: true,
      isPinned: true,
      isLocked: true,
      isResolved: true,
      deletedAt: true,
      deletedById: true,
      moderationReason: true,
      createdAt: true,
      updatedAt: true,
      editedAt: true,
    },
  });
  if (!post) return { error: 'NOT_FOUND' };
  const scope = await resolveCourseDiscussionScope(post.courseId, user, database);
  if (scope.error || post.programmeId !== scope.course.programmeId
    || !scope.offeringIds.includes(post.programOfferingId)) {
    return { error: scope.error === 'FORBIDDEN' ? 'FORBIDDEN' : 'NOT_FOUND' };
  }
  return { post, ...scope };
};
