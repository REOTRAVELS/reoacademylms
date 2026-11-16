import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ||= 'communications-http-integration-secret';
process.env.DATABASE_URL ||= 'postgresql://placeholder:placeholder@localhost:5432/test';

const [{ default: app }, { default: prisma }, { signToken }] = await Promise.all([
  import('../src/app.js'),
  import('../src/config/database.js'),
  import('../src/utils/jwt.js'),
]);

const users = new Map([
  ['student-1', { id: 'student-1', status: 'ACTIVE', role: { name: 'STUDENT' } }],
  ['trainer-1', { id: 'trainer-1', status: 'ACTIVE', role: { name: 'TRAINER' } }],
  ['admin-1', { id: 'admin-1', status: 'ACTIVE', role: { name: 'SUPER_ADMIN' } }],
]);

const stubMethod = (target, key, implementation) => {
  const original = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, writable: true, value: implementation });
  return () => {
    if (original) Object.defineProperty(target, key, original);
    else delete target[key];
  };
};

const startServer = async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return server;
};

const closeServer = (server) => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
});

const authHeaders = (userId, extra = {}) => ({
  Cookie: `reoa_session=${signToken({ sub: userId })}`,
  ...extra,
});

test('communications HTTP endpoints paginate within role scopes and record bounded attendance batches', async () => {
  const restores = [];
  let announcementListArgs;
  let announcementCursorArgs;
  let studentEnrolmentArgs;
  let attendanceListArgs;
  let attendanceCursorArgs;
  let attendanceUpserts = [];
  let announcementNotificationData;
  let server;

  restores.push(stubMethod(prisma.user, 'findUnique', async ({ where }) => users.get(where.id)));
  restores.push(stubMethod(prisma.programEnrollment, 'findFirst', async () => ({ id: 'program-enrollment-1' })));
  restores.push(stubMethod(prisma.programEnrollment, 'findMany', async () => ([{
    programmeId: 'programme-1',
    programOfferingId: 'offering-1',
  }])));
  restores.push(stubMethod(prisma.course, 'findMany', async () => []));
  restores.push(stubMethod(prisma.enrolment, 'findMany', async (args) => {
    const { where } = args;
    if (where.studentId === 'student-1') {
      studentEnrolmentArgs = args;
      return [{
        cohortId: 'cohort-1',
        studentId: 'student-1',
        cohort: {
          programmeId: 'programme-1',
          intakeProgramOfferingId: 'offering-1',
          courses: [
            { courseId: 'published-course', course: { status: 'PUBLISHED' } },
          ],
        },
        student: {
          programEnrollments: [{
            programmeId: 'programme-1',
            programOfferingId: 'offering-1',
          }],
        },
      }];
    }
    if (where.cohortId === 'cohort-1') {
      return [{
        cohortId: 'cohort-1',
        studentId: 'student-1',
        cohort: { programmeId: 'programme-1', intakeProgramOfferingId: 'offering-1' },
        student: {
          programEnrollments: [{
            programmeId: 'programme-1',
            programOfferingId: 'offering-1',
          }],
        },
      }, {
        cohortId: 'cohort-1',
        studentId: 'student-2',
        cohort: { programmeId: 'programme-1', intakeProgramOfferingId: 'offering-1' },
        student: {
          programEnrollments: [{
            programmeId: 'programme-2',
            programOfferingId: 'offering-2',
          }],
        },
      }];
    }
    return where.studentId.in.map((studentId) => ({ studentId }));
  }));
  restores.push(stubMethod(prisma.announcement, 'findFirst', async ({ where }) => {
    announcementCursorArgs = where;
    return where.id === 'announcement-1' ? { id: where.id } : null;
  }));
  restores.push(stubMethod(prisma.announcement, 'findMany', async (args) => {
    announcementListArgs = args;
    return [{ id: 'announcement-2', title: 'Update', body: 'Details' }];
  }));
  restores.push(stubMethod(prisma.cohortTrainer, 'findMany', async ({ where }) => (
    where.trainerId === 'trainer-1' ? [{ cohortId: 'cohort-1' }] : []
  )));
  restores.push(stubMethod(prisma.attendance, 'findFirst', async ({ where }) => {
    attendanceCursorArgs = where;
    const cohortIds = where.cohortId?.in;
    return where.id === 'attendance-1' && cohortIds?.includes('cohort-1')
      ? { id: where.id }
      : null;
  }));
  restores.push(stubMethod(prisma.attendance, 'findMany', async (args) => {
    attendanceListArgs = args;
    return [{ id: 'attendance-2', cohortId: 'cohort-1', studentId: 'student-2', present: false, date: new Date('2026-11-08T00:00:00.000Z') }];
  }));
  restores.push(stubMethod(prisma.cohort, 'findMany', async () => [{ id: 'cohort-1', name: 'Cohort One' }]));
  restores.push(stubMethod(prisma.cohortTrainer, 'findUnique', async ({ where }) => (
    where.cohortId_trainerId.cohortId === 'cohort-1' ? { id: 'assignment-1' } : null
  )));
  restores.push(stubMethod(prisma.cohort, 'findUnique', async ({ where }) => (
    where.id === 'cohort-1'
      ? { id: where.id, programmeId: 'programme-1', intakeProgramOfferingId: 'offering-1' }
      : null
  )));
  restores.push(stubMethod(prisma.announcement, 'create', async ({ data }) => ({ id: 'created-announcement', ...data })));
  restores.push(stubMethod(prisma.notification, 'createMany', async ({ data }) => {
    announcementNotificationData = data;
    return { count: data.length };
  }));
  restores.push(stubMethod(prisma.attendance, 'upsert', async ({ where, create, update }) => {
    attendanceUpserts.push({ where, create, update });
    return create;
  }));
  restores.push(stubMethod(prisma.auditLog, 'create', async () => ({})));
  restores.push(stubMethod(prisma, '$transaction', async (queriesOrCallback) => (
    Array.isArray(queriesOrCallback) ? Promise.all(queriesOrCallback) : queriesOrCallback(prisma)
  )));

  try {
    server = await startServer();
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/notifications`;

    const announcementResponse = await fetch(`${baseUrl}/announcements?limit=1&cursor=announcement-1`, {
      headers: authHeaders('student-1'),
    });
    assert.equal(announcementResponse.status, 200);
    assert.equal((await announcementResponse.json()).data[0].id, 'announcement-2');
    assert.deepEqual(announcementCursorArgs.id, 'announcement-1');
    assert.ok(announcementCursorArgs.OR.some((filter) => filter.courseId?.in?.includes('published-course')));
    assert.ok(announcementCursorArgs.OR.every((filter) => !filter.courseId?.in?.includes('draft-course')));
    assert.deepEqual(studentEnrolmentArgs.where.cohort.programme.id.in, ['programme-1']);
    assert.deepEqual(studentEnrolmentArgs.where.cohort.intakeProgramOfferingId.in, ['offering-1']);
    assert.deepEqual(studentEnrolmentArgs.select.cohort.select.courses.where.course.status, 'PUBLISHED');
    assert.deepEqual(announcementListArgs.take, 1);
    assert.deepEqual(announcementListArgs.skip, 1);
    assert.equal(announcementListArgs.orderBy[0].createdAt, 'desc');

    const createAnnouncementResponse = await fetch(`${baseUrl}/announcements`, {
      method: 'POST',
      headers: authHeaders('admin-1', { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ title: 'Cohort update', body: 'Program-specific update', cohortId: 'cohort-1' }),
    });
    assert.equal(createAnnouncementResponse.status, 201);
    assert.deepEqual(announcementNotificationData, [{
      userId: 'student-1',
      programmeId: 'programme-1',
      programOfferingId: 'offering-1',
      isGlobal: false,
      audienceStatus: 'CLASSIFIED',
      type: 'INFO',
      title: 'Cohort update',
      body: 'Program-specific update',
    }]);

    const invalidAnnouncementCursor = await fetch(`${baseUrl}/announcements?cursor=unknown`, {
      headers: authHeaders('student-1'),
    });
    assert.equal(invalidAnnouncementCursor.status, 400);

    const attendanceResponse = await fetch(`${baseUrl}/attendance?cohortId=cohort-1&limit=1&cursor=attendance-1`, {
      headers: authHeaders('trainer-1'),
    });
    assert.equal(attendanceResponse.status, 200);
    const attendancePage = await attendanceResponse.json();
    assert.equal(attendancePage.data[0].cohort.name, 'Cohort One');
    assert.deepEqual(attendanceCursorArgs.cohortId.in, ['cohort-1']);
    assert.deepEqual(attendanceListArgs.take, 1);
    assert.deepEqual(attendanceListArgs.skip, 1);
    assert.equal(attendanceListArgs.orderBy[0].date, 'desc');

    const outOfScopeAttendanceCursor = await fetch(`${baseUrl}/attendance?cohortId=other-cohort&cursor=attendance-1`, {
      headers: authHeaders('trainer-1'),
    });
    assert.equal(outOfScopeAttendanceCursor.status, 400);

    const oversizedRecords = Array.from({ length: 201 }, (_, index) => ({
      studentId: `student-${index}`,
      present: true,
    }));
    const oversizedResponse = await fetch(`${baseUrl}/attendance`, {
      method: 'POST',
      headers: authHeaders('trainer-1', { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ cohortId: 'cohort-1', date: '2026-11-09', records: oversizedRecords }),
    });
    assert.equal(oversizedResponse.status, 400);
    assert.equal(attendanceUpserts.length, 0);

    const batch = [
      { studentId: 'student-1', present: true },
      { studentId: 'student-2', present: false },
    ];
    const recordResponse = await fetch(`${baseUrl}/attendance`, {
      method: 'POST',
      headers: authHeaders('trainer-1', { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ cohortId: 'cohort-1', date: '2026-11-09', records: batch }),
    });
    assert.equal(recordResponse.status, 201);
    assert.equal((await recordResponse.json()).data.count, 2);
    assert.deepEqual(attendanceUpserts.map(({ create }) => create.present), [true, false]);
    assert.ok(attendanceUpserts.every(({ create }) => create.date instanceof Date));
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});
