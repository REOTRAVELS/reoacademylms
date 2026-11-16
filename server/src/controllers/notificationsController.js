import prisma from '../config/database.js';
import { ok, fail } from '../utils/response.js';
import { audit } from '../utils/audit.js';
import { activeProgramCohortForStudent } from '../utils/courseAccess.js';
import {
  announcementAudienceFilter,
  MAX_ANNOUNCEMENT_BODY_LENGTH,
  MAX_ANNOUNCEMENT_TITLE_LENGTH,
  normalizeAttendanceRecords,
  parseAttendanceDate,
  parseListOptions,
  parseOptionalId,
  restrictProgrammeAudienceToCohorts,
  studentNotificationAudienceWhere,
} from '../utils/notificationPolicies.js';

const cursorExistsInScope = async (model, where, pagination) => {
  if (!pagination.cursor) return true;
  const cursor = await model.findFirst({
    where: { ...where, id: pagination.cursor.id },
    select: { id: true },
  });
  return Boolean(cursor);
};

const notificationScope = (req) => (
  req.user.role.name === 'STUDENT'
    ? studentNotificationAudienceWhere(req.activeProgramEnrollment)
    : { audienceStatus: 'CLASSIFIED' }
);

export const listNotifications = async (req, res) => {
  const pagination = parseListOptions(req.query);
  if (!pagination) return fail(res, 'Invalid pagination options', 400);
  const where = { userId: req.user.id, ...notificationScope(req) };
  if (!await cursorExistsInScope(prisma.notification, where, pagination)) {
    return fail(res, 'Invalid notification cursor', 400);
  }
  const items = await prisma.notification.findMany({
    where,
    select: {
      id: true,
      userId: true,
      programmeId: true,
      programOfferingId: true,
      isGlobal: true,
      audienceStatus: true,
      type: true,
      title: true,
      body: true,
      read: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    ...pagination,
  });
  return ok(res, items);
};

export const unreadNotificationCount = async (req, res) => {
  const count = await prisma.notification.count({
    where: { userId: req.user.id, read: false, ...notificationScope(req) },
  });
  return ok(res, { count });
};

export const markRead = async (req, res) => {
  const notificationId = parseOptionalId(req.params.id);
  if (!notificationId) return fail(res, 'Invalid notification id', 400);
  await prisma.notification.updateMany({
    where: { userId: req.user.id, id: notificationId, ...notificationScope(req) },
    data: { read: true },
  });
  return ok(res, null, 'Updated');
};

export const markAllRead = async (req, res) => {
  await prisma.notification.updateMany({
    where: { userId: req.user.id, ...notificationScope(req) },
    data: { read: true },
  });
  return ok(res, null, 'Updated');
};

const classificationSnapshot = (notification) => ({
  audienceStatus: notification.audienceStatus,
  isGlobal: notification.isGlobal,
  programmeId: notification.programmeId,
  programOfferingId: notification.programOfferingId,
});

export const listLegacyNotifications = async (req, res) => {
  const pagination = parseListOptions(req.query, 25);
  const status = req.query.status || 'UNCLASSIFIED';
  if (!pagination || !['UNCLASSIFIED', 'CLASSIFIED', 'ARCHIVED', 'ALL'].includes(status)) {
    return fail(res, 'Invalid notification classification filter or pagination options', 400);
  }
  const where = status === 'ALL' ? {} : { audienceStatus: status };
  if (!await cursorExistsInScope(prisma.notification, where, pagination)) {
    return fail(res, 'Invalid notification cursor', 400);
  }
  const items = await prisma.notification.findMany({
    where,
    select: {
      id: true,
      userId: true,
      programmeId: true,
      programOfferingId: true,
      isGlobal: true,
      audienceStatus: true,
      type: true,
      title: true,
      body: true,
      read: true,
      createdAt: true,
      user: { select: { id: true, firstName: true, lastName: true, email: true } },
      classificationHistory: {
        select: {
          id: true,
          previousClassification: true,
          newClassification: true,
          changedAt: true,
          changedBy: { select: { firstName: true, lastName: true } },
        },
        orderBy: { changedAt: 'asc' },
      },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    ...pagination,
  });
  return ok(res, {
    items,
    nextCursor: items.length === pagination.take ? items.at(-1).id : null,
  });
};

export const listNotificationClassificationOptions = async (_req, res) => {
  const [programmes, offerings] = await Promise.all([
    prisma.programme.findMany({
      select: { id: true, title: true, status: true },
      orderBy: [{ title: 'asc' }, { id: 'asc' }],
    }),
    prisma.intakeProgramOffering.findMany({
      select: {
        id: true,
        programmeId: true,
        intakeId: true,
        status: true,
        programme: { select: { id: true, title: true } },
        intake: { select: { id: true, gateNumber: true, season: true, year: true, status: true } },
      },
      orderBy: [{ intake: { year: 'desc' } }, { intake: { gateNumber: 'asc' } }],
    }),
  ]);
  return ok(res, { programmes, offerings });
};

class ClassificationConflictError extends Error {}

export const classifyLegacyNotification = async (req, res) => {
  const { audienceType } = req.body || {};
  const allowedFields = {
    GLOBAL: ['audienceType'],
    PROGRAMME: ['audienceType', 'programmeId'],
    OFFERING: ['audienceType', 'programOfferingId'],
    ARCHIVED: ['audienceType'],
  };
  if (
    !Object.hasOwn(allowedFields, audienceType)
    || Object.keys(req.body || {}).some((key) => !allowedFields[audienceType].includes(key))
  ) return fail(res, 'Choose a valid notification audience and only its required identifier', 400);

  const programmeId = audienceType === 'PROGRAMME' ? parseOptionalId(req.body.programmeId) : null;
  const programOfferingId = audienceType === 'OFFERING' ? parseOptionalId(req.body.programOfferingId) : null;
  if (
    (audienceType === 'PROGRAMME' && !programmeId)
    || (audienceType === 'OFFERING' && !programOfferingId)
  ) return fail(res, 'A Program or Program Offering is required for this audience', 400);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.notification.findUnique({
        where: { id: req.params.id },
        select: {
          id: true,
          audienceStatus: true,
          isGlobal: true,
          programmeId: true,
          programOfferingId: true,
        },
      });
      if (!current) return { error: 'Notification not found', status: 404 };

      let nextProgrammeId = null;
      let nextProgramOfferingId = null;
      let isGlobal = false;
      let audienceStatus = 'CLASSIFIED';
      if (audienceType === 'GLOBAL') {
        isGlobal = true;
      } else if (audienceType === 'PROGRAMME') {
        const programme = await tx.programme.findUnique({
          where: { id: programmeId },
          select: { id: true },
        });
        if (!programme) return { error: 'Program not found', status: 404 };
        nextProgrammeId = programme.id;
      } else if (audienceType === 'OFFERING') {
        const offering = await tx.intakeProgramOffering.findUnique({
          where: { id: programOfferingId },
          select: { id: true, programmeId: true },
        });
        if (!offering) return { error: 'Program Offering not found', status: 404 };
        nextProgrammeId = offering.programmeId;
        nextProgramOfferingId = offering.id;
      } else {
        audienceStatus = 'ARCHIVED';
      }

      const nextClassification = {
        audienceStatus,
        isGlobal,
        programmeId: nextProgrammeId,
        programOfferingId: nextProgramOfferingId,
      };
      const update = await tx.notification.updateMany({
        where: {
          id: current.id,
          audienceStatus: current.audienceStatus,
          isGlobal: current.isGlobal,
          programmeId: current.programmeId,
          programOfferingId: current.programOfferingId,
        },
        data: nextClassification,
      });
      if (update.count !== 1) throw new ClassificationConflictError('Notification classification changed concurrently');
      const history = await tx.notificationClassificationHistory.create({
        data: {
          notificationId: current.id,
          changedById: req.user.id,
          previousClassification: classificationSnapshot(current),
          newClassification: nextClassification,
        },
      });
      return { notificationId: current.id, classification: nextClassification, history };
    });
    if (result.error) return fail(res, result.error, result.status);
    return ok(res, result, 'Notification audience recorded');
  } catch (error) {
    if (error instanceof ClassificationConflictError) {
      return fail(res, error.message, 409);
    }
    throw error;
  }
};

