import { randomUUID } from 'node:crypto';
import prisma from '../config/database.js';
import { env } from '../config/env.js';
import { ok, fail } from '../utils/response.js';
import { audit } from '../utils/audit.js';
import { canManageLiveClass, findAccessibleLiveClass } from '../utils/liveClassAccess.js';
import { activeProgramCohortForStudent } from '../utils/courseAccess.js';
import { ensureGeneratedOrdinaryClasses } from '../services/cohortTimetable.js';
import {
  findLiveClassConflicts,
  formatLiveClassIcs,
  getJoinTokenTtlSeconds,
  getLiveClassConflictSearchRange,
  isLiveClassJoinable,
} from '../utils/liveClassScheduling.js';
import {
  closeRoom,
  checkRecordingStorage,
  createJoinToken,
  createRecordingKey,
  deleteRecordingObject,
  getRecordingPlaybackUrl,
  getRoomRecordingInfo,
  isLiveKitRecordingConfigured,
  mapEgressRecordingStatus,
  startRoomRecording,
  stopRoomRecording,
} from '../services/liveKitProvider.js';

const classIncludes = {
  course: { select: { id: true, title: true } },
  cohort: { select: { id: true, name: true, timetableFileName: true } },
};

const getManagedClass = async (id, user) => {
  const liveClass = await prisma.liveClass.findUnique({ where: { id } });
  if (!liveClass) return { error: { message: 'Live class not found', statusCode: 404 } };
  if (!(await canManageLiveClass(liveClass, user))) {
    return { error: { message: 'You are not assigned to this live class', statusCode: 403 } };
  }
  return { liveClass };
};

const isValidDate = (value) => value instanceof Date && Number.isFinite(value.getTime());

const elapsedSeconds = (joinedAt, leftAt = new Date()) => (
  Math.max(0, Math.floor((leftAt.getTime() - joinedAt.getTime()) / 1000))
);

const closeActivePresences = async (liveClassId, leftAt) => {
  const presences = await prisma.liveClassPresence.findMany({
    where: { liveClassId, leftAt: null },
    select: { id: true, joinedAt: true, totalDuration: true },
  });
  for (const presence of presences) {
    await prisma.liveClassPresence.update({
      where: { id: presence.id },
      data: {
        leftAt,
        totalDuration: presence.totalDuration + elapsedSeconds(presence.joinedAt, leftAt),
      },
    });
  }
};

const getScheduleConflicts = async (database, { course, cohort, startsAt, durationMins, excludedClassId, createdBy }) => {
  const where = {
    status: { not: 'CANCELLED' },
    startsAt: getLiveClassConflictSearchRange(startsAt, durationMins),
  };
  if (excludedClassId) where.id = { not: excludedClassId };

  const existingClasses = await database.liveClass.findMany({
    where,
    include: {
      course: { include: { trainers: { select: { trainerId: true } } } },
      cohort: {
        include: {
          trainers: { select: { trainerId: true } },
          enrolments: { select: { studentId: true } },
        },
      },
      createdBy: { select: { role: { select: { name: true } } } },
    },
  });
  const candidate = {
    cohortId: cohort.id,
    startsAt,
    durationMins,
    trainerIds: [
      ...course.trainers.map(({ trainerId }) => trainerId),
      ...cohort.trainers.map(({ trainerId }) => trainerId),
      ...(createdBy.role.name === 'TRAINER' ? [createdBy.id] : []),
    ],
    studentIds: cohort.enrolments.map(({ studentId }) => studentId),
  };

  return findLiveClassConflicts(candidate, existingClasses, excludedClassId);
};

export const listLiveClasses = async (req, res) => {
  await ensureGeneratedOrdinaryClasses();
  const role = req.user.role.name;
  const where = role === 'SUPER_ADMIN'
    ? {}
    : role === 'TRAINER'
      ? {
        OR: [
          { createdById: req.user.id },
          { courseId: null, cohortId: null },
          { course: { trainers: { some: { trainerId: req.user.id } } } },
          { cohort: { trainers: { some: { trainerId: req.user.id } } } },
        ],
      }
      : {
        cohort: {
          ...activeProgramCohortForStudent(req.user.id),
        },
      };

  const items = await prisma.liveClass.findMany({
    where,
    include: classIncludes,
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
  });
  return ok(res, items);
};

