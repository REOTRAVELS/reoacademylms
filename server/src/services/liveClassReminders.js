import prisma from '../config/database.js';
import { env } from '../config/env.js';
import { isEmailDeliveryConfigured, sendLiveClassReminderEmail } from './emailService.js';

const reminderWindowMs = 2 * 60_000;
const classJoinLeadTimeMs = 40 * 60_000;
const deliveryLeaseMs = 5 * 60_000;

const reminderText = (liveClass) => ({
  title: 'Your class starts soon',
  body: `${liveClass.course?.title || liveClass.title} is scheduled to start in about 40 minutes. Open your calendar to join.`,
});

const createDeliveryRows = async (database, eligibleEnrollments, liveClass, emailConfigured) => {
  if (!emailConfigured) return;
  const rows = eligibleEnrollments
    .filter(({ student }) => student.email)
    .map(({ studentId }) => ({
      liveClassId: liveClass.id,
      userId: studentId,
      channel: 'EMAIL',
      targetKey: `email@${liveClass.startsAt.toISOString()}`,
    }));
  if (rows.length) {
    await database.liveClassReminderDelivery.createMany({ data: rows, skipDuplicates: true });
  }
};

const deliveryIsClaimable = (delivery, now) => (
  delivery.status === 'PENDING'
    ? delivery.nextAttemptAt <= now
    : delivery.status === 'SENDING'
      && delivery.lockedAt
      && delivery.lockedAt <= new Date(now.getTime() - deliveryLeaseMs)
);

const deliveryClaimWhere = (delivery, now) => (
  delivery.status === 'PENDING'
    ? { id: delivery.id, status: 'PENDING', nextAttemptAt: { lte: now } }
    : {
      id: delivery.id,
      status: 'SENDING',
      lockedAt: { lte: new Date(now.getTime() - deliveryLeaseMs) },
    }
);

const sendDelivery = async (delivery, sendEmail) => {
  const liveClass = delivery.liveClass;
  const offering = liveClass.cohort?.intakeProgramOffering;
  const timezone = offering?.intake?.timezone || 'UTC';
  const courseTitle = liveClass.course?.title || liveClass.title;
  const calendarUrl = new URL('/calendar', env.clientUrl).toString();

  await sendEmail(delivery.user.email, {
    firstName: delivery.user.firstName,
    classTitle: courseTitle,
    cohortName: liveClass.cohort?.name,
    startsAt: liveClass.startsAt,
    timezone,
    calendarUrl,
  });
};

