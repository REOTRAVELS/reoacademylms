import { randomUUID } from 'node:crypto';
import prisma from '../config/database.js';
import {
  generateRecurringClassDates,
  parseCohortSchedule,
} from '../utils/liveClassScheduling.js';

const generatedDescriptionPrefixes = [
  'Automatically generated from the cohort timetable (',
  'Automatically generated from the program offering timetable (',
];
const defaultScheduleDurationMs = 12 * 7 * 24 * 60 * 60_000;
let synchronizationQueue = Promise.resolve();

const synchronizeOrdinaryClasses = async (database, { cohortId, offeringId } = {}) => {
  const cohorts = await database.cohort.findMany({
    where: cohortId ? { id: cohortId } : offeringId ? { intakeProgramOfferingId: offeringId } : {},
    include: {
      intakeProgramOffering: {
        select: {
          schedule: true,
          academicStartDate: true,
          academicEndDate: true,
          status: true,
          intake: { select: { timezone: true, status: true } },
        },
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
    const offering = cohort.intakeProgramOffering;
    const timezone = offering?.intake.timezone || 'UTC';
    const scheduleMeta = parseCohortSchedule(offering?.schedule);
    const rangeEnd = offering?.academicEndDate || new Date(now.getTime() + defaultScheduleDurationMs);
    const rangeEndInclusive = offering?.academicEndDate
      ? new Date(rangeEnd.getTime() + 24 * 60 * 60_000 - 1)
      : rangeEnd;
    const occurrences = (
      cohort.status !== 'ARCHIVED'
      && offering?.status === 'ACTIVE'
      && !['COMPLETED', 'ARCHIVED'].includes(offering.intake.status)
      && scheduleMeta.days.length
      && scheduleMeta.startMinutes !== null
    )
      ? generateRecurringClassDates({
        schedule: offering.schedule,
        startDate: offering.academicStartDate && offering.academicStartDate > now
          ? offering.academicStartDate
          : now,
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
          ...generatedDescriptionPrefixes.map((prefix) => ({ description: { startsWith: prefix } })),
          { startsAt: { lte: rangeEndInclusive } },
        ],
      },
      select: { id: true, courseId: true, startsAt: true, status: true, description: true, durationMins: true },
    });
    const activeCourseIds = new Set(cohort.courses.map(({ courseId }) => courseId));
    const obsoleteIds = existingClasses
      .filter(({ courseId, startsAt, status, description, durationMins }) => (
        status === 'SCHEDULED'
        && generatedDescriptionPrefixes.some((prefix) => description?.startsWith(prefix))
        && (
          !activeCourseIds.has(courseId)
          || !occurrenceKeys.has(startsAt.toISOString())
          || scheduleMeta.durationMins !== durationMins
        )
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
          description: `${generatedDescriptionPrefixes[1]}${offering.schedule}).`,
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

const queueSynchronization = (database, filters) => {
  const synchronization = synchronizationQueue.then(() => synchronizeOrdinaryClasses(database, filters));
  synchronizationQueue = synchronization.catch(() => {});
  return synchronization;
};

export const ensureGeneratedOrdinaryClasses = (database = prisma, cohortId) => (
  queueSynchronization(database, cohortId ? { cohortId } : {})
);

export const ensureGeneratedOrdinaryClassesForOffering = (database = prisma, offeringId) => (
  queueSynchronization(database, { offeringId })
);
