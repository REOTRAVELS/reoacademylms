import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ||= 'intakes-http-integration-secret';
process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test';

const [{ default: app }, { default: prisma }, { signToken }] = await Promise.all([
  import('../src/app.js'),
  import('../src/config/database.js'),
  import('../src/utils/jwt.js'),
]);

const admin = { id: 'admin-1', status: 'ACTIVE', role: { name: 'SUPER_ADMIN' } };
const sampleIntake = {
  gateNumber: 1,
  season: 'WINTER',
  year: 2027,
  timezone: 'UTC',
};

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

const authRestore = (user = admin) => stubMethod(prisma.user, 'findUnique', async () => user);

test('intake creation rejects mismatched GATE metadata and legacy intake-level dates', async () => {
  let createCalled = false;
  const restores = [
    authRestore(),
    stubMethod(prisma.intake, 'create', async () => {
      createCalled = true;
      return {};
    }),
  ];
  let server;
  try {
    server = await startServer();
    const mismatch = await send(server, '/intakes', {
      method: 'POST',
      body: { ...sampleIntake, season: 'SPRING' },
    });
    assert.equal(mismatch.status, 400);
    assert.match((await mismatch.json()).message, /gate number does not match/i);

    const intakeLevelDates = await send(server, '/intakes', {
      method: 'POST',
      body: { ...sampleIntake, academicStartDate: '2027-01-15', academicEndDate: '2027-03-31' },
    });
    assert.equal(intakeLevelDates.status, 400);
    assert.match((await intakeLevelDates.json()).message, /unsupported intake field/i);
    assert.equal(createCalled, false);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('new intakes are open for registration by default without admission dates', async () => {
  let createdData;
  const restores = [
    authRestore(),
    stubMethod(prisma.intake, 'create', async ({ data }) => {
      createdData = data;
      return { id: 'intake-1', ...data };
    }),
    stubMethod(prisma.auditLog, 'create', async () => ({ id: 'audit-1' })),
  ];
  let server;
  try {
    server = await startServer();
    const response = await send(server, '/intakes', {
      method: 'POST',
      body: sampleIntake,
    });
    assert.equal(response.status, 201);
    assert.equal(createdData.admissionsOpen, true);
    assert.equal(createdData.status, 'UPCOMING');
    assert.equal('admissionStartDate' in createdData, false);
    assert.equal('admissionEndDate' in createdData, false);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('program date updates interpret local time in the intake timezone and audit the change', async () => {
  const offering = {
    id: 'offering-1',
    academicStartDate: new Date('2027-01-15T00:00:00.000Z'),
    academicEndDate: new Date('2027-03-31T00:00:00.000Z'),
    intake: { status: 'UPCOMING', season: 'WINTER', year: 2027, timezone: 'America/New_York' },
    programme: { status: 'ACTIVE' },
  };
  let updatedData;
  let auditMetadata;
  const restores = [
    authRestore(),
    stubMethod(prisma.intakeProgramOffering, 'findFirst', async () => offering),
    stubMethod(prisma.intakeProgramOffering, 'update', async ({ data }) => {
      updatedData = data;
      return { ...offering, ...data };
    }),
    stubMethod(prisma.auditLog, 'create', async ({ data }) => {
      auditMetadata = data.metadata;
      return { id: 'audit-1' };
    }),
  ];
  let server;
  try {
    server = await startServer();
    const response = await send(server, '/intakes/intake-1/offerings/offering-1', {
      method: 'PATCH',
      body: { academicStartDate: '2027-01-15T09:30', academicEndDate: '2027-03-31' },
    });
    assert.equal(response.status, 200);
    assert.equal(updatedData.academicStartDate.toISOString(), '2027-01-15T14:30:00.000Z');
    assert.equal(auditMetadata.previousAcademicStartDate, '2027-01-15T00:00:00.000Z');
    assert.equal(auditMetadata.academicStartDate, '2027-01-15T14:30:00.000Z');
    assert.equal(auditMetadata.academicEndDate, '2027-03-31');
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('weekly timetable is saved on a program offering and invalid schedules are rejected', async () => {
  const offering = {
    id: 'offering-1',
    schedule: null,
    timetableStoragePath: 'private/timetable.pdf',
    academicStartDate: new Date('2027-01-15T00:00:00.000Z'),
    academicEndDate: new Date('2027-03-31T00:00:00.000Z'),
    intake: { status: 'ACTIVE', season: 'WINTER', year: 2027, timezone: 'UTC' },
    programme: { status: 'ACTIVE' },
    _count: { cohorts: 0 },
  };
  let updatedData;
  const restores = [
    authRestore(),
    stubMethod(prisma.intakeProgramOffering, 'findFirst', async () => offering),
    stubMethod(prisma.intakeProgramOffering, 'update', async ({ data }) => {
      updatedData = data;
      return { ...offering, ...data };
    }),
    stubMethod(prisma.auditLog, 'create', async () => ({ id: 'audit-1' })),
  ];
  let server;
  try {
    server = await startServer();
    const saved = await send(server, '/intakes/intake-1/offerings/offering-1', {
      method: 'PATCH',
      body: { schedule: 'Mon, Wed 09:00-10:30' },
    });
    assert.equal(saved.status, 200);
    assert.equal(updatedData.schedule, 'Mon, Wed 09:00-10:30');
    const responseData = (await saved.json()).data;
    assert.equal(responseData.schedule, 'Mon, Wed 09:00-10:30');
    assert.equal('timetableStoragePath' in responseData, false);

    const invalid = await send(server, '/intakes/intake-1/offerings/offering-1', {
      method: 'PATCH',
      body: { schedule: 'Mon 24:00-25:00' },
    });
    assert.equal(invalid.status, 400);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('active students can access the offering timetable endpoint', async () => {
  const student = { id: 'student-1', status: 'ACTIVE', role: { name: 'STUDENT' } };
  const restores = [
    authRestore(student),
    stubMethod(prisma.intakeProgramOffering, 'findFirst', async () => ({
      id: 'offering-1',
      timetableStoragePath: null,
    })),
  ];
  let server;
  try {
    server = await startServer();
    const response = await send(server, '/intakes/intake-1/offerings/offering-1/timetable', { user: student });
    assert.equal(response.status, 404);
    assert.match((await response.json()).message, /timetable not found/i);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('intake registration can be controlled independently of program start dates', async () => {
  const current = {
    id: 'intake-1',
    ...sampleIntake,
    admissionsOpen: false,
    status: 'UPCOMING',
    programOfferings: [],
  };
  let updateCalled = false;
  const restores = [
    authRestore(),
    stubMethod(prisma.intake, 'findUnique', async () => current),
    stubMethod(prisma.intake, 'update', async ({ data }) => {
      updateCalled = true;
      return { ...current, ...data };
    }),
    stubMethod(prisma.auditLog, 'create', async () => ({ id: 'audit-1' })),
  ];
  let server;
  try {
    server = await startServer();
    const response = await send(server, '/intakes/intake-1', {
      method: 'PUT',
      body: { admissionsOpen: true },
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.admissionsOpen, true);
    assert.equal(updateCalled, true);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('admins can review academic date history for each program offering', async () => {
  const auditHistory = [
    {
      id: 'audit-1',
      entityId: 'offering-1',
      action: 'UPDATE_INTAKE_PROGRAM_OFFERING',
      createdAt: new Date('2026-11-14T12:00:00.000Z'),
      metadata: {
        previousAcademicStartDate: '2027-01-15T00:00:00.000Z',
        academicStartDate: '2027-01-15T14:30:00.000Z',
        previousAcademicEndDate: '2027-03-31',
        academicEndDate: '2027-03-31',
      },
      actor: { firstName: 'Ada', lastName: 'Admin' },
    },
  ];
  const restores = [
    authRestore(),
    stubMethod(prisma.intake, 'findUnique', async () => ({
      id: 'intake-1',
      ...sampleIntake,
      programOfferings: [{ id: 'offering-1', academicStartDate: new Date('2027-01-15T00:00:00.000Z'), academicEndDate: new Date('2027-03-31T00:00:00.000Z') }],
    })),
    stubMethod(prisma.programEnrollment, 'findMany', async () => []),
    stubMethod(prisma.auditLog, 'findMany', async ({ where, take }) => {
      assert.deepEqual(where, {
        entity: 'IntakeProgramOffering',
        entityId: { in: ['offering-1'] },
        action: 'UPDATE_INTAKE_PROGRAM_OFFERING',
      });
      assert.equal(take, 100);
      return auditHistory;
    }),
  ];
  let server;
  try {
    server = await startServer();
    const response = await send(server, '/intakes/intake-1');
    assert.equal(response.status, 200);
    const intake = (await response.json()).data;
    assert.equal(intake.programOfferings[0].auditHistory.length, 1);
    assert.equal(intake.programOfferings[0].auditHistory[0].actor, 'Ada Admin');
    assert.equal(intake.programOfferings[0].auditHistory[0].metadata.previousAcademicEndDate, '2027-03-31');
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('intake creation maps duplicate gate and year to a conflict response', async () => {
  let createCount = 0;
  const restores = [
    authRestore(),
    stubMethod(prisma.intake, 'create', async ({ data }) => {
      createCount += 1;
      if (createCount === 2) throw Object.assign(new Error('duplicate key'), { code: 'P2002' });
      return { id: 'intake-1', ...data };
    }),
    stubMethod(prisma.auditLog, 'create', async () => ({ id: 'audit-1' })),
  ];
  let server;
  try {
    server = await startServer();
    const first = await send(server, '/intakes', { method: 'POST', body: sampleIntake });
    assert.equal(first.status, 201);
    assert.equal((await first.json()).data.admissionsOpen, true);

    const duplicate = await send(server, '/intakes', { method: 'POST', body: sampleIntake });
    assert.equal(duplicate.status, 409);
    assert.equal(createCount, 2);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('admins can add multiple programs atomically and duplicate offerings are rejected', async () => {
  const existingOfferings = [];
  let createManyCount = 0;
  let savedRows;
  const restores = [
    authRestore(),
    stubMethod(prisma.intake, 'findUnique', async () => ({
      id: 'intake-1',
      status: 'UPCOMING',
      season: 'WINTER',
      year: 2027,
      timezone: 'UTC',
    })),
    stubMethod(prisma.programme, 'findMany', async ({ where }) =>
      [{ id: 'programme-1' }, { id: 'programme-2' }].filter(({ id }) => where.id.in.includes(id))),
    stubMethod(prisma.intakeProgramOffering, 'findMany', async () => existingOfferings),
    stubMethod(prisma.intakeProgramOffering, 'createMany', async () => {
      throw new Error('transaction delegate should handle bulk creation');
    }),
    stubMethod(prisma, '$transaction', async (operation) => operation({
      intakeProgramOffering: {
        createMany: async ({ data }) => {
          createManyCount += 1;
          savedRows = data;
          existingOfferings.push(...data.map(({ programmeId }) => ({ programmeId })));
        },
        findMany: async () => savedRows.map((row, index) => ({
          id: `offering-${index + 1}`,
          ...row,
          programme: { id: row.programmeId },
          _count: { cohorts: 0 },
        })),
      },
    })),
    stubMethod(prisma.auditLog, 'create', async () => ({ id: 'audit-1' })),
  ];
  let server;
  try {
    server = await startServer();
    const added = await send(server, '/intakes/intake-1/offerings', {
      method: 'POST',
      body: {
        offerings: [
          { programmeId: 'programme-1', academicStartDate: '2027-01-15T09:00', academicEndDate: '2027-03-31' },
          { programmeId: 'programme-2', academicStartDate: '2027-02-01T10:00', academicEndDate: '2027-03-30' },
        ],
      },
    });
    assert.equal(added.status, 201);
    assert.equal((await added.json()).data.length, 2);
    assert.deepEqual(savedRows.map(({ status }) => status), ['ACTIVE', 'ACTIVE']);
    assert.deepEqual(savedRows.map(({ academicStartDate }) => academicStartDate.toISOString()), [
      '2027-01-15T09:00:00.000Z',
      '2027-02-01T10:00:00.000Z',
    ]);

    const duplicate = await send(server, '/intakes/intake-1/offerings', {
      method: 'POST',
      body: {
        offerings: [{ programmeId: 'programme-1', academicStartDate: '2027-01-15T09:00', academicEndDate: '2027-03-31' }],
      },
    });
    assert.equal(duplicate.status, 409);
    assert.equal(createManyCount, 1);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('offering removal is blocked by cohort, application, or enrollment history', async () => {
  const current = {
    id: 'intake-1',
    ...sampleIntake,
    admissionsOpen: true,
    status: 'ACTIVE',
    programOfferings: [],
  };
  let updatedData;
  let deleteCalled = false;
  let dependencyCounts = { cohorts: 1, applications: 0, programEnrollments: 0 };
  const restores = [
    authRestore(),
    stubMethod(prisma.intake, 'findUnique', async () => current),
    stubMethod(prisma.intake, 'update', async ({ data }) => {
      updatedData = data;
      return { ...current, ...data };
    }),
    stubMethod(prisma.intakeProgramOffering, 'findFirst', async () => ({
      id: 'offering-1',
      _count: dependencyCounts,
    })),
    stubMethod(prisma.intakeProgramOffering, 'delete', async () => {
      deleteCalled = true;
    }),
    stubMethod(prisma.auditLog, 'create', async () => ({ id: 'audit-1' })),
  ];
  let server;
  try {
    server = await startServer();
    const archived = await send(server, '/intakes/intake-1', {
      method: 'PUT',
      body: { status: 'ARCHIVED' },
    });
    assert.equal(archived.status, 200);
    assert.equal(updatedData.status, 'ARCHIVED');
    assert.equal(updatedData.admissionsOpen, false);

    const removal = await send(server, '/intakes/intake-1/offerings/offering-1', { method: 'DELETE' });
    assert.equal(removal.status, 409);
    assert.equal(deleteCalled, false);

    dependencyCounts = { cohorts: 0, applications: 1, programEnrollments: 0 };
    const applicationHistoryRemoval = await send(server, '/intakes/intake-1/offerings/offering-1', { method: 'DELETE' });
    assert.equal(applicationHistoryRemoval.status, 409);
    assert.equal(deleteCalled, false);

    dependencyCounts = { cohorts: 0, applications: 0, programEnrollments: 1 };
    const enrollmentRemoval = await send(server, '/intakes/intake-1/offerings/offering-1', { method: 'DELETE' });
    assert.equal(enrollmentRemoval.status, 409);
    assert.equal(deleteCalled, false);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('intake list and detail reads return their persisted records', async () => {
  const intake = { id: 'intake-1', gateNumber: 1, season: 'WINTER', year: 2027, programOfferings: [] };
  const restores = [
    authRestore(),
    stubMethod(prisma.intake, 'findMany', async () => [intake]),
    stubMethod(prisma.intake, 'findUnique', async ({ where }) => where.id === intake.id ? intake : null),
    stubMethod(prisma.programEnrollment, 'findMany', async () => []),
    stubMethod(prisma.auditLog, 'findMany', async () => []),
  ];
  let server;
  try {
    server = await startServer();
    const listed = await send(server, '/intakes');
    assert.equal(listed.status, 200);
    assert.deepEqual((await listed.json()).data.map(({ id }) => id), ['intake-1']);

    const detail = await send(server, '/intakes/intake-1');
    assert.equal(detail.status, 200);
    assert.equal((await detail.json()).data.season, 'WINTER');
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('intake list reports distinct approved, waiting, and eligible student counts', async () => {
  const now = new Date();
  const intakes = [
    { id: 'future-intake', programOfferings: [] },
    { id: 'started-intake', programOfferings: [] },
  ];
  const activeEnrollment = (intakeId, studentId, academicStartDate) => ({
    intakeId,
    studentId,
    status: 'ACTIVE',
    effectiveAt: new Date(now.getTime() - 60_000),
    endedAt: null,
    application: { status: 'APPROVED' },
    student: { status: 'ACTIVE' },
    programOffering: { academicStartDate },
  });
  const restores = [
    authRestore(),
    stubMethod(prisma.intake, 'findMany', async () => intakes),
    stubMethod(prisma.programEnrollment, 'findMany', async () => [
      activeEnrollment('future-intake', 'student-1', new Date(now.getTime() + 60_000)),
      activeEnrollment('future-intake', 'student-1', new Date(now.getTime() + 60_000)),
      activeEnrollment('future-intake', 'student-2', new Date(now.getTime() + 60_000)),
      activeEnrollment('started-intake', 'student-3', new Date(now.getTime() - 60_000)),
    ]),
  ];
  let server;
  try {
    server = await startServer();
    const response = await send(server, '/intakes');
    assert.equal(response.status, 200);
    const rows = (await response.json()).data;
    assert.deepEqual(rows[0].studentCounts, { approved: 2, waiting: 2, eligible: 0 });
    assert.deepEqual(rows[1].studentCounts, { approved: 1, waiting: 0, eligible: 1 });
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('offerings can be activated and removed while no cohorts depend on them', async () => {
  const offering = {
    id: 'offering-1',
    intake: { status: 'ACTIVE' },
    programme: { status: 'ACTIVE' },
    _count: { cohorts: 0 },
  };
  let updatedData;
  let deleteCalled = false;
  const restores = [
    authRestore(),
    stubMethod(prisma.intakeProgramOffering, 'findFirst', async () => offering),
    stubMethod(prisma.intakeProgramOffering, 'update', async ({ data }) => {
      updatedData = data;
      return { ...offering, ...data };
    }),
    stubMethod(prisma.intakeProgramOffering, 'delete', async () => {
      deleteCalled = true;
    }),
    stubMethod(prisma.auditLog, 'create', async () => ({ id: 'audit-1' })),
  ];
  let server;
  try {
    server = await startServer();
    const activated = await send(server, '/intakes/intake-1/offerings/offering-1', {
      method: 'PATCH',
      body: { status: 'ACTIVE' },
    });
    assert.equal(activated.status, 200);
    assert.equal(updatedData.status, 'ACTIVE');

    const removed = await send(server, '/intakes/intake-1/offerings/offering-1', { method: 'DELETE' });
    assert.equal(removed.status, 200);
    assert.equal(deleteCalled, true);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('intake mutations are restricted to super administrators', async () => {
  let createCalled = false;
  const trainer = { id: 'trainer-1', status: 'ACTIVE', role: { name: 'TRAINER' } };
  const restores = [
    authRestore(trainer),
    stubMethod(prisma.intake, 'create', async () => {
      createCalled = true;
      return {};
    }),
  ];
  let server;
  try {
    server = await startServer();
    const response = await send(server, '/intakes', { method: 'POST', body: sampleIntake, user: trainer });
    assert.equal(response.status, 403);
    assert.equal(createCalled, false);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('programme qualification type can be set and explicitly cleared', async () => {
  let createdData;
  let updatedData;
  const restores = [
    authRestore(),
    stubMethod(prisma.programme, 'findUnique', async () => null),
    stubMethod(prisma.programme, 'create', async ({ data }) => {
      createdData = data;
      return { id: 'programme-1', ...data };
    }),
    stubMethod(prisma.programme, 'update', async ({ data }) => {
      updatedData = data;
      return { id: 'programme-1', ...data };
    }),
    stubMethod(prisma.auditLog, 'create', async () => ({ id: 'audit-1' })),
  ];
  let server;
  try {
    server = await startServer();
    const created = await send(server, '/programmes', {
      method: 'POST',
      body: { title: 'Applied Studies', qualificationType: 'Certificate' },
    });
    assert.equal(created.status, 201);
    assert.equal(createdData.qualificationType, 'Certificate');

    const updated = await send(server, '/programmes/programme-1', {
      method: 'PUT',
      body: { qualificationType: null },
    });
    assert.equal(updated.status, 200);
    assert.equal(updatedData.qualificationType, null);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('new cohorts can only reference an active offering for the same programme', async () => {
  let cohortData;
  const restores = [
    authRestore(),
    stubMethod(prisma.intakeProgramOffering, 'findFirst', async ({ where }) => (
      where.programmeId === 'programme-1' ? { id: 'offering-1' } : null
    )),
    stubMethod(prisma.cohort, 'create', async ({ data }) => {
      cohortData = data;
      return { id: 'cohort-1', ...data };
    }),
    stubMethod(prisma.auditLog, 'create', async () => ({ id: 'audit-1' })),
  ];
  let server;
  try {
    server = await startServer();
    const assigned = await send(server, '/cohorts', {
      method: 'POST',
      body: {
        name: 'Winter cohort',
        programmeId: 'programme-1',
        intakeProgramOfferingId: 'offering-1',
      },
    });
    assert.equal(assigned.status, 201);
    assert.equal(cohortData.intakeProgramOfferingId, 'offering-1');

    const mismatched = await send(server, '/cohorts', {
      method: 'POST',
      body: {
        name: 'Mismatched cohort',
        programmeId: 'programme-2',
        intakeProgramOfferingId: 'offering-1',
      },
    });
    assert.equal(mismatched.status, 400);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});