export const deliverPendingClassReminders = async (
  database,
  now,
  options = {},
) => {
  const deliveries = await database.liveClassReminderDelivery.findMany({
    where: {
      OR: [
        { status: 'PENDING', nextAttemptAt: { lte: now } },
        { status: 'SENDING', lockedAt: { lte: new Date(now.getTime() - deliveryLeaseMs) } },
      ],
    },
    include: {
      user: { select: { email: true, firstName: true } },
      liveClass: {
        include: {
          course: { select: { title: true } },
          cohort: {
            select: {
              name: true,
              intakeProgramOffering: {
                select: { intake: { select: { timezone: true } } },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });

  for (const delivery of deliveries) {
    if (!deliveryIsClaimable(delivery, now)) continue;
    const expectedTargetKey = `email@${delivery.liveClass.startsAt.toISOString()}`;
    if (
      delivery.liveClass.status !== 'SCHEDULED'
      || delivery.liveClass.startsAt <= now
      || delivery.targetKey !== expectedTargetKey
    ) {
      await database.liveClassReminderDelivery.update({
        where: { id: delivery.id },
        data: { status: 'FAILED', lockedAt: null, lastError: 'Class schedule changed, was cancelled, or already started' },
      });
      continue;
    }
    const claimed = await database.liveClassReminderDelivery.updateMany({
      where: deliveryClaimWhere(delivery, now),
      data: { status: 'SENDING', lockedAt: now, attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) continue;

    try {
      await sendDelivery(delivery, options.sendEmail);
      await database.liveClassReminderDelivery.update({
        where: { id: delivery.id },
        data: { status: 'DELIVERED', deliveredAt: now, lockedAt: null, lastError: null },
      });
    } catch (error) {
      const attempts = delivery.attempts + 1;
      const retryDelayMs = Math.min(30 * 60_000, 30_000 * (2 ** Math.min(attempts, 6)));
      const details = `${delivery.channel} provider delivery failed${error.statusCode ? ` (HTTP ${error.statusCode})` : ''}`;
      await database.liveClassReminderDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'PENDING',
          lockedAt: null,
          nextAttemptAt: new Date(now.getTime() + retryDelayMs),
          lastError: details,
        },
      });
      console.error(`Class reminder ${delivery.channel.toLowerCase()} delivery failed`, {
        deliveryId: delivery.id,
        statusCode: error.statusCode,
      });
    }
  }
};

export const createUpcomingLiveClassReminders = async (
  database = prisma,
  now = new Date(),
  options = {},
) => {
  const resolvedOptions = {
    emailConfigured: options.emailConfigured ?? isEmailDeliveryConfigured(),
    sendEmail: options.sendEmail || sendLiveClassReminderEmail,
  };
  const classes = await database.liveClass.findMany({
    where: {
      status: 'SCHEDULED',
      startsAt: {
        gt: new Date(now.getTime() + classJoinLeadTimeMs - reminderWindowMs),
        lte: new Date(now.getTime() + classJoinLeadTimeMs),
      },
      cohort: {
        is: {
          intakeProgramOffering: { isNot: null },
        },
      },
    },
    include: {
      course: { select: { title: true } },
      cohort: {
        include: {
          intakeProgramOffering: {
            select: {
              id: true,
              programmeId: true,
              academicStartDate: true,
              intake: { select: { timezone: true } },
            },
          },
          enrolments: {
            select: {
              studentId: true,
              student: { select: { email: true, firstName: true } },
            },
          },
        },
      },
    },
  });

  for (const liveClass of classes) {
    const offering = liveClass.cohort.intakeProgramOffering;
    if (!offering || offering.academicStartDate > now) continue;

    const enrolledStudentIds = liveClass.cohort.enrolments.map(({ studentId }) => studentId);
    if (!enrolledStudentIds.length) continue;

    const eligibleEnrollments = await database.programEnrollment.findMany({
      where: {
        studentId: { in: enrolledStudentIds },
        programOfferingId: offering.id,
        status: 'ACTIVE',
        effectiveAt: { lte: now },
        student: { is: { status: 'ACTIVE', role: { is: { name: 'STUDENT' } } } },
        AND: [
          { OR: [{ endedAt: null }, { endedAt: { gt: now } }] },
          { OR: [{ applicationId: null }, { application: { is: { status: 'APPROVED' } } }] },
        ],
      },
      select: { studentId: true },
    });
    const eligibleIds = new Set(eligibleEnrollments.map(({ studentId }) => studentId));
    const eligibleStudents = liveClass.cohort.enrolments
      .filter(({ studentId }) => eligibleIds.has(studentId));
    const notification = reminderText(liveClass);
    const notifications = eligibleStudents.map(({ studentId }) => ({
      userId: studentId,
      programmeId: offering.programmeId,
      programOfferingId: offering.id,
      type: 'INFO',
      ...notification,
      sourceKey: `live-class-reminder:${liveClass.id}:${liveClass.startsAt.toISOString()}:${studentId}`,
    }));

    if (notifications.length) {
      await database.notification.createMany({ data: notifications, skipDuplicates: true });
    }
    await createDeliveryRows(database, eligibleStudents, liveClass, resolvedOptions.emailConfigured);
  }

  await deliverPendingClassReminders(database, now, resolvedOptions);
};

export const startLiveClassReminderJob = (database = prisma, intervalMs = 30_000) => {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await createUpcomingLiveClassReminders(database);
    } catch (error) {
      console.error('Live class reminder job failed', error);
    } finally {
      running = false;
    }
  };

  void run();
  const interval = setInterval(run, intervalMs);
  interval.unref();
  return () => clearInterval(interval);
};