// Announcements
export const listAnnouncements = async (req, res) => {
  const pagination = parseListOptions(req.query);
  const programmeId = parseOptionalId(req.query.programmeId);
  const cohortId = parseOptionalId(req.query.cohortId);
  const courseId = parseOptionalId(req.query.courseId);
  if (!pagination || programmeId === undefined || cohortId === undefined || courseId === undefined) {
    return fail(res, 'Invalid announcement filters or pagination options', 400);
  }

  const where = {};
  if (req.user.role.name === 'TRAINER') {
    const [courseAssignments, cohortAssignments] = await Promise.all([
      prisma.courseTrainer.findMany({ where: { trainerId: req.user.id }, select: { courseId: true } }),
      prisma.cohortTrainer.findMany({ where: { trainerId: req.user.id }, select: { cohortId: true, cohort: { select: { programmeId: true } } } }),
    ]);
    const courseIds = courseAssignments.map(({ courseId }) => courseId);
    const cohortIds = cohortAssignments.map(({ cohortId }) => cohortId);
    const programmeIds = [...new Set(cohortAssignments.map(({ cohort }) => cohort.programmeId))];
    where.OR = [
      { courseId: { in: courseIds } },
      { cohortId: { in: cohortIds } },
      { programmeId: { in: programmeIds }, cohortId: null, courseId: null },
      { programmeId: null, cohortId: null, courseId: null },
    ];
  } else if (req.user.role.name === 'STUDENT') {
    const programEnrollments = await prisma.programEnrollment.findMany({
      where: { studentId: req.user.id, status: 'ACTIVE' },
      select: { programmeId: true, programOfferingId: true },
    });
    const programmeIds = [...new Set(programEnrollments.map(({ programmeId: id }) => id))];
    const programOfferingIds = programEnrollments.map(({ programOfferingId }) => programOfferingId);
    const enrolments = await prisma.enrolment.findMany({
      where: {
        studentId: req.user.id,
        cohort: {
          programme: { id: { in: programmeIds } },
          intakeProgramOfferingId: { in: programOfferingIds },
        },
      },
      select: {
        cohortId: true,
        cohort: {
          select: {
            courses: {
              where: {
                course: {
                  status: 'PUBLISHED',
                  OR: [{ programmeId: null }, { programmeId: { in: programmeIds } }],
                },
              },
              select: { courseId: true },
            },
          },
        },
      },
    });
    const cohortIds = enrolments.map(({ cohortId }) => cohortId);
    const courseIds = [...new Set(
      enrolments.flatMap(({ cohort }) => cohort.courses.map(({ courseId }) => courseId)),
    )];
    where.OR = [
      { courseId: { in: courseIds } },
      { cohortId: { in: cohortIds } },
      { programmeId: { in: programmeIds }, cohortId: null, courseId: null },
      { programmeId: null, cohortId: null, courseId: null },
    ];
  } else if (req.user.role.name !== 'SUPER_ADMIN') {
    return fail(res, 'Forbidden', 403);
  }
  if (programmeId) where.programmeId = programmeId;
  if (cohortId) where.cohortId = cohortId;
  if (courseId) where.courseId = courseId;
  if (!await cursorExistsInScope(prisma.announcement, where, pagination)) {
    return fail(res, 'Invalid announcement cursor', 400);
  }
  const announcements = await prisma.announcement.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: {
      author: { select: { firstName: true, lastName: true } },
    },
    ...pagination,
  });
  return ok(res, announcements);
};