export const createEmergencyLiveClass = async (req, res) => {
  const {
    title,
    description,
    courseId,
    cohortId,
    durationMins = 45,
  } = req.body || {};
  const duration = Number(durationMins);

  if (typeof title !== 'string' || title.trim().length < 3 || title.trim().length > 120) {
    return fail(res, 'Emergency class title must be between 3 and 120 characters', 400);
  }
  if (description !== undefined && (typeof description !== 'string' || description.length > 2000)) {
    return fail(res, 'Description must be no more than 2000 characters', 400);
  }
  // Course and cohort are optional: an instant class with neither is a staff-only room.
  const emergencyCourseId = typeof courseId === 'string' && courseId ? courseId : null;
  const emergencyCohortId = typeof cohortId === 'string' && cohortId ? cohortId : null;
  if ((courseId && !emergencyCourseId) || (cohortId && !emergencyCohortId)) {
    return fail(res, 'Course and cohort must be valid selections', 400);
  }
  if (!Number.isInteger(duration) || duration < 15 || duration > 480) {
    return fail(res, 'Emergency class duration must be between 15 and 480 minutes', 400);
  }

  const [course, cohort] = await Promise.all([
    emergencyCourseId ? prisma.course.findUnique({ where: { id: emergencyCourseId }, select: { id: true } }) : null,
    emergencyCohortId ? prisma.cohort.findUnique({ where: { id: emergencyCohortId }, select: { id: true } }) : null,
  ]);
  if ((emergencyCourseId && !course) || (emergencyCohortId && !cohort)) {
    return fail(res, 'The selected course or cohort does not exist', 404);
  }

  if (emergencyCourseId && emergencyCohortId) {
    const cohortCourse = await prisma.cohortCourse.findUnique({
      where: { cohortId_courseId: { cohortId: emergencyCohortId, courseId: emergencyCourseId } },
      select: { id: true },
    });
    if (!cohortCourse) return fail(res, 'This course is not assigned to the selected cohort', 400);
  }

  const liveClass = await prisma.liveClass.create({
    data: {
      title: title.trim(),
      description: description?.trim() || null,
      courseId: emergencyCourseId,
      cohortId: emergencyCohortId,
      createdById: req.user.id,
      roomName: `reo-${randomUUID()}`,
      startsAt: new Date(),
      durationMins: duration,
      status: 'LIVE',
      startedAt: new Date(),
    },
    include: classIncludes,
  });

  await audit({
    actorId: req.user.id,
    action: 'CREATE_EMERGENCY_LIVE_CLASS',
    entity: 'LiveClass',
    entityId: liveClass.id,
    ipAddress: req.ip,
  });

  return ok(res, liveClass, 'Emergency live class started', 201);
};

export const createLiveClass = async (req, res) => {
  const {
    title,
    description,
    courseId,
    cohortId,
    startsAt,
    durationMins = 60,
  } = req.body || {};
  const start = typeof startsAt === 'string' ? new Date(startsAt) : null;
  const duration = Number(durationMins);

  if (typeof title !== 'string' || title.trim().length < 3 || title.trim().length > 120) {
    return fail(res, 'Class title must be between 3 and 120 characters', 400);
  }
  if (description !== undefined && (typeof description !== 'string' || description.length > 2000)) {
    return fail(res, 'Description must be no more than 2000 characters', 400);
  }
  if (typeof courseId !== 'string' || !courseId || typeof cohortId !== 'string' || !cohortId) {
    return fail(res, 'Select a course and cohort for this class', 400);
  }
  if (!start || !isValidDate(start)) return fail(res, 'Provide a valid class start time', 400);
  if (!Number.isInteger(duration) || duration < 15 || duration > 480) {
    return fail(res, 'Class duration must be between 15 and 480 minutes', 400);
  }

  const [course, cohort] = await Promise.all([
    prisma.course.findUnique({
      where: { id: courseId },
      include: { trainers: { select: { trainerId: true } } },
    }),
    prisma.cohort.findUnique({
      where: { id: cohortId },
      include: {
        trainers: { select: { trainerId: true } },
        enrolments: { select: { studentId: true } },
      },
    }),
  ]);
  const cohortCourse = await prisma.cohortCourse.findUnique({
    where: { cohortId_courseId: { cohortId, courseId } },
    select: { id: true },
  });
  if (!course || !cohort || !cohortCourse) return fail(res, 'The course is not assigned to the selected cohort', 400);

  if (req.user.role.name === 'TRAINER') {
    const [courseAssignment, cohortAssignment] = await Promise.all([
      prisma.courseTrainer.findUnique({
        where: { courseId_trainerId: { courseId, trainerId: req.user.id } },
        select: { id: true },
      }),
      prisma.cohortTrainer.findUnique({
        where: { cohortId_trainerId: { cohortId, trainerId: req.user.id } },
        select: { id: true },
      }),
    ]);
    if (!courseAssignment && !cohortAssignment) {
      return fail(res, 'You are not assigned to this course or cohort', 403);
    }
  }

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      const conflicts = await getScheduleConflicts(tx, {
        course,
        cohort,
        startsAt: start,
        durationMins: duration,
        createdBy: req.user,
      });
      if (conflicts.length) return { conflicts };
      const liveClass = await tx.liveClass.create({
        data: {
          title: title.trim(),
          description: description?.trim() || null,
          courseId,
          cohortId,
          createdById: req.user.id,
          roomName: `reo-${randomUUID()}`,
          startsAt: start,
          durationMins: duration,
        },
        include: classIncludes,
      });
      return { liveClass };
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (error.code === 'P2034') {
      return fail(res, 'The schedule changed while this class was being created. Check for conflicts and try again.', 409);
    }
    throw error;
  }
  if (result.conflicts) {
    return fail(res, 'This class conflicts with another scheduled class.', 409, result.conflicts);
  }
  const { liveClass } = result;
  await audit({
    actorId: req.user.id,
    action: 'CREATE_LIVE_CLASS',
    entity: 'LiveClass',
    entityId: liveClass.id,
    ipAddress: req.ip,
  });
  return ok(res, liveClass, 'Live class scheduled', 201);
};

