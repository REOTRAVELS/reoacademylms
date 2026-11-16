import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ||= 'applications-http-integration-secret';
process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test';
process.env.BREVO_API_KEY = '';
process.env.EMAIL_FROM = '';
process.env.SMTP_URL = '';
process.env.SMTP_FROM = '';

const [{ default: app }, { default: prisma }, { signToken }] = await Promise.all([
  import('../src/app.js'),
  import('../src/config/database.js'),
  import('../src/utils/jwt.js'),
]);

const admin = { id: 'admin-1', status: 'ACTIVE', role: { name: 'SUPER_ADMIN' } };
const student = { id: 'student-1', status: 'PENDING', role: { name: 'STUDENT' } };

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

const send = (server, path, { method = 'GET', body, user = admin } = {}) => fetch(
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

const restoreAuth = (user = admin) => stubMethod(prisma.user, 'findUnique', async () => user);

const openOffering = () => {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: 'offering-1',
    status: 'ACTIVE',
    intake: {
      id: 'intake-1',
      status: 'ACTIVE',
      admissionsOpen: true,
      admissionStartDate: today,
      admissionEndDate: today,
      timezone: 'UTC',
    },
    programme: { id: 'programme-1', status: 'ACTIVE' },
  };
};

test('registration creates a pending account and its single Program application in one transaction', async () => {
  let transactionCount = 0;
  let createdUser;
  let createdApplication;
  const todayOffering = openOffering();
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => null),
    stubMethod(prisma.role, 'findUnique', async () => ({ id: 'student-role', name: 'STUDENT' })),
    stubMethod(prisma.auditLog, 'create', async () => ({ id: 'audit-1' })),
    stubMethod(prisma, '$transaction', async (operation) => {
      transactionCount += 1;
      const tx = {
        user: {
          create: async ({ data }) => {
            createdUser = { id: 'student-1', ...data, role: { name: 'STUDENT' } };
            return createdUser;
          },
          findUnique: async () => createdUser,
          update: async () => assert.fail('New pending users should not need a second status update'),
        },
        programEnrollment: { findFirst: async () => null },
        programApplication: {
          findFirst: async () => null,
          create: async ({ data }) => {
            createdApplication = { id: 'application-1', ...data };
            return createdApplication;
          },
        },
        programApplicationStatusHistory: { create: async () => ({ id: 'history-1' }) },
        intakeProgramOffering: { findFirst: async () => todayOffering },
      };
      return operation(tx);
    }),
  ];
  let server;
  try {
    server = await startServer();
    const response = await send(server, '/auth/register', {
      method: 'POST',
      user: student,
      body: {
        firstName: 'Ada',
        lastName: 'Learner',
        email: 'ada@example.test',
        password: 'secure-password',
        confirmPassword: 'secure-password',
        programOfferingId: 'offering-1',
      },
    });
    const payload = await response.json();
    assert.equal(response.status, 201);
    assert.equal(transactionCount, 1);
    assert.equal(createdUser.status, 'PENDING');
    assert.equal(createdApplication.studentId, createdUser.id);
    assert.equal(createdApplication.programOfferingId, 'offering-1');
    assert.equal(payload.data.applicationId, 'application-1');
    assert.equal(payload.data.academicAccess, false);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('application approval atomically records enrollment, account activation, history, and notification', async () => {
  const events = [];
  const application = {
    id: 'application-1',
    studentId: 'student-1',
    programmeId: 'programme-1',
    programOfferingId: 'offering-1',
    status: 'PENDING',
    student: { id: 'student-1', status: 'PENDING' },
    programOffering: {
      id: 'offering-1',
      intakeId: 'intake-1',
      programmeId: 'programme-1',
      status: 'ACTIVE',
      intake: {
        status: 'ACTIVE',
        gateNumber: 1,
        season: 'WINTER',
        year: 2027,
        academicStartDate: new Date('2027-01-15T09:00:00.000Z'),
        timezone: 'UTC',
      },
      programme: { status: 'ACTIVE', title: 'Travel Operations' },
    },
  };
  const restores = [
    restoreAuth(),
    stubMethod(prisma.auditLog, 'create', async () => ({ id: 'audit-1' })),
    stubMethod(prisma, '$transaction', async (operation) => operation({
      programApplication: {
        findUnique: async () => {
          events.push('application-read');
          return application;
        },
        updateMany: async () => {
          events.push('application-approved');
          return { count: 1 };
        },
      },
      programEnrollment: {
        findFirst: async () => null,
        create: async ({ data }) => {
          events.push('enrollment-created');
          assert.equal(data.programOfferingId, 'offering-1');
          assert.equal(data.applicationId, 'application-1');
          return { id: 'enrollment-1', ...data };
        },
      },
      cohort: {
        findFirst: async ({ where }) => {
          events.push('offering-cohort-read');
          assert.equal(where.programmeId, 'programme-1');
          assert.equal(where.intakeProgramOfferingId, 'offering-1');
          return { id: 'cohort-1' };
        },
      },
      enrolment: {
        findUnique: async () => {
          events.push('cohort-enrollment-read');
          return null;
        },
        create: async ({ data }) => {
          events.push('cohort-enrollment-created');
          assert.deepEqual(data, { studentId: 'student-1', cohortId: 'cohort-1' });
          return { id: 'cohort-enrollment-1', ...data };
        },
      },
      user: {
        updateMany: async () => {
          events.push('account-activated');
          return { count: 1 };
        },
      },
      programApplicationStatusHistory: {
        create: async () => {
          events.push('history-created');
          return { id: 'history-1' };
        },
      },
      notification: {
        create: async ({ data }) => {
          assert.equal(data.programmeId, 'programme-1');
          assert.equal(data.programOfferingId, 'offering-1');
          assert.equal(data.audienceStatus, 'CLASSIFIED');
          assert.equal(data.isGlobal, false);
          assert.match(data.body, /Travel Operations, GATE 01 WINTER 2027/);
          assert.match(data.body, /UTC/);
          events.push('notification-created');
          return { id: 'notification-1' };
        },
      },
    })),
  ];
  let server;
  try {
    server = await startServer();
    const response = await send(server, '/applications/admin/application-1/approve', {
      method: 'POST',
    });
    assert.equal(response.status, 200);
    assert.deepEqual(events, [
      'application-read',
      'offering-cohort-read',
      'enrollment-created',
      'cohort-enrollment-read',
      'cohort-enrollment-created',
      'application-approved',
      'account-activated',
      'history-created',
      'notification-created',
      'application-read',
    ]);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('applicants can read their status and administrators can filter and inspect applications', async () => {
  const application = {
    id: 'application-1',
    studentId: 'student-1',
    status: 'PENDING',
    history: [{ id: 'history-1', toStatus: 'PENDING' }],
  };
  let listQuery;
  let requestUser = student;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => requestUser),
    stubMethod(prisma.programApplication, 'findFirst', async () => application),
    stubMethod(prisma.programEnrollment, 'findFirst', async () => null),
    stubMethod(prisma.programApplication, 'findMany', async (query) => {
      listQuery = query;
      return [application];
    }),
    stubMethod(prisma.programApplication, 'findUnique', async ({ where }) => (
      where.id === application.id ? application : null
    )),
  ];
  let server;
  try {
    server = await startServer();
    const mine = await send(server, '/applications/me', { user: student });
    assert.equal(mine.status, 200);
    const minePayload = await mine.json();
    assert.equal(minePayload.data.application.id, application.id);
    assert.equal(minePayload.data.academicAccess, false);

    requestUser = admin;
    const list = await send(server, '/applications/admin?status=PENDING');
    assert.equal(list.status, 200);
    assert.deepEqual(listQuery.where, { status: 'PENDING' });
    assert.equal((await list.json()).data[0].id, application.id);

    const detail = await send(server, '/applications/admin/application-1');
    assert.equal(detail.status, 200);
    assert.equal((await detail.json()).data.history[0].id, 'history-1');
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('rejection records its reason and actor without creating an enrollment', async () => {
  const events = [];
  const application = {
    id: 'application-1',
    studentId: 'student-1',
    status: 'PENDING',
    student: { id: 'student-1', status: 'PENDING' },
    programOffering: openOffering(),
  };
  const restores = [
    restoreAuth(),
    stubMethod(prisma.auditLog, 'create', async () => ({ id: 'audit-1' })),
    stubMethod(prisma, '$transaction', async (operation) => operation({
      programApplication: {
        findUnique: async () => application,
        updateMany: async ({ data }) => {
          events.push(['application', data]);
          return { count: 1 };
        },
      },
      programEnrollment: {
        findFirst: async () => null,
        create: async () => assert.fail('Rejecting an application must not create an enrollment'),
      },
      user: {
        updateMany: async ({ data }) => {
          events.push(['student', data]);
          return { count: 1 };
        },
      },
      programApplicationStatusHistory: {
        create: async ({ data }) => {
          events.push(['history', data]);
          return { id: 'history-2' };
        },
      },
      notification: { create: async () => ({ id: 'notification-1' }) },
    })),
  ];
  let server;
  try {
    server = await startServer();
    const response = await send(server, '/applications/admin/application-1/reject', {
      method: 'POST',
      body: { rejectionReason: 'Application requirements were not met.' },
    });
    assert.equal(response.status, 200);
    const { reviewedAt, ...applicationUpdate } = events[0][1];
    assert.deepEqual(applicationUpdate, {
      status: 'REJECTED',
      rejectionReason: 'Application requirements were not met.',
      adminNotes: null,
      reviewedById: admin.id,
    });
    assert.ok(reviewedAt instanceof Date);
    assert.deepEqual(events[1], ['student', { status: 'REJECTED' }]);
    assert.deepEqual(events[2], ['history', {
      applicationId: 'application-1',
      fromStatus: 'PENDING',
      toStatus: 'REJECTED',
      reason: 'Application requirements were not met.',
      changedById: admin.id,
    }]);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('already reviewed and rejected applications cannot be approved into enrollments', async () => {
  let enrollmentCreateCount = 0;
  let applicationStatus = 'APPROVED';
  const restores = [
    restoreAuth(),
    stubMethod(prisma, '$transaction', async (operation) => operation({
      programApplication: {
        findUnique: async () => ({
          id: 'application-1',
          studentId: 'student-1',
          status: applicationStatus,
          student: { id: 'student-1', status: applicationStatus === 'APPROVED' ? 'ACTIVE' : 'REJECTED' },
        }),
      },
      programEnrollment: {
        create: async () => {
          enrollmentCreateCount += 1;
          return {};
        },
      },
    })),
  ];
  let server;
  try {
    server = await startServer();
    for (const status of ['APPROVED', 'REJECTED']) {
      applicationStatus = status;
      const response = await send(server, '/applications/admin/application-1/approve', { method: 'POST' });
      assert.equal(response.status, 409);
    }
    assert.equal(enrollmentCreateCount, 0);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('an unassigned active legacy student can submit a Program application and becomes pending', async () => {
  const legacyStudent = {
    id: 'legacy-student',
    status: 'ACTIVE',
    role: { name: 'STUDENT' },
  };
  const application = {
    id: 'legacy-application',
    studentId: legacyStudent.id,
    programOfferingId: 'offering-1',
    status: 'PENDING',
  };
  let createdApplications = 0;
  let statusHistoryEntries = 0;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => legacyStudent),
    stubMethod(prisma.programApplication, 'findFirst', async () => application),
    stubMethod(prisma.programEnrollment, 'findFirst', async () => null),
    stubMethod(prisma.auditLog, 'create', async () => ({ id: 'audit-1' })),
    stubMethod(prisma, '$transaction', async (operation) => operation({
      user: {
        findUnique: async () => ({
          id: legacyStudent.id,
          status: legacyStudent.status,
          role: { name: 'STUDENT' },
        }),
        update: async ({ data }) => {
          legacyStudent.status = data.status;
          return legacyStudent;
        },
      },
      programEnrollment: { findFirst: async () => null },
      programApplication: {
        findFirst: async () => null,
        create: async ({ data }) => {
          createdApplications += 1;
          return { ...application, ...data };
        },
      },
      programApplicationStatusHistory: {
        create: async () => {
          statusHistoryEntries += 1;
          return { id: 'history-1' };
        },
      },
      intakeProgramOffering: { findFirst: async () => openOffering() },
    })),
  ];
  let server;
  try {
    server = await startServer();
    const response = await send(server, '/applications', {
      method: 'POST',
      user: legacyStudent,
      body: { programOfferingId: 'offering-1' },
    });
    assert.equal(response.status, 201);
    assert.equal(legacyStudent.status, 'PENDING');
    assert.equal(createdApplications, 1);
    assert.equal(statusHistoryEntries, 1);
    assert.equal((await response.json()).data.id, application.id);
    const status = await send(server, '/applications/me', { user: legacyStudent });
    assert.equal(status.status, 200);
    const statusPayload = await status.json();
    assert.equal(statusPayload.data.academicAccess, false);
    assert.equal(statusPayload.data.canApply, false);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('an active legacy student without a Program enrollment cannot use academic APIs', async () => {
  const activeStudent = { id: 'legacy-student', status: 'ACTIVE', role: { name: 'STUDENT' } };
  const restores = [
    restoreAuth(activeStudent),
    stubMethod(prisma.programEnrollment, 'findFirst', async () => null),
  ];
  let server;
  try {
    server = await startServer();
    const response = await send(server, '/dashboard/student', { user: activeStudent });
    assert.equal(response.status, 403);
    assert.match((await response.json()).message, /active Program enrollment/i);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('a concurrent application transaction conflict returns a retryable conflict', async () => {
  const legacyStudent = { id: 'legacy-student', status: 'ACTIVE', role: { name: 'STUDENT' } };
  const conflict = Object.assign(new Error('serialization conflict'), { code: 'P2034' });
  const restores = [
    restoreAuth(legacyStudent),
    stubMethod(prisma, '$transaction', async () => {
      throw conflict;
    }),
  ];
  let server;
  try {
    server = await startServer();
    const response = await send(server, '/applications', {
      method: 'POST',
      user: legacyStudent,
      body: { programOfferingId: 'offering-1' },
    });
    assert.equal(response.status, 409);
    assert.match((await response.json()).message, /changed concurrently/i);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('Super Admins can create one-time Student invitations', async () => {
  let createdInvitation;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async ({ where }) => (
      where.id ? admin : null
    )),
    stubMethod(prisma.role, 'upsert', async () => ({ id: 'student-role', name: 'STUDENT' })),
    stubMethod(prisma.invitation, 'create', async ({ data }) => {
      createdInvitation = data;
      return { id: 'invitation-1', ...data };
    }),
    stubMethod(prisma.auditLog, 'create', async () => ({ id: 'audit-1' })),
  ];
  let server;
  try {
    server = await startServer();
    const response = await send(server, '/auth/invitations', {
      method: 'POST',
      body: { email: 'learner@example.test', role: 'STUDENT' },
    });
    assert.equal(response.status, 201);
    assert.equal(createdInvitation.email, 'learner@example.test');
    assert.equal(createdInvitation.roleId, 'student-role');
    assert.equal((await response.json()).data.emailSent, false);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('Super Admin and other unsupported roles cannot be invited through staff invitations', async () => {
  let invitationCreated = false;
  const restores = [
    restoreAuth(),
    stubMethod(prisma.role, 'upsert', async () => assert.fail('Unsupported roles must not be created')),
    stubMethod(prisma.invitation, 'create', async () => {
      invitationCreated = true;
      return {};
    }),
  ];
  let server;
  try {
    server = await startServer();
    const response = await send(server, '/auth/invitations', {
      method: 'POST',
      body: { email: 'admin@example.test', role: 'SUPER_ADMIN' },
    });
    assert.equal(response.status, 400);
    assert.equal(invitationCreated, false);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('students can accept invitations and receive active accounts', async () => {
  const invitation = {
    id: 'invitation-1',
    email: 'learner@example.test',
    token: 'student-invite-token',
    roleId: 'student-role',
    acceptedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
  };
  let createdUser;
  const restores = [
    stubMethod(prisma.invitation, 'findUnique', async () => invitation),
    stubMethod(prisma.role, 'findUnique', async () => ({ id: 'student-role', name: 'STUDENT' })),
    stubMethod(prisma.user, 'findUnique', async () => null),
    stubMethod(prisma.user, 'create', async ({ data, include }) => {
      createdUser = { id: 'student-new', ...data, role: { name: 'STUDENT' } };
      assert.equal(include.role, true);
      return createdUser;
    }),
    stubMethod(prisma.invitation, 'update', async () => invitation),
    stubMethod(prisma.auditLog, 'create', async () => ({ id: 'audit-1' })),
  ];
  let server;
  try {
    server = await startServer();
    const response = await send(server, '/auth/accept-invitation', {
      method: 'POST',
      body: {
        token: invitation.token,
        password: 'a-secure-test-password',
        confirmPassword: 'a-secure-test-password',
      },
    });
    assert.equal(response.status, 201);
    assert.equal(createdUser.roleId, 'student-role');
    assert.equal(createdUser.status, 'ACTIVE');
    assert.deepEqual((await response.json()).data, {
      id: 'student-new',
      role: 'STUDENT',
      status: 'ACTIVE',
    });
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});