export const createAnnouncement = async (req, res) => {
  const { title, body, programmeId, cohortId, courseId } = req.body || {};
  if (
    typeof title !== 'string'
    || typeof body !== 'string'
    || !title.trim()
    || !body.trim()
    || title.trim().length > MAX_ANNOUNCEMENT_TITLE_LENGTH
    || body.trim().length > MAX_ANNOUNCEMENT_BODY_LENGTH
  ) return fail(res, 'Title and body are required and must be within the allowed length', 400);

  const targetIds = [programmeId, cohortId, courseId].map(parseOptionalId);
  if (targetIds.includes(undefined) || targetIds.filter(Boolean).length > 1) {
    return fail(res, 'Choose at most one valid announcement audience', 400);
  }
  const [targetProgrammeId, targetCohortId, targetCourseId] = targetIds;
  let trainerProgrammeCohortIds = [];
  let targetCourseProgrammeId = null;
  if (targetCourseId) {
    const course = await prisma.course.findUnique({
      where: { id: targetCourseId },
      select: { id: true, programmeId: true },
    });
    if (!course) return fail(res, 'Course not found', 404);
    targetCourseProgrammeId = course.programmeId;
  }

  if (req.user.role.name === 'TRAINER') {
    const assignedCourse = targetCourseId && await prisma.courseTrainer.findUnique({
      where: { courseId_trainerId: { courseId: targetCourseId, trainerId: req.user.id } },
      select: { id: true },
    });
    const assignedCohort = targetCohortId && await prisma.cohortTrainer.findUnique({
      where: { cohortId_trainerId: { cohortId: targetCohortId, trainerId: req.user.id } },
      select: { id: true },
    });
    if ((targetCourseId && !assignedCourse) || (targetCohortId && !assignedCohort)) {
      return fail(res, 'You are not assigned to the selected course or cohort', 403);
    }
    if (targetProgrammeId) {
      const assignedProgramme = await prisma.cohortTrainer.findMany({
        where: { trainerId: req.user.id, cohort: { programmeId: targetProgrammeId } },
        select: { cohortId: true },
      });
      if (!assignedProgramme.length) return fail(res, 'You are not assigned to this programme', 403);
      trainerProgrammeCohortIds = assignedProgramme.map(({ cohortId: assignedCohortId }) => assignedCohortId);
    }
    if (!targetProgrammeId && !targetCourseId && !targetCohortId) {
      return fail(res, 'Select an assigned course, cohort, or programme', 400);
    }
  } else {
    if (targetProgrammeId) {
      const programme = await prisma.programme.findUnique({ where: { id: targetProgrammeId }, select: { id: true } });
      if (!programme) return fail(res, 'Programme not found', 404);
    }
    if (targetCohortId) {
      const cohort = await prisma.cohort.findUnique({ where: { id: targetCohortId }, select: { id: true } });
      if (!cohort) return fail(res, 'Cohort not found', 404);
    }
  }
  const announcement = await prisma.$transaction(async (transaction) => {
    const created = await transaction.announcement.create({
      data: {
        title: title.trim(),
        body: body.trim(),
        authorId: req.user.id,
        programmeId: targetProgrammeId,
        cohortId: targetCohortId,
        courseId: targetCourseId,
      },
    });

    const baseAudience = announcementAudienceFilter({
      programmeId: targetProgrammeId,
      cohortId: targetCohortId,
      courseId: targetCourseId,
    });
    const audience = targetProgrammeId && req.user.role.name === 'TRAINER'
      ? restrictProgrammeAudienceToCohorts(baseAudience, trainerProgrammeCohortIds)
      : baseAudience;
    let recipients;
    if (audience) {
      const cohortEnrolments = await transaction.enrolment.findMany({
        where: {
          ...audience,
          student: { status: 'ACTIVE', role: { name: 'STUDENT' } },
        },
        select: {
          studentId: true,
          cohort: { select: { programmeId: true, intakeProgramOfferingId: true } },
          student: {
            select: {
              programEnrollments: {
                where: { status: 'ACTIVE' },
                select: { programmeId: true, programOfferingId: true },
              },
            },
          },
        },
      });
      const recipientPrograms = new Map();
      for (const enrolment of cohortEnrolments) {
        const { programmeId, intakeProgramOfferingId } = enrolment.cohort;
        if (targetCourseProgrammeId && programmeId !== targetCourseProgrammeId) continue;
        if (targetProgrammeId && programmeId !== targetProgrammeId) continue;
        const matchingEnrollment = enrolment.student.programEnrollments.find((item) => (
          item.programmeId === programmeId
          && item.programOfferingId === intakeProgramOfferingId
        ));
        if (matchingEnrollment) recipientPrograms.set(enrolment.studentId, {
          programmeId: matchingEnrollment.programmeId,
          programOfferingId: targetProgrammeId ? null : intakeProgramOfferingId,
        });
      }
      recipients = [...recipientPrograms].map(([studentId, scope]) => ({ studentId, ...scope }));
    } else {
      recipients = await transaction.user.findMany({
        where: {
          id: { not: req.user.id },
          status: 'ACTIVE',
          role: { name: { in: ['STUDENT', 'TRAINER'] } },
        },
        select: { id: true },
      });
    }
    const recipientIds = [...new Set(recipients.map((recipient) => recipient.studentId ?? recipient.id))];
    if (recipientIds.length) {
      await transaction.notification.createMany({
        data: recipientIds.map((userId) => ({
          userId,
          programmeId: recipients.find((recipient) => (recipient.studentId ?? recipient.id) === userId)?.programmeId ?? null,
          programOfferingId: recipients.find((recipient) => (recipient.studentId ?? recipient.id) === userId)?.programOfferingId ?? null,
          isGlobal: !audience,
          audienceStatus: 'CLASSIFIED',
          type: 'INFO',
          title: created.title,
          body: created.body,
        })),
      });
    }
    return created;
  });
  await audit({ actorId: req.user.id, action: 'CREATE_ANNOUNCEMENT', entity: 'Announcement', entityId: announcement.id, ipAddress: req.ip });
  return ok(res, announcement, 'Created', 201);
};