export const rescheduleLiveClass = async (req, res) => {
  const managed = await getManagedClass(req.params.id, req.user);
  if (managed.error) return fail(res, managed.error.message, managed.error.statusCode);
  if (managed.liveClass.status !== 'SCHEDULED') {
    return fail(res, 'Only scheduled classes can be rescheduled', 409);
  }
  if (!managed.liveClass.courseId || !managed.liveClass.cohortId) {
    return fail(res, 'This class has no course or cohort timetable to reschedule', 409);
  }

  const startsAt = typeof req.body?.startsAt === 'string' ? new Date(req.body.startsAt) : null;
  const durationMins = Number(req.body?.durationMins ?? managed.liveClass.durationMins);
  if (!startsAt || !isValidDate(startsAt)) return fail(res, 'Provide a valid class start time', 400);
  if (!Number.isInteger(durationMins) || durationMins < 15 || durationMins > 480) {
    return fail(res, 'Class duration must be between 15 and 480 minutes', 400);
  }

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      const [course, cohort] = await Promise.all([
        tx.course.findUnique({
          where: { id: managed.liveClass.courseId },
          include: { trainers: { select: { trainerId: true } } },
        }),
        tx.cohort.findUnique({
          where: { id: managed.liveClass.cohortId },
          include: {
            trainers: { select: { trainerId: true } },
            enrolments: { select: { studentId: true } },
          },
        }),
      ]);
      if (!course || !cohort) return { missing: true };

      const conflicts = await getScheduleConflicts(tx, {
        course,
        cohort,
        startsAt,
        durationMins,
        excludedClassId: managed.liveClass.id,
        createdBy: req.user,
      });
      if (conflicts.length) return { conflicts };

      const update = await tx.liveClass.updateMany({
        where: { id: managed.liveClass.id, status: 'SCHEDULED' },
        data: { startsAt, durationMins },
      });
      if (update.count !== 1) return { changed: true };
      const liveClass = await tx.liveClass.findUnique({
        where: { id: managed.liveClass.id },
        include: classIncludes,
      });
      return { liveClass };
    }, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (error.code === 'P2034') {
      return fail(res, 'The schedule changed while this class was being moved. Check for conflicts and try again.', 409);
    }
    throw error;
  }
  if (result.missing) return fail(res, 'The class course or cohort no longer exists', 409);
  if (result.changed) return fail(res, 'This class has already changed state', 409);
  if (result.conflicts) {
    return fail(res, 'This class conflicts with another scheduled class.', 409, result.conflicts);
  }
  const { liveClass } = result;
  await audit({
    actorId: req.user.id,
    action: 'RESCHEDULE_LIVE_CLASS',
    entity: 'LiveClass',
    entityId: liveClass.id,
    ipAddress: req.ip,
  });
  return ok(res, liveClass, 'Live class rescheduled');
};

