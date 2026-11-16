import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ||= 'legacy-assignment-integration-secret';
process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test';

const [{ default: app }, { default: prisma }, { signToken }] = await Promise.all([
  import('../src/app.js'),
  import('../src/config/database.js'),
  import('../src/utils/jwt.js'),
]);

const users = {
  admin: { id: 'admin-1', status: 'ACTIVE', role: { name: 'SUPER_ADMIN' } },
  trainer: { id: 'trainer-1', status: 'ACTIVE', role: { name: 'TRAINER' } },
  student: { id: 'student-1', status: 'ACTIVE', role: { name: 'STUDENT' } },
};
const usersById = Object.fromEntries(Object.values(users).map((user) => [user.id, user]));

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

const send = (server, path, { method = 'GET', body, user = users.admin } = {}) => fetch(
  `http://127.0.0.1:${server.address().port}/api${path}`,
  {
    method,
    headers: {
      Cookie: `reoa_session=${signToken({ sub: user.id })}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  },
);

test('legacy assignment records an explicit offering and immutable before/after history atomically', async () => {
  const events = [];
  let enrollmentData;
  let historyData;
  const targetStudent = {
    id: 'student-legacy',
    status: 'ACTIVE',
    role: { name: 'STUDENT' },
    enrolments: [{ cohortId: 'legacy-cohort', cohort: { id: 'legacy-cohort', name: 'Old cohort label' } }],
    programApplications: [{
      id: 'old-application',
      status: 'REJECTED',
      programOfferingId: 'old-offering',
      intakeId: 'old-intake',
      programmeId: 'old-program',
      submittedAt: new Date('2023-01-01T00:00:00.000Z'),
      reviewedAt: new Date('2023-01-10T00:00:00.000Z'),
    }],
    programEnrollments: [{
      id: 'old-enrollment',
      status: 'COMPLETED',
      programOfferingId: 'old-offering',
      intakeId: 'old-intake',
      programmeId: 'old-program',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      effectiveAt: new Date('2024-01-01T00:00:00.000Z'),
      endedAt: new Date('2024-12-01T00:00:00.000Z'),
    }],
  };
  const offering = {
    id: 'selected-offering',
    intakeId: 'derived-intake',
    programmeId: 'derived-program',
    status: 'ACTIVE',
    programme: { id: 'derived-program', title: 'Navigation', status: 'ACTIVE' },
    intake: { id: 'derived-intake', gateNumber: 1, season: 'WINTER', year: 2027, status: 'ACTIVE' },
  };
  const restores = [
    stubMethod(prisma.user, 'findUnique', async ({ where }) => users[where.id === users.admin.id ? 'admin' : 'student']),
    stubMethod(prisma, '$transaction', async (operation) => operation({
      user: { findUnique: async () => targetStudent },
      intakeProgramOffering: { findUnique: async () => offering },
      programEnrollment: {
        create: async ({ data }) => {
          events.push('enrollment');
          enrollmentData = data;
          return { id: 'new-enrollment', ...data };
        },
      },
      programEnrollmentAssignmentHistory: {
        create: async ({ data }) => {
          events.push('history');
          historyData = data;
          return { id: 'assignment-history', ...data };
        },
      },
    })),
  ];
  let server;
  try {
    server = await startServer();
    const response = await send(server, '/program-enrollments/legacy-students/student-legacy/assign', {
      method: 'POST',
      body: { programOfferingId: 'selected-offering' },
    });
    assert.equal(response.status, 201);
    assert.deepEqual(events, ['enrollment', 'history']);
    assert.deepEqual(enrollmentData, {
      studentId: 'student-legacy',
      programOfferingId: 'selected-offering',
      intakeId: 'derived-intake',
      programmeId: 'derived-program',
      status: 'ACTIVE',
    });
    assert.equal(historyData.assignedById, users.admin.id);
    assert.equal(historyData.studentId, 'student-legacy');
    assert.equal(historyData.previousState.activeProgramEnrollment, null);
    assert.equal(historyData.previousState.historicalProgramEnrollments[0].id, 'old-enrollment');
    assert.equal(historyData.previousState.previousApplications[0].id, 'old-application');
    assert.equal(historyData.previousState.legacyCohorts[0].cohortId, 'legacy-cohort');
    assert.equal(historyData.newAssignment.programmeTitle, 'Navigation');
    assert.equal(historyData.newAssignment.intake.year, 2027);
    assert.equal('enrolments' in enrollmentData, false);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('assignment candidates are restricted to active legacy students without active Program enrollment', async () => {
  let query;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => users.admin),
    stubMethod(prisma.user, 'findMany', async (args) => {
      query = args;
      return [{ id: 'legacy-student', firstName: 'Legacy', enrolments: [{ cohortId: 'old-cohort' }] }];
    }),
  ];
  let server;
  try {
    server = await startServer();
    const response = await send(server, '/program-enrollments/legacy-students?search=Legacy');
    assert.equal(response.status, 200);
    assert.equal(query.where.status, 'ACTIVE');
    assert.deepEqual(query.where.role, { name: 'STUDENT' });
    assert.deepEqual(query.where.enrolments, { some: {} });
    assert.deepEqual(query.where.programEnrollments, { none: { status: 'ACTIVE' } });
    assert.equal(query.where.OR[0].firstName.contains, 'Legacy');
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('assignment history can be reviewed with both the student and responsible administrator', async () => {
  let query;
  const history = [{
    id: 'assignment-history-1',
    student: { id: 'legacy-student', firstName: 'Legacy', lastName: 'Learner', email: 'legacy@example.test' },
    assignedBy: { id: users.admin.id, firstName: 'Ada', lastName: 'Admin' },
    previousState: { legacyCohorts: [{ cohortId: 'old-cohort' }] },
    newAssignment: { programmeId: 'programme-1' },
    enrollment: { programOffering: { programme: { title: 'Program' } } },
  }];
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => users.admin),
    stubMethod(prisma.programEnrollmentAssignmentHistory, 'findMany', async (args) => {
      query = args;
      return history;
    }),
  ];
  let server;
  try {
    server = await startServer();
    const response = await send(server, '/program-enrollments/assignment-history?search=Legacy');
    assert.equal(response.status, 200);
    assert.deepEqual(query.where.student.is.OR[0].firstName.contains, 'Legacy');
    assert.equal(query.select.assignedBy.select.email, true);
    assert.equal(query.select.previousState, true);
    assert.equal((await response.json()).data.items[0].assignedBy.id, users.admin.id);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('only Super Admins can assign, clients cannot supply Program or Intake ids, and conflicts are rejected', async () => {
  let transactionCount = 0;
  let enrollmentCount = 0;
  let existingStudent = {
    id: 'student-legacy',
    status: 'ACTIVE',
    role: { name: 'STUDENT' },
    enrolments: [{ cohortId: 'old-cohort', cohort: { id: 'old-cohort', name: 'Old cohort' } }],
    programEnrollments: [],
    programApplications: [],
  };
  const restores = [
    stubMethod(prisma.user, 'findUnique', async ({ where }) => (
      usersById[where.id] || { id: where.id, status: 'ACTIVE', role: { name: 'STUDENT' } }
    )),
    stubMethod(prisma, '$transaction', async (operation) => {
      transactionCount += 1;
      return operation({
        user: { findUnique: async () => existingStudent },
        intakeProgramOffering: {
          findUnique: async () => ({
            id: 'selected-offering',
            intakeId: 'intake-1',
            programmeId: 'programme-1',
            status: 'ACTIVE',
            programme: { id: 'programme-1', title: 'Program', status: 'ACTIVE' },
            intake: { id: 'intake-1', gateNumber: 1, season: 'WINTER', year: 2027, status: 'ACTIVE' },
          }),
        },
        programEnrollment: {
          create: async ({ data }) => {
            enrollmentCount += 1;
            return { id: 'enrollment-1', ...data };
          },
        },
        programEnrollmentAssignmentHistory: { create: async () => ({ id: 'history-1' }) },
      });
    }),
  ];
  let server;
  try {
    server = await startServer();
    for (const user of [users.trainer, users.student]) {
      const forbidden = await send(server, '/program-enrollments/legacy-students/student-legacy/assign', {
        method: 'POST',
        user,
        body: { programOfferingId: 'selected-offering' },
      });
      assert.equal(forbidden.status, 403);
    }
    const selfAssignment = await send(server, '/program-enrollments/legacy-students/student-1/assign', {
      method: 'POST',
      user: users.student,
      body: { programOfferingId: 'selected-offering' },
    });
    assert.equal(selfAssignment.status, 403);

    const mismatchedIds = await send(server, '/program-enrollments/legacy-students/student-legacy/assign', {
      method: 'POST',
      body: { programOfferingId: 'selected-offering', programmeId: 'attacker-program', intakeId: 'attacker-intake' },
    });
    assert.equal(mismatchedIds.status, 400);
    assert.equal(transactionCount, 0);

    existingStudent = { ...existingStudent, programEnrollments: [{ id: 'active', status: 'ACTIVE' }] };
    const duplicate = await send(server, '/program-enrollments/legacy-students/student-legacy/assign', {
      method: 'POST',
      body: { programOfferingId: 'selected-offering' },
    });
    assert.equal(duplicate.status, 409);
    assert.equal(enrollmentCount, 0);
    assert.equal(transactionCount, 1);

    existingStudent = {
      ...existingStudent,
      programEnrollments: [],
      programApplications: [{ id: 'pending-application', status: 'PENDING' }],
    };
    const pendingApplication = await send(server, '/program-enrollments/legacy-students/student-legacy/assign', {
      method: 'POST',
      body: { programOfferingId: 'selected-offering' },
    });
    assert.equal(pendingApplication.status, 409);
    assert.equal(enrollmentCount, 0);
    assert.equal(transactionCount, 2);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('assignment rejects missing and inactive offerings without writing enrollment or history', async () => {
  let enrollmentWrites = 0;
  const student = {
    id: 'student-legacy',
    status: 'ACTIVE',
    role: { name: 'STUDENT' },
    enrolments: [{ cohortId: 'old-cohort', cohort: { id: 'old-cohort', name: 'Old cohort' } }],
    programEnrollments: [],
    programApplications: [],
  };
  const restores = [
    stubMethod(prisma.user, 'findUnique', async ({ where }) => usersById[where.id] || users.student),
    stubMethod(prisma, '$transaction', async (operation) => operation({
      user: { findUnique: async () => student },
      intakeProgramOffering: {
        findUnique: async ({ where }) => (where.id === 'inactive-offering'
          ? {
            id: 'inactive-offering',
            intakeId: 'intake-1',
            programmeId: 'programme-1',
            status: 'INACTIVE',
            programme: { id: 'programme-1', title: 'Program', status: 'ACTIVE' },
            intake: { id: 'intake-1', gateNumber: 1, season: 'WINTER', year: 2027, status: 'ACTIVE' },
          }
          : null),
      },
      programEnrollment: {
        create: async () => {
          enrollmentWrites += 1;
          return {};
        },
      },
      programEnrollmentAssignmentHistory: { create: async () => assert.fail('Invalid offerings cannot create history') },
    })),
  ];
  let server;
  try {
    server = await startServer();
    const missing = await send(server, '/program-enrollments/legacy-students/student-legacy/assign', {
      method: 'POST',
      body: { programOfferingId: 'missing-offering' },
    });
    const inactive = await send(server, '/program-enrollments/legacy-students/student-legacy/assign', {
      method: 'POST',
      body: { programOfferingId: 'inactive-offering' },
    });
    assert.equal(missing.status, 404);
    assert.equal(inactive.status, 409);
    assert.equal(enrollmentWrites, 0);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('an active enrollment uniqueness race returns conflict without treating assignment as successful', async () => {
  const restores = [
    stubMethod(prisma.user, 'findUnique', async ({ where }) => usersById[where.id] || users.student),
    stubMethod(prisma, '$transaction', async () => {
      const error = new Error('partial unique constraint');
      error.code = 'P2002';
      throw error;
    }),
  ];
  let server;
  try {
    server = await startServer();
    const response = await send(server, '/program-enrollments/legacy-students/student-legacy/assign', {
      method: 'POST',
      body: { programOfferingId: 'selected-offering' },
    });
    assert.equal(response.status, 409);
    assert.match((await response.json()).message, /already has an active Program enrollment/i);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});