// Attendance
export const recordAttendance = async (req, res) => {
  const { cohortId, studentIds, records, date, present } = req.body || {};
  const validCohortId = parseOptionalId(cohortId);
  const normalizedRecords = normalizeAttendanceRecords(records, studentIds, present);
  const dateObj = parseAttendanceDate(date);
  if (
    !validCohortId
    || !normalizedRecords
    || !dateObj
  ) return fail(res, 'Provide a valid cohort, up to 200 student ids, an attendance date, and an optional boolean status', 400);
  if (req.user.role.name === 'TRAINER') {
    const assignment = await prisma.cohortTrainer.findUnique({
      where: { cohortId_trainerId: { cohortId: validCohortId, trainerId: req.user.id } },
      select: { id: true },
    });
    if (!assignment) return fail(res, 'You are not assigned to this cohort', 403);
  } else if (req.user.role.name !== 'SUPER_ADMIN') {
    return fail(res, 'Forbidden', 403);
  }
  const cohort = await prisma.cohort.findUnique({ where: { id: validCohortId }, select: { id: true } });
  if (!cohort) return fail(res, 'Cohort not found', 404);

  const enrolments = await prisma.enrolment.findMany({
    where: { cohortId: validCohortId, studentId: { in: normalizedRecords.map(({ studentId }) => studentId) } },
    select: { studentId: true },
  });
  if (enrolments.length !== normalizedRecords.length) return fail(res, 'All students must be enrolled in the selected cohort', 400);

  const created = await prisma.$transaction(normalizedRecords.map(({ studentId, present: isPresent }) => prisma.attendance.upsert({
    where: { studentId_cohortId_date: { studentId, cohortId: validCohortId, date: dateObj } },
    create: { studentId, cohortId: validCohortId, date: dateObj, present: isPresent },
    update: { present: isPresent },
  })));
  await audit({ actorId: req.user.id, action: 'RECORD_ATTENDANCE', entity: 'Attendance', entityId: created.length.toString(), ipAddress: req.ip });
  return ok(res, { count: created.length }, 'Attendance recorded', 201);
};