export const cancelLiveClass = async (req, res) => {
  const managed = await getManagedClass(req.params.id, req.user);
  if (managed.error) return fail(res, managed.error.message, managed.error.statusCode);
  if (managed.liveClass.status !== 'SCHEDULED') {
    return fail(res, 'Only scheduled classes can be cancelled', 409);
  }

  const result = await prisma.liveClass.updateMany({
    where: { id: managed.liveClass.id, status: 'SCHEDULED' },
    data: { status: 'CANCELLED' },
  });
  if (result.count !== 1) return fail(res, 'This class has already changed state', 409);
  await audit({
    actorId: req.user.id,
    action: 'CANCEL_LIVE_CLASS',
    entity: 'LiveClass',
    entityId: managed.liveClass.id,
    ipAddress: req.ip,
  });
  return ok(res, { id: managed.liveClass.id, status: 'CANCELLED' }, 'Live class cancelled');
};

export const deletePastLiveClass = async (req, res) => {
  const managed = await getManagedClass(req.params.id, req.user);
  if (managed.error) return fail(res, managed.error.message, managed.error.statusCode);

  const { liveClass } = managed;
  const scheduledEnd = liveClass.startsAt.getTime() + liveClass.durationMins * 60_000;
  const isPast = ['ENDED', 'CANCELLED'].includes(liveClass.status)
    || (liveClass.status === 'SCHEDULED' && scheduledEnd <= Date.now());
  if (!isPast) return fail(res, 'Only past classes can be deleted', 409);

  const pendingRecording = await prisma.liveClassRecording.findFirst({
    where: {
      liveClassId: liveClass.id,
      OR: [
        { status: { in: ['STARTING', 'ACTIVE'] } },
        { status: 'STOPPED', endedAt: null },
      ],
    },
    select: { id: true },
  });
  if (pendingRecording) {
    return fail(res, 'Wait for the class recording to finish processing before deleting this class', 409);
  }

  const recordings = await prisma.liveClassRecording.findMany({
    where: { liveClassId: liveClass.id },
    select: { storageKey: true },
  });
  try {
    for (const recording of recordings) await deleteRecordingObject(recording.storageKey);
  } catch (error) {
    console.error('Could not delete live-class recording from storage:', error);
    return fail(res, 'Could not remove the class recordings from storage. The class was not deleted; try again.', 503);
  }

  const deleted = await prisma.liveClass.deleteMany({
    where: { id: liveClass.id, status: liveClass.status },
  });
  if (deleted.count !== 1) return fail(res, 'This class has already changed state', 409);

  await audit({
    actorId: req.user.id,
    action: 'DELETE_PAST_LIVE_CLASS',
    entity: 'LiveClass',
    entityId: liveClass.id,
    metadata: { title: liveClass.title, recordingCount: recordings.length },
    ipAddress: req.ip,
  });
  return ok(res, { id: liveClass.id }, 'Past live class deleted');
};

export const exportLiveClass = async (req, res) => {
  const liveClass = await findAccessibleLiveClass(req.params.id, req.user);
  if (!liveClass) return fail(res, 'Live class not found', 404);
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="live-class-${liveClass.id}.ics"`);
  return res.status(200).send(formatLiveClassIcs(liveClass));
};

export const startLiveClass = async (req, res) => {
  const managed = await getManagedClass(req.params.id, req.user);
  if (managed.error) return fail(res, managed.error.message, managed.error.statusCode);
  if (managed.liveClass.status !== 'SCHEDULED') {
    return fail(res, 'Only scheduled classes can be started', 409);
  }

  const updated = await prisma.liveClass.updateMany({
    where: { id: managed.liveClass.id, status: 'SCHEDULED' },
    data: { status: 'LIVE', startedAt: new Date() },
  });
  if (updated.count !== 1) return fail(res, 'This class has already changed state', 409);
  const liveClass = await prisma.liveClass.findUnique({
    where: { id: managed.liveClass.id },
    include: classIncludes,
  });
  return ok(res, liveClass, 'Live class started');
};

export const joinLiveClass = async (req, res) => {
  const liveClass = await findAccessibleLiveClass(req.params.id, req.user);
  if (!liveClass) return fail(res, 'Live class not found', 404);
  if (!isLiveClassJoinable(liveClass)) return fail(res, 'This class is not currently joinable', 409);

  const canPublish = req.user.role.name === 'SUPER_ADMIN' || req.user.role.name === 'TRAINER';
  const credentials = await createJoinToken({
    roomName: liveClass.roomName,
    user: req.user,
    canPublish,
    ttlSeconds: getJoinTokenTtlSeconds(liveClass),
  });

  const now = new Date();
  const activePresence = await prisma.liveClassPresence.findFirst({
    where: { liveClassId: liveClass.id, userId: req.user.id, leftAt: null },
    select: { id: true },
  });
  if (!activePresence) {
    const previousPresence = await prisma.liveClassPresence.findFirst({
      where: { liveClassId: liveClass.id, userId: req.user.id },
      orderBy: [{ joinedAt: 'desc' }, { id: 'desc' }],
      select: { id: true, rejoinCount: true, leftAt: true, disconnectionDuration: true },
    });
    if (previousPresence?.leftAt) {
      await prisma.liveClassPresence.update({
        where: { id: previousPresence.id },
        data: {
          disconnectionDuration: previousPresence.disconnectionDuration
            + elapsedSeconds(previousPresence.leftAt, now),
        },
      });
    }
    await prisma.liveClassPresence.create({
      data: {
        liveClassId: liveClass.id,
        userId: req.user.id,
        joinedAt: now,
        rejoinCount: previousPresence ? previousPresence.rejoinCount + 1 : 0,
        isTrainer: canPublish,
      },
    });
  }
  return ok(res, credentials, 'Joined live class');
};

export const leaveLiveClass = async (req, res) => {
  const liveClass = await findAccessibleLiveClass(req.params.id, req.user);
  if (!liveClass) return fail(res, 'Live class not found', 404);
  const presence = await prisma.liveClassPresence.findFirst({
    where: { liveClassId: liveClass.id, userId: req.user.id, leftAt: null },
    orderBy: [{ joinedAt: 'desc' }, { id: 'desc' }],
    select: { id: true, joinedAt: true, totalDuration: true },
  });
  if (!presence) return ok(res, null, 'Attendance session already closed');

  const leftAt = new Date();
  const duration = elapsedSeconds(presence.joinedAt, leftAt);
  const updated = await prisma.liveClassPresence.update({
    where: { id: presence.id },
    data: {
      leftAt,
      totalDuration: presence.totalDuration + duration,
    },
  });
  return ok(res, updated, 'Attendance session closed');
};

export const endLiveClass = async (req, res) => {
  const managed = await getManagedClass(req.params.id, req.user);
  if (managed.error) return fail(res, managed.error.message, managed.error.statusCode);
  if (managed.liveClass.status !== 'LIVE') return fail(res, 'Only live classes can be ended', 409);

  await closeRoom(managed.liveClass.roomName);
  const endedAt = new Date();
  const updated = await prisma.liveClass.updateMany({
    where: { id: managed.liveClass.id, status: 'LIVE' },
    data: { status: 'ENDED', endedAt },
  });
  if (updated.count !== 1) return fail(res, 'This class has already changed state', 409);
  await closeActivePresences(managed.liveClass.id, endedAt);
  const liveClass = await prisma.liveClass.findUnique({
    where: { id: managed.liveClass.id },
    include: classIncludes,
  });
  return ok(res, liveClass, 'Live class ended');
};

const getAccessibleClass = async (liveClassId, user) => {
  const liveClass = await findAccessibleLiveClass(liveClassId, user);
  return liveClass;
};

const recordingFields = {
  id: true,
  status: true,
  consentNotice: true,
  startedAt: true,
  endedAt: true,
  createdAt: true,
};

const syncRecordingStatus = async (recording) => {
  if (!['STARTING', 'ACTIVE', 'STOPPED'].includes(recording.status)
    || (recording.status === 'STOPPED' && recording.endedAt)) return recording;
  const egress = await getRoomRecordingInfo(recording.egressId);
  const status = mapEgressRecordingStatus(egress?.status);
  if (!status) return recording;

  const progress = { STARTING: 0, ACTIVE: 1, STOPPED: 2, COMPLETE: 3, FAILED: 3 };
  if (['COMPLETE', 'FAILED'].includes(recording.status) || progress[status] < progress[recording.status]) {
    return recording;
  }
  const data = {};
  if (status !== recording.status) data.status = status;
  if (['COMPLETE', 'FAILED'].includes(status) && !recording.endedAt) data.endedAt = new Date();
  if (!Object.keys(data).length) return recording;

  const updated = await prisma.liveClassRecording.update({
    where: { id: recording.id },
    data,
    select: recordingFields,
  });
  return { ...recording, ...updated };
};

export const startRecording = async (req, res) => {
  const managed = await getManagedClass(req.params.id, req.user);
  if (managed.error) return fail(res, managed.error.message, managed.error.statusCode);
  if (managed.liveClass.status !== 'LIVE') return fail(res, 'Recording is available only during a live class', 409);
  if (req.body?.consentConfirmed !== true) {
    return fail(res, 'Confirm that participants were informed and consented before recording', 400);
  }
  if (!isLiveKitRecordingConfigured()) {
    return fail(res, 'LiveKit recording and private storage are not configured', 503);
  }
  try {
    await checkRecordingStorage();
  } catch (error) {
    console.error('Live-class recording storage check failed:', error);
    return fail(res, 'Recording storage is unavailable. Check the MinIO endpoint, bucket, and access credentials.', 503);
  }
  const active = await prisma.liveClassRecording.findFirst({
    where: {
      liveClassId: managed.liveClass.id,
      OR: [
        { status: { in: ['STARTING', 'ACTIVE'] } },
        { status: 'STOPPED', endedAt: null },
      ],
    },
    select: { id: true },
  });
  if (active) return fail(res, 'A recording is already in progress', 409);

  const storageKey = createRecordingKey(managed.liveClass.id);
  const egress = await startRoomRecording(managed.liveClass.roomName, storageKey);
  let recording;
  try {
    recording = await prisma.liveClassRecording.create({
      data: {
        liveClassId: managed.liveClass.id,
        startedById: req.user.id,
        egressId: egress.egressId,
        storageKey,
        status: 'STARTING',
        consentNotice: 'The class host confirmed that participants were informed and consented to recording.',
      },
      select: recordingFields,
    });
  } catch (error) {
    try {
      await stopRoomRecording(egress.egressId);
    } catch (stopError) {
      console.error('Could not stop untracked LiveKit recording after database failure:', stopError);
    }
    throw error;
  }

  await audit({
    actorId: req.user.id,
    action: 'START_LIVE_CLASS_RECORDING',
    entity: 'LiveClassRecording',
    entityId: recording.id,
    ipAddress: req.ip,
  });
  return ok(res, recording, 'Recording started', 201);
};

export const listRecordings = async (req, res) => {
  const liveClass = await getAccessibleClass(req.params.id, req.user);
  if (!liveClass) return fail(res, 'Live class not found', 404);
  const recordings = await prisma.liveClassRecording.findMany({
    where: { liveClassId: liveClass.id },
    select: { ...recordingFields, egressId: true, storageKey: true },
    orderBy: { createdAt: 'desc' },
  });
  const current = await Promise.all(recordings.map(syncRecordingStatus));
  return ok(res, current.map(({ egressId, storageKey, ...recording }) => recording));
};

export const stopRecording = async (req, res) => {
  const managed = await getManagedClass(req.params.id, req.user);
  if (managed.error) return fail(res, managed.error.message, managed.error.statusCode);
  const recording = await prisma.liveClassRecording.findFirst({
    where: { id: req.params.recordingId, liveClassId: managed.liveClass.id },
  });
  if (!recording) return fail(res, 'Recording not found', 404);
  if (recording.status === 'STOPPED' && !recording.endedAt) {
    return ok(res, await syncRecordingStatus(recording), 'Recording is finishing');
  }
  if (!['STARTING', 'ACTIVE'].includes(recording.status)) {
    return fail(res, 'This recording is no longer active', 409);
  }
  await stopRoomRecording(recording.egressId);
  const updated = await prisma.liveClassRecording.update({
    where: { id: recording.id },
    data: { status: 'STOPPED' },
    select: recordingFields,
  });
  await audit({
    actorId: req.user.id,
    action: 'STOP_LIVE_CLASS_RECORDING',
    entity: 'LiveClassRecording',
    entityId: recording.id,
    ipAddress: req.ip,
  });
  return ok(res, await syncRecordingStatus({ ...recording, ...updated }), 'Recording is finishing');
};

export const getRecordingPlayback = async (req, res) => {
  if (
    Object.keys(req.query || {}).some((key) => key !== 'download')
    || (req.query?.download !== undefined && !['true', 'false'].includes(req.query.download))
  ) return fail(res, 'Invalid recording playback options', 400);

  let recording = await prisma.liveClassRecording.findUnique({
    where: { id: req.params.recordingId },
    select: { id: true, liveClassId: true, storageKey: true, status: true, egressId: true, endedAt: true },
  });
  if (!recording) return fail(res, 'Recording not found', 404);
  const liveClass = await getAccessibleClass(recording.liveClassId, req.user);
  if (!liveClass) return fail(res, 'Recording not found', 404);
  recording = await syncRecordingStatus(recording);
  if (recording.status !== 'COMPLETE') return fail(res, 'Recording is not ready for playback', 409);
  const playbackUrl = await getRecordingPlaybackUrl(
    recording.storageKey,
    { download: req.query?.download === 'true' },
  );
  return ok(res, { playbackUrl, expiresInSeconds: 300 });
};

const parseLimit = (value) => {
  if (value === undefined) return 50;
  const limit = Number(value);
  return Number.isInteger(limit) && limit >= 1 ? Math.min(limit, 100) : null;
};

const makeCursorQuery = (cursor, limit, orderBy) => ({
  ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  orderBy,
  take: limit + 1,
});

const durationForPresence = (presence, now) => (
  presence.totalDuration || elapsedSeconds(presence.joinedAt, presence.leftAt || now)
);

const attendanceClassification = (presence, durationSeconds, liveClass, thresholdPercent) => {
  if (presence.verifiedAt) return 'Verified';
  if (liveClass.status === 'LIVE' && !presence.leftAt) return 'Under Review';
  const expectedSeconds = liveClass.durationMins * 60;
  if (expectedSeconds > 0 && durationSeconds >= expectedSeconds * thresholdPercent / 100) return 'Present';
  if (durationSeconds > 0) return 'Partial Attendance';
  return 'Absent';
};

export const getClassReport = async (req, res) => {
  const managed = await getManagedClass(req.params.id, req.user);
  if (managed.error) return fail(res, managed.error.message, managed.error.statusCode);

  const limit = parseLimit(req.query.limit);
  if (!limit) return fail(res, 'Report limit must be a positive integer', 400);
  for (const cursorKey of ['attendanceCursor', 'interactionCursor']) {
    const cursor = req.query[cursorKey];
    if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length < 1 || cursor.length > 191)) {
      return fail(res, `Invalid ${cursorKey}`, 400);
    }
  }
  const [liveClass, registered, attendeeIds, engagementGroups, attendanceRows, interactionRows] = await Promise.all([
    prisma.liveClass.findUnique({
      where: { id: managed.liveClass.id },
      include: classIncludes,
    }),
    managed.liveClass.cohortId
      ? prisma.enrolment.count({ where: { cohortId: managed.liveClass.cohortId } })
      : Promise.resolve(0),
    prisma.liveClassPresence.findMany({
      where: { liveClassId: managed.liveClass.id, OR: [{ totalDuration: { gt: 0 } }, { leftAt: null }] },
      select: { userId: true },
      distinct: ['userId'],
    }),
    prisma.liveClassEngagement.groupBy({
      by: ['type'],
      where: { liveClassId: managed.liveClass.id },
      _count: { _all: true },
    }),
    prisma.liveClassPresence.findMany({
      where: { liveClassId: managed.liveClass.id },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        verifiedBy: { select: { firstName: true, lastName: true } },
        corrections: {
          include: { correctedBy: { select: { id: true, firstName: true, lastName: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
      ...makeCursorQuery(req.query.attendanceCursor, limit, [{ joinedAt: 'asc' }, { id: 'asc' }]),
    }),
    prisma.liveClassInteraction.findMany({
      where: { liveClassId: managed.liveClass.id },
      include: {
        sender: { select: { id: true, firstName: true, lastName: true } },
      },
      ...makeCursorQuery(req.query.interactionCursor, limit, [{ createdAt: 'asc' }, { id: 'asc' }]),
    }),
  ]);
  if (!liveClass) return fail(res, 'Live class not found', 404);

  const now = new Date();
  const attendancePage = attendanceRows.slice(0, limit);
  const interactionPage = interactionRows.slice(0, limit);
  const attendance = attendancePage.map((presence) => {
    const durationSeconds = durationForPresence(presence, now);
    return {
      ...presence,
      durationSeconds,
      classification: attendanceClassification(
        presence,
        durationSeconds,
        liveClass,
        env.attendanceThresholdPercent,
      ),
    };
  });
  const engagement = Object.fromEntries(engagementGroups.map(({ type, _count }) => [type, _count._all]));

  return ok(res, {
    liveClass,
    participants: {
      registered,
      attended: attendeeIds.length,
      attendance,
      nextCursor: attendanceRows.length > limit ? attendancePage.at(-1)?.id || null : null,
    },
    interactions: {
      items: interactionPage,
      nextCursor: interactionRows.length > limit ? interactionPage.at(-1)?.id || null : null,
    },
    engagement,
  });
};

export const verifyPresence = async (req, res) => {
  const managed = await getManagedClass(req.params.id, req.user);
  if (managed.error) return fail(res, managed.error.message, managed.error.statusCode);
  const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
  if (note.length < 3 || note.length > 500) return fail(res, 'Verification note must be between 3 and 500 characters', 400);
  const presence = await prisma.liveClassPresence.findFirst({
    where: { id: req.params.presenceId, liveClassId: managed.liveClass.id },
    select: { id: true },
  });
  if (!presence) return fail(res, 'Attendance record not found', 404);
  const updated = await prisma.liveClassPresence.update({
    where: { id: presence.id },
    data: {
      verifiedAt: new Date(),
      verifiedById: req.user.id,
      verificationNote: note,
    },
    include: {
      user: { select: { id: true, firstName: true, lastName: true } },
      verifiedBy: { select: { firstName: true, lastName: true } },
    },
  });
  await audit({
    actorId: req.user.id,
    action: 'VERIFY_LIVE_CLASS_ATTENDANCE',
    entity: 'LiveClassPresence',
    entityId: presence.id,
    metadata: { note },
    ipAddress: req.ip,
  });
  return ok(res, updated, 'Attendance verified');
};

export const correctPresence = async (req, res) => {
  const managed = await getManagedClass(req.params.id, req.user);
  if (managed.error) return fail(res, managed.error.message, managed.error.statusCode);
  const joinedAt = new Date(req.body?.joinedAt);
  const leftAt = new Date(req.body?.leftAt);
  const reason = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
  if (!isValidDate(joinedAt) || !isValidDate(leftAt) || leftAt <= joinedAt) {
    return fail(res, 'Provide a valid attendance interval with a leave time after the join time', 400);
  }
  if (reason.length < 3 || reason.length > 500) return fail(res, 'Correction reason must be between 3 and 500 characters', 400);

  const presence = await prisma.liveClassPresence.findFirst({
    where: { id: req.params.presenceId, liveClassId: managed.liveClass.id },
  });
  if (!presence) return fail(res, 'Attendance record not found', 404);
  const correctedDuration = elapsedSeconds(joinedAt, leftAt);
  const corrections = [];
  if (joinedAt.getTime() !== presence.joinedAt.getTime()) {
    corrections.push({
      type: 'JOIN_TIME',
      originalValue: presence.joinedAt.toISOString(),
      correctedValue: joinedAt.toISOString(),
    });
  }
  if (leftAt.getTime() !== presence.leftAt?.getTime()) {
    corrections.push({
      type: 'LEAVE_TIME',
      originalValue: presence.leftAt?.toISOString() || '',
      correctedValue: leftAt.toISOString(),
    });
  }
  if (correctedDuration !== presence.totalDuration) {
    corrections.push({
      type: 'DURATION',
      originalValue: String(presence.totalDuration),
      correctedValue: String(correctedDuration),
    });
  }
  if (!corrections.length) return fail(res, 'The correction does not change this attendance record', 400);

  const updatedPresence = await prisma.$transaction(async (transaction) => {
    const createdCorrections = [];
    for (const correction of corrections) {
      createdCorrections.push(await transaction.liveClassCorrection.create({
        data: {
          liveClassId: managed.liveClass.id,
          presenceId: presence.id,
          correctedById: req.user.id,
          reason,
          ...correction,
        },
      }));
    }
    return transaction.liveClassPresence.update({
      where: { id: presence.id },
      data: {
        joinedAt,
        leftAt,
        totalDuration: correctedDuration,
        attendanceCorrectionId: createdCorrections.at(-1).id,
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
        corrections: { orderBy: { createdAt: 'desc' } },
      },
    });
  });
  await audit({
    actorId: req.user.id,
    action: 'CORRECT_LIVE_CLASS_ATTENDANCE',
    entity: 'LiveClassPresence',
    entityId: presence.id,
    metadata: { reason, correctionTypes: corrections.map(({ type }) => type) },
    ipAddress: req.ip,
  });
  return ok(res, updatedPresence, 'Attendance corrected');
};
