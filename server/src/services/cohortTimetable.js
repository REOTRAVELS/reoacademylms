import { randomUUID } from 'node:crypto';
import prisma from '../config/database.js';
import {
  generateRecurringClassDates,
  parseCohortSchedule,
} from '../utils/liveClassScheduling.js';

const generatedDescriptionPrefix = 'Automatically generated from the cohort timetable (';
const defaultScheduleDurationMs = 12 * 7 * 24 * 60 * 60_000;
let synchronizationQueue = Promise.resolve();

const synchronizeOrdinaryClasses = async (database, cohortId) => {
  const cohorts = await database.cohort.findMany({
    where: cohortId ? { id: cohortId } : {},
    include: {
      intakeProgramOffering: {
        select: { intake: { select: { timezone: true } } },
      },
      courses: {
        include: {
          course: { include: { trainers: { select: { trainerId: true } } } },
        },
      },
      trainers: { select: { trainerId: true } },
    },
  });

  for (const cohort of cohorts) {
    const now = new Date();
    const timezone = cohort.intakeProgramOffering?.intake.timezone || 'UTC';
    const scheduleMeta = parseCohortSchedule(cohort.schedule);
    const rangeEnd = cohort.endDate || new Date(now.getTime() + defaultScheduleDurationMs);
    const rangeEndInclusive = cohort.endDate
      ? new Date(rangeEnd.getTime() + 24 * 60 * 60_000 - 1)
      : rangeEnd;
    const occurrences = cohort.status !== 'ARCHIVED' && scheduleMeta.days.length && scheduleMeta.startMinutes !== null
      ? generateRecurringClassDates({
        schedule: cohort.schedule,
        startDate: cohort.startDate && cohort.startDate > now ? cohort.startDate : now,
        endDate: rangeEnd,
        timezone,
      })
      : [];
    const occurrenceKeys = new Set(occurrences.map((date) => date.toISOString()));

    const existingClasses = await database.liveClass.findMany({
      where: {
        cohortId: cohort.id,
        courseId: { not: null },
        status: { not: 'CANCELLED' },
        startsAt: { gte: now },
        OR: [
          { description: { startsWith: generatedDescriptionPrefix } },
          { startsAt: { lte: rangeEndInclusive } },
        ],
      },
      select: { id: true, courseId: true, startsAt: true, status: true, description: true },
    });
    const activeCourseIds = new Set(cohort.courses.map(({ courseId }) => courseId));
    const obsoleteIds = existingClasses
      .filter(({ courseId, startsAt, status, description }) => (
        status === 'SCHEDULED'
        && description?.startsWith(generatedDescriptionPrefix)
        && (!activeCourseIds.has(courseId) || !occurrenceKeys.has(startsAt.toISOString()))
      ))
      .map(({ id }) => id);
    if (obsoleteIds.length) {
      await database.liveClass.updateMany({
        where: { id: { in: obsoleteIds } },
        data: { status: 'CANCELLED' },
      });
    }

    if (!occurrences.length || !cohort.courses.length) continue;

    const trainerCandidates = [
      ...cohort.trainers.map(({ trainerId }) => trainerId),
      ...cohort.courses.flatMap(({ course }) => course.trainers.map(({ trainerId }) => trainerId)),
    ];
    const createdBy = await database.user.findFirst({
      where: trainerCandidates.length
        ? { id: { in: trainerCandidates } }
        : { role: { name: 'SUPER_ADMIN' } },
      select: { id: true },
    });
    if (!createdBy) continue;

    const existingKeys = new Set(existingClasses.map(({ courseId, startsAt }) => (
      `${courseId}:${startsAt.toISOString()}`
    )));
    const missingClasses = [];
    for (const courseAssignment of cohort.courses) {
      const course = courseAssignment.course;
      for (const startsAt of occurrences) {
        const key = `${course.id}:${startsAt.toISOString()}`;
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);
        missingClasses.push({
          courseId: course.id,
          cohortId: cohort.id,
          createdById: createdBy.id,
          title: `${course.title} · ${cohort.name}`,
          description: `${generatedDescriptionPrefix}${cohort.schedule}).`,
          roomName: `reo-${randomUUID()}`,
          startsAt,
          durationMins: scheduleMeta.durationMins || 60,
        });
      }
    }
    if (missingClasses.length) {
      await database.liveClass.createMany({ data: missingClasses });
    }
  }
};

export const ensureGeneratedOrdinaryClasses = (database = prisma, cohortId) => {
  const synchronization = synchronizationQueue.then(() => synchronizeOrdinaryClasses(database, cohortId));
  synchronizationQueue = synchronization.catch(() => {});
  return synchronization;
};
