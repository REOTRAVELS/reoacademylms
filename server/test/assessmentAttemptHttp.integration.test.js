import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ||= 'assessment-attempt-http-integration-secret';
process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test';

const [{ default: app }, { default: prisma }, { signToken }] = await Promise.all([
  import('../src/app.js'),
  import('../src/config/database.js'),
  import('../src/utils/jwt.js'),
]);

const student = { id: 'student-1', status: 'ACTIVE', role: { name: 'STUDENT' } };
const assessment = {
  id: 'assessment-1',
  courseId: 'course-1',
  status: 'PUBLISHED',
  attemptLimit: 1,
  availableFrom: null,
  availableTo: null,
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

const startAttemptRequest = (server) => fetch(
  `http://127.0.0.1:${server.address().port}/api/assessments/${assessment.id}/attempts`,
  { method: 'POST', headers: { Cookie: `reoa_session=${signToken({ sub: student.id })}` } },
);

const getAttemptRequest = (server) => fetch(
  `http://127.0.0.1:${server.address().port}/api/assessments/attempts/attempt-1`,
  { headers: { Cookie: `reoa_session=${signToken({ sub: student.id })}` } },
);

const setupAccess = () => [
  stubMethod(prisma.user, 'findUnique', async () => student),
  stubMethod(prisma.programEnrollment, 'findFirst', async () => ({ id: 'program-enrollment-1' })),
  stubMethod(prisma.assessment, 'findUnique', async () => assessment),
  stubMethod(prisma.question, 'count', async () => 1),
  stubMethod(prisma.course, 'findFirst', async () => ({ id: assessment.courseId })),
];

test('assessment attempt limit is checked atomically with attempt creation', async () => {
  const transactionOptions = [];
  let savedAttempt;
  const restores = [
    ...setupAccess(),
    stubMethod(prisma, '$transaction', async (callback, options) => {
      transactionOptions.push(options);
      return callback({
        assessmentAttempt: {
          count: async () => 0,
          create: async ({ data }) => {
            savedAttempt = { id: 'attempt-1', ...data };
            return savedAttempt;
          },
        },
      });
    }),
  ];
  let server;
  try {
    server = await startServer();
    const response = await startAttemptRequest(server);
    assert.equal(response.status, 201);
    assert.equal(savedAttempt.studentId, student.id);
    assert.equal(savedAttempt.assessmentId, assessment.id);
    assert.equal(transactionOptions[0].isolationLevel, 'Serializable');
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('assessment attempt limit rejects a start when all attempts are already used', async () => {
  let createCount = 0;
  const restores = [
    ...setupAccess(),
    stubMethod(prisma, '$transaction', async (callback) => callback({
      assessmentAttempt: {
        count: async () => assessment.attemptLimit,
        create: async () => { createCount += 1; },
      },
    })),
  ];
  let server;
  try {
    server = await startServer();
    const response = await startAttemptRequest(server);
    assert.equal(response.status, 403);
    assert.equal(createCount, 0);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('concurrent assessment attempt conflict is returned as a retryable response', async () => {
  const restores = [
    ...setupAccess(),
    stubMethod(prisma, '$transaction', async () => {
      const conflict = new Error('transaction conflict');
      conflict.code = 'P2034';
      throw conflict;
    }),
  ];
  let server;
  try {
    server = await startServer();
    const response = await startAttemptRequest(server);
    assert.equal(response.status, 409);
    assert.match((await response.json()).message, /started at the same time/i);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('simultaneous starts cannot create more attempts than the configured limit', async () => {
  let releaseCountBarrier;
  const countBarrier = new Promise((resolve) => { releaseCountBarrier = resolve; });
  let countCalls = 0;
  let attemptCount = 0;
  const restores = [
    ...setupAccess(),
    stubMethod(prisma, '$transaction', async (callback) => callback({
      assessmentAttempt: {
        count: async () => {
          const visibleAttempts = attemptCount;
          countCalls += 1;
          if (countCalls === 2) releaseCountBarrier();
          await countBarrier;
          return visibleAttempts;
        },
        create: async ({ data }) => {
          if (attemptCount >= assessment.attemptLimit) {
            const conflict = new Error('serializable write conflict');
            conflict.code = 'P2034';
            throw conflict;
          }
          attemptCount += 1;
          return { id: `attempt-${attemptCount}`, ...data };
        },
      },
    })),
  ];
  let server;
  try {
    server = await startServer();
    const responses = await Promise.all([
      startAttemptRequest(server),
      startAttemptRequest(server),
    ]);
    assert.deepEqual(responses.map(({ status }) => status).sort(), [201, 409]);
    assert.equal(attemptCount, assessment.attemptLimit);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('student API withholds submitted examination results and answer review until release', async () => {
  const submittedAttempt = {
    id: 'attempt-1',
    assessmentId: assessment.id,
    studentId: student.id,
    submittedAt: new Date(),
    score: 9,
    maxScore: 10,
    status: 'GRADED',
    answers: [{ questionId: 'question-1', answer: 'A', isCorrect: true, points: 9 }],
    assessment: {
      ...assessment,
      type: 'EXAMINATION',
      resultsReleased: false,
      passMarkPercent: 50,
      questions: [{ id: 'question-1', prompt: 'Question', correctAnswer: 'A' }],
    },
  };
  const restores = [
    ...setupAccess(),
    stubMethod(prisma.assessmentAttempt, 'findUnique', async () => submittedAttempt),
  ];
  let server;
  try {
    server = await startServer();
    const response = await getAttemptRequest(server);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.score, null);
    assert.equal(body.data.maxScore, null);
    assert.deepEqual(body.data.answers, []);
    assert.deepEqual(body.data.assessment.questions, []);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('only an administrator can individually release a graded examination result', async () => {
  const admin = { id: 'admin-1', status: 'ACTIVE', role: { name: 'SUPER_ADMIN' } };
  const gradedAttempt = {
    id: 'attempt-1',
    assessmentId: 'exam-1',
    studentId: student.id,
    submittedAt: new Date(),
    score: 9,
    maxScore: 10,
    status: 'GRADED',
    resultsReleasedAt: null,
    assessment: { id: 'exam-1', type: 'EXAMINATION' },
  };
  let releaseData;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => admin),
    stubMethod(prisma.assessmentAttempt, 'findUnique', async () => gradedAttempt),
    stubMethod(prisma.assessmentAttempt, 'update', async ({ data }) => {
      releaseData = data;
      return { ...gradedAttempt, ...data };
    }),
    stubMethod(prisma.auditLog, 'create', async () => ({ id: 'audit-1' })),
  ];
  let server;
  try {
    server = await startServer();
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/assessments/attempts/${gradedAttempt.id}/release-results`,
      {
        method: 'POST',
        headers: {
          Cookie: `reoa_session=${signToken({ sub: admin.id })}`,
          'content-type': 'application/json',
        },
      },
    );

    assert.equal(response.status, 200);
    assert.ok(releaseData.resultsReleasedAt instanceof Date);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('student cannot open an assessment assigned to another Program Offering', async () => {
  const scopedAssessment = {
    ...assessment,
    programOfferingId: 'offering-spring',
    questions: [{ id: 'question-1', prompt: 'Spring-only question', correctAnswer: 'A' }],
  };
  let enrollmentQueries = 0;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => student),
    stubMethod(prisma.programEnrollment, 'findFirst', async ({ where }) => {
      enrollmentQueries += 1;
      return where.programOfferingId
        ? null
        : { id: 'enrollment-winter', programOfferingId: 'offering-winter' };
    }),
    stubMethod(prisma.assessment, 'findUnique', async () => scopedAssessment),
    stubMethod(prisma.course, 'findFirst', async () => ({ id: assessment.courseId })),
  ];
  let server;
  try {
    server = await startServer();
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/assessments/${assessment.id}`,
      { headers: { Cookie: `reoa_session=${signToken({ sub: student.id })}` } },
    );

    assert.equal(response.status, 404);
    assert.equal(enrollmentQueries, 2);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('student assessment lists include only shared activity and their active Program Offering', async () => {
  let query;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => student),
    stubMethod(prisma.programEnrollment, 'findFirst', async () => ({
      id: 'enrollment-winter',
      programOfferingId: 'offering-winter',
    })),
    stubMethod(prisma.assessment, 'findMany', async (args) => {
      query = args;
      return [];
    }),
  ];
  let server;
  try {
    server = await startServer();
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/assessments`, {
      headers: { Cookie: `reoa_session=${signToken({ sub: student.id })}` },
    });

    assert.equal(response.status, 200);
    assert.ok(query.where.AND[0].course);
    assert.deepEqual(query.where.AND[1].OR[0], { programOfferingId: null });
    assert.equal(
      query.where.AND[1].OR[1].programOffering.is.programEnrollments.some.studentId,
      student.id,
    );
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});
