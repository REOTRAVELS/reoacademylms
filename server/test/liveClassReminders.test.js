import test from 'node:test';
import assert from 'node:assert/strict';
import { createUpcomingLiveClassReminders } from '../src/services/liveClassReminders.js';

test('class reminders email eligible students and create one in-app notification per student', async () => {
  const now = new Date('2026-03-08T10:00:00.000Z');
  const startsAt = new Date('2026-03-08T10:39:30.000Z');
  const notifications = [];
  const deliveries = [];
  const deliveryUpdates = [];
  const emails = [];
  const liveClass = {
    id: 'class-1',
    title: 'Customer Relations · Winter',
    startsAt,
    status: 'SCHEDULED',
    course: { title: 'Customer Relations' },
    cohort: {
      name: 'Winter Intake',
      intakeProgramOffering: {
        id: 'offering-1',
        programmeId: 'programme-1',
        academicStartDate: new Date('2026-01-01T00:00:00.000Z'),
        intake: { timezone: 'Africa/Accra' },
      },
      enrolments: [
        { studentId: 'student-1', student: { email: 'student@example.test', firstName: 'Alex' } },
        { studentId: 'student-2', student: { email: 'inactive@example.test', firstName: 'Sam' } },
      ],
    },
  };
  const database = {
    liveClass: {
      findMany: async ({ where }) => {
        assert.equal(where.status, 'SCHEDULED');
        assert.equal(where.startsAt.gt.toISOString(), '2026-03-08T10:38:00.000Z');
        assert.equal(where.startsAt.lte.toISOString(), '2026-03-08T10:40:00.000Z');
        return [liveClass];
      },
    },
    programEnrollment: {
      findMany: async ({ where }) => {
        assert.deepEqual(where.studentId.in, ['student-1', 'student-2']);
        assert.equal(where.programOfferingId, 'offering-1');
        return [{ studentId: 'student-1' }];
      },
    },
    notification: {
      createMany: async (args) => notifications.push(args),
    },
    liveClassReminderDelivery: {
      createMany: async ({ data }) => {
        deliveries.push(...data.map((delivery, index) => ({
          ...delivery,
          id: `delivery-${index}`,
          status: 'PENDING',
          attempts: 0,
          nextAttemptAt: now,
          lockedAt: null,
          user: { email: 'student@example.test', firstName: 'Alex' },
          liveClass,
        })));
        return { count: data.length };
      },
      findMany: async () => deliveries,
      updateMany: async () => ({ count: 1 }),
      update: async ({ where, data }) => deliveryUpdates.push({ id: where.id, data }),
    },
  };

  await createUpcomingLiveClassReminders(database, now, {
    emailConfigured: true,
    sendEmail: async (email, message) => emails.push({ email, message }),
  });

  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].data.length, 1);
  assert.equal(notifications[0].data[0].userId, 'student-1');
  assert.match(notifications[0].data[0].body, /about 40 minutes/);
  assert.equal(notifications[0].data[0].sourceKey, `live-class-reminder:class-1:${startsAt.toISOString()}:student-1`);
  assert.deepEqual(deliveries.map(({ channel, targetKey }) => [channel, targetKey]), [
    ['EMAIL', `email@${startsAt.toISOString()}`],
  ]);
  assert.equal(emails.length, 1);
  assert.equal(emails[0].email, 'student@example.test');
  assert.equal(emails[0].message.timezone, 'Africa/Accra');
  assert.equal(deliveryUpdates.length, 1);
  assert.ok(deliveryUpdates.every(({ data }) => data.status === 'DELIVERED'));
});