export const listAttendance = async (req, res) => {
  const { cohortId, studentId, date } = req.query;
  const pagination = parseListOptions(req.query, 100);
  const requestedCohortId = parseOptionalId(cohortId);
  const requestedStudentId = parseOptionalId(studentId);
  const requestedDate = date === undefined ? null : parseAttendanceDate(date);
  if (
    !pagination
    || requestedCohortId === undefined
    || requestedStudentId === undefined
    || (date !== undefined && !requestedDate)
  ) {
    return fail(res, 'Invalid attendance filters or pagination options', 400);
  }
  const where = {};
  if (requestedDate) where.date = requestedDate;
  if (requestedCohortId) where.cohortId = requestedCohortId;
  if (req.user.role.name === 'STUDENT') {
    where.studentId = req.user.id;
    where.cohort = activeProgramCohortForStudent(req.user.id);
  } else if (req.user.role.name === 'TRAINER') {
    const assignments = await prisma.cohortTrainer.findMany({
      where: { trainerId: req.user.id },
      select: { cohortId: true },
    });
    const assignedCohortIds = assignments.map(({ cohortId: assignedCohortId }) => assignedCohortId);
    where.cohortId = requestedCohortId
      ? { in: assignedCohortIds.filter((assignedId) => assignedId === requestedCohortId) }
      : { in: assignedCohortIds };
    if (requestedStudentId) where.studentId = requestedStudentId;
  } else if (req.user.role.name === 'SUPER_ADMIN') {
    if (requestedStudentId) where.studentId = requestedStudentId;
    if (requestedCohortId) where.cohortId = requestedCohortId;
  } else {
    return fail(res, 'Forbidden', 403);
  }
  if (!await cursorExistsInScope(prisma.attendance, where, pagination)) {
    return fail(res, 'Invalid attendance cursor', 400);
  }
  const attendance = await prisma.attendance.findMany({
    where,
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
    include: {
      student: { select: { firstName: true, lastName: true } },
    },
    ...pagination,
  });
  const cohortIds = [...new Set(attendance.map(({ cohortId }) => cohortId))];
  const cohorts = await prisma.cohort.findMany({
    where: { id: { in: cohortIds } },
    select: { id: true, name: true },
  });
  const cohortNames = new Map(cohorts.map(({ id, name }) => [id, name]));
  return ok(res, attendance.map((record) => ({
    ...record,
    cohort: { id: record.cohortId, name: cohortNames.get(record.cohortId) || 'Cohort' },
  })));
};

export const listAttendanceCohorts = async (req, res) => {
  const where = req.user.role.name === 'TRAINER'
    ? { trainers: { some: { trainerId: req.user.id } } }
    : {};
  const cohorts = await prisma.cohort.findMany({
    where,
    select: {
      id: true,
      name: true,
      programme: { select: { id: true, title: true } },
      enrolments: {
        where: { student: { status: 'ACTIVE', role: { name: 'STUDENT' } } },
        select: {
          studentId: true,
          student: { select: { firstName: true, lastName: true } },
        },
        orderBy: { student: { lastName: 'asc' } },
      },
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });
  return ok(res, cohorts);
};