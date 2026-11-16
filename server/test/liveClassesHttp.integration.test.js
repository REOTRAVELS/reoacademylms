import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ||= 'live-class-http-integration-secret';
process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test';
process.env.LIVEKIT_URL = 'wss://rtc.example.test';
process.env.LIVEKIT_API_KEY = 'test-api-key';
process.env.LIVEKIT_API_SECRET = 'test-api-secret';

const [{ default: app }, { default: prisma }, { signToken }] = await Promise.all([
  import('../src/app.js'),
  import('../src/config/database.js'),
  import('../src/utils/jwt.js'),
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

test('live-class join rejects non-enrolled students and issues restricted tokens to enrolled students', async () => {
  const student = { id: 'student-1', firstName: 'Test', lastName: 'Student', status: 'ACTIVE', role: { name: 'STUDENT' } };
  const liveClass = {
    id: 'class-1',
    title: 'Tourism foundations',
    roomName: 'reo-private-room',
    courseId: 'course-1',
    cohortId: 'cohort-1',
    createdById: 'trainer-1',
    status: 'LIVE',
  };
  let enrolled = false;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => student),
    stubMethod(prisma.programEnrollment, 'findFirst', async () => ({ id: 'program-enrollment-1' })),
    stubMethod(prisma.liveClass, 'findUnique', async () => liveClass),
    stubMethod(prisma.enrolment, 'findFirst', async () => (enrolled ? { id: 'enrolment-1' } : null)),
    stubMethod(prisma.liveClassPresence, 'findFirst', async () => null),
    stubMethod(prisma.liveClassPresence, 'create', async () => ({ id: 'presence-1' })),
  ];
  let server;
  try {
    server = await startServer();
    const url = `http://127.0.0.1:${server.address().port}/api/live-classes/${liveClass.id}/join`;
    const headers = { Cookie: `reoa_session=${signToken({ sub: student.id })}` };
    const denied = await fetch(url, { method: 'POST', headers });
    assert.equal(denied.status, 404);

    enrolled = true;
    const allowed = await fetch(url, { method: 'POST', headers });
    assert.equal(allowed.status, 200);
    const body = await allowed.json();
    assert.equal(body.data.serverUrl, process.env.LIVEKIT_URL);
    const payload = JSON.parse(Buffer.from(body.data.token.split('.')[1], 'base64url').toString('utf8'));
    assert.equal(payload.video.room, liveClass.roomName);
    assert.equal(payload.video.canPublish, false);
    assert.equal(payload.video.canSubscribe, true);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('recording playback rejects invalid download query values', async () => {
  const admin = { id: 'admin-1', status: 'ACTIVE', role: { name: 'SUPER_ADMIN' } };
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => admin),
    stubMethod(prisma.liveClassRecording, 'findUnique', async () => {
      assert.fail('Invalid playback options must be rejected before loading a recording');
    }),
  ];
  let server;
  try {
    server = await startServer();
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/live-classes/recordings/recording-1/playback?download=yes`,
      { headers: { Cookie: `reoa_session=${signToken({ sub: admin.id })}` } },
    );
    assert.equal(response.status, 400);
    assert.match((await response.json()).message, /Invalid recording playback options/);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('trainers can schedule classes only for assigned cohorts', async () => {
  const trainer = { id: 'trainer-1', firstName: 'Test', lastName: 'Trainer', status: 'ACTIVE', role: { name: 'TRAINER' } };
  const body = {
    title: 'Tourism foundations',
    courseId: 'course-1',
    cohortId: 'cohort-1',
    startsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    durationMins: 60,
  };
  let assigned = false;
  let createCount = 0;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => trainer),
    stubMethod(prisma, '$transaction', async (callback) => callback(prisma)),
    stubMethod(prisma.course, 'findUnique', async () => ({ id: body.courseId, trainers: [] })),
    stubMethod(prisma.cohort, 'findUnique', async () => ({ id: body.cohortId, trainers: [], enrolments: [] })),
    stubMethod(prisma.cohortCourse, 'findUnique', async () => ({ id: 'cohort-course-1' })),
    stubMethod(prisma.courseTrainer, 'findUnique', async () => null),
    stubMethod(prisma.cohortTrainer, 'findUnique', async () => (assigned ? { id: 'cohort-trainer-1' } : null)),
    stubMethod(prisma.liveClass, 'findMany', async () => []),
    stubMethod(prisma.liveClass, 'create', async ({ data }) => {
      createCount += 1;
      return { id: 'class-1', ...data, course: { id: body.courseId, title: 'Course' }, cohort: { id: body.cohortId, name: 'Cohort' } };
    }),
    stubMethod(prisma.auditLog, 'create', async () => ({ id: 'audit-1' })),
  ];
  let server;
  try {
    server = await startServer();
    const url = `http://127.0.0.1:${server.address().port}/api/live-classes`;
    const headers = {
      Cookie: `reoa_session=${signToken({ sub: trainer.id })}`,
      'content-type': 'application/json',
    };
    const denied = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal(denied.status, 403);
    assert.equal(createCount, 0);

    assigned = true;
    const created = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal(created.status, 201);
    const result = await created.json();
    assert.equal(result.data.createdById, trainer.id);
    assert.match(result.data.roomName, /^reo-/);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('super admins can create an emergency live class immediately', async () => {
  const admin = { id: 'admin-1', firstName: 'Test', lastName: 'Admin', status: 'ACTIVE', role: { name: 'SUPER_ADMIN' } };
  const body = { title: 'Emergency class', courseId: 'course-1', cohortId: 'cohort-1', durationMins: 45 };
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => admin),
    stubMethod(prisma.course, 'findUnique', async () => ({ id: body.courseId, title: 'Course', trainers: [] })),
    stubMethod(prisma.cohort, 'findUnique', async () => ({ id: body.cohortId, name: 'Cohort', trainers: [], enrolments: [] })),
    stubMethod(prisma.cohortCourse, 'findUnique', async () => ({ id: 'cohort-course-1' })),
    stubMethod(prisma.liveClass, 'create', async ({ data }) => ({
      id: 'emergency-class-1',
      ...data,
      course: { id: body.courseId, title: 'Course' },
      cohort: { id: body.cohortId, name: 'Cohort' },
    })),
    stubMethod(prisma.auditLog, 'create', async () => ({ id: 'audit-1' })),
  ];
  let server;
  try {
    server = await startServer();
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/live-classes/emergency`, {
      method: 'POST',
      headers: {
        Cookie: `reoa_session=${signToken({ sub: admin.id })}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.data.status, 'LIVE');
    assert.equal(result.data.title, 'Emergency class');
    assert.match(result.data.roomName, /^reo-/);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('live-class scheduling rejects overlapping cohort bookings', async () => {
  const admin = { id: 'admin-1', firstName: 'Test', lastName: 'Admin', status: 'ACTIVE', role: { name: 'SUPER_ADMIN' } };
  const startsAt = new Date(Date.now() + 60 * 60 * 1000);
  const body = {
    title: 'Overlapping class',
    courseId: 'course-1',
    cohortId: 'cohort-1',
    startsAt: startsAt.toISOString(),
    durationMins: 60,
  };
  let createCount = 0;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => admin),
    stubMethod(prisma, '$transaction', async (callback) => callback(prisma)),
    stubMethod(prisma.course, 'findUnique', async () => ({ id: body.courseId, trainers: [] })),
    stubMethod(prisma.cohort, 'findUnique', async () => ({ id: body.cohortId, trainers: [], enrolments: [] })),
    stubMethod(prisma.cohortCourse, 'findUnique', async () => ({ id: 'cohort-course-1' })),
    stubMethod(prisma.liveClass, 'findMany', async () => [{
      id: 'existing-class',
      title: 'Existing cohort class',
      cohortId: body.cohortId,
      startsAt,
      durationMins: 45,
      course: { trainers: [] },
      cohort: { trainers: [], enrolments: [] },
    }]),
    stubMethod(prisma.liveClass, 'create', async () => {
      createCount += 1;
      throw new Error('A conflicting class must not be created');
    }),
  ];
  let server;
  try {
    server = await startServer();
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/live-classes`, {
      method: 'POST',
      headers: {
        Cookie: `reoa_session=${signToken({ sub: admin.id })}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    assert.equal(response.status, 409);
    const result = await response.json();
    assert.match(result.message, /conflicts/i);
    assert.equal(result.errors[0].id, 'existing-class');
    assert.equal(createCount, 0);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('cancelling a scheduled live class updates its status without deleting it', async () => {
  const admin = { id: 'admin-1', firstName: 'Test', lastName: 'Admin', status: 'ACTIVE', role: { name: 'SUPER_ADMIN' } };
  let updateArgs;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => admin),
    stubMethod(prisma.liveClass, 'findUnique', async () => ({
      id: 'class-1',
      status: 'SCHEDULED',
      createdById: 'trainer-1',
      courseId: 'course-1',
      cohortId: 'cohort-1',
    })),
    stubMethod(prisma.liveClass, 'updateMany', async (args) => {
      updateArgs = args;
      return { count: 1 };
    }),
    stubMethod(prisma.auditLog, 'create', async () => ({ id: 'audit-1' })),
  ];
  let server;
  try {
    server = await startServer();
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/live-classes/class-1/cancel`, {
      method: 'POST',
      headers: { Cookie: `reoa_session=${signToken({ sub: admin.id })}` },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(updateArgs.where, { id: 'class-1', status: 'SCHEDULED' });
    assert.deepEqual(updateArgs.data, { status: 'CANCELLED' });
    assert.equal((await response.json()).data.status, 'CANCELLED');
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('managers can permanently delete past classes but not live classes', async () => {
  const admin = { id: 'admin-1', firstName: 'Test', lastName: 'Admin', status: 'ACTIVE', role: { name: 'SUPER_ADMIN' } };
  let liveClassStatus = 'ENDED';
  let recordingPending = true;
  let deleted = false;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => admin),
    stubMethod(prisma.liveClass, 'findUnique', async () => ({
      id: 'class-1',
      title: 'Finished class',
      status: liveClassStatus,
      startsAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      durationMins: 60,
      createdById: 'trainer-1',
      courseId: null,
      cohortId: null,
    })),
    stubMethod(prisma.liveClassRecording, 'findFirst', async () => (recordingPending ? { id: 'recording-1' } : null)),
    stubMethod(prisma.liveClassRecording, 'findMany', async () => []),
    stubMethod(prisma.liveClass, 'deleteMany', async ({ where }) => {
      if (liveClassStatus === where.status) {
        deleted = true;
        return { count: 1 };
      }
      return { count: 0 };
    }),
    stubMethod(prisma.auditLog, 'create', async () => ({ id: 'audit-1' })),
  ];
  let server;
  try {
    server = await startServer();
    const url = `http://127.0.0.1:${server.address().port}/api/live-classes/class-1`;
    const headers = { Cookie: `reoa_session=${signToken({ sub: admin.id })}` };
    const processingResponse = await fetch(url, { method: 'DELETE', headers });
    assert.equal(processingResponse.status, 409);
    assert.equal(deleted, false);

    recordingPending = false;
    const response = await fetch(url, { method: 'DELETE', headers });
    assert.equal(response.status, 200);
    assert.equal(deleted, true);

    liveClassStatus = 'LIVE';
    deleted = false;
    const activeResponse = await fetch(url, { method: 'DELETE', headers });
    assert.equal(activeResponse.status, 409);
    assert.equal(deleted, false);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('rescheduling a class persists the new time after conflict checks', async () => {
  const admin = { id: 'admin-1', firstName: 'Test', lastName: 'Admin', status: 'ACTIVE', role: { name: 'SUPER_ADMIN' } };
  const existing = {
    id: 'class-1',
    status: 'SCHEDULED',
    createdById: 'trainer-1',
    courseId: 'course-1',
    cohortId: 'cohort-1',
    durationMins: 60,
  };
  const startsAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
  let updateArgs;
  let classLookupCount = 0;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => admin),
    stubMethod(prisma, '$transaction', async (callback) => callback(prisma)),
    stubMethod(prisma.liveClass, 'findUnique', async () => {
      classLookupCount += 1;
      return classLookupCount === 1 ? existing : { ...existing, startsAt, durationMins: 90 };
    }),
    stubMethod(prisma.course, 'findUnique', async () => ({ id: 'course-1', trainers: [] })),
    stubMethod(prisma.cohort, 'findUnique', async () => ({ id: 'cohort-1', trainers: [], enrolments: [] })),
    stubMethod(prisma.liveClass, 'findMany', async () => []),
    stubMethod(prisma.liveClass, 'updateMany', async (args) => {
      updateArgs = args;
      return { count: 1 };
    }),
    stubMethod(prisma.auditLog, 'create', async () => ({ id: 'audit-1' })),
  ];
  let server;
  try {
    server = await startServer();
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/live-classes/class-1/schedule`, {
      method: 'PATCH',
      headers: {
        Cookie: `reoa_session=${signToken({ sub: admin.id })}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ startsAt: startsAt.toISOString(), durationMins: 90 }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(updateArgs.where, { id: 'class-1', status: 'SCHEDULED' });
    assert.equal(updateArgs.data.startsAt.toISOString(), startsAt.toISOString());
    assert.equal(updateArgs.data.durationMins, 90);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('calendar export returns an ICS event only to an authorized class participant', async () => {
  const admin = { id: 'admin-1', firstName: 'Test', lastName: 'Admin', status: 'ACTIVE', role: { name: 'SUPER_ADMIN' } };
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => admin),
    stubMethod(prisma.liveClass, 'findUnique', async () => ({
      id: 'class-1',
      title: 'Calendar class',
      description: 'Travel operations',
      roomName: 'reo-test-room',
      courseId: 'course-1',
      cohortId: 'cohort-1',
      createdById: 'trainer-1',
      status: 'SCHEDULED',
      startsAt: new Date('2027-01-15T10:00:00.000Z'),
      durationMins: 60,
    })),
  ];
  let server;
  try {
    server = await startServer();
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/live-classes/class-1/export.ics`, {
      headers: { Cookie: `reoa_session=${signToken({ sub: admin.id })}` },
    });

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/calendar/);
    assert.match(await response.text(), /SUMMARY:Calendar class/);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});
