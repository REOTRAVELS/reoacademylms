import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';

process.env.JWT_SECRET ||= 'assessment-builder-http-integration-secret';
process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test';

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

test('assessment builder creates, configures, and publishes a ready assessment', async () => {
  const admin = { id: 'admin-1', status: 'ACTIVE', role: { name: 'SUPER_ADMIN' } };
  const assessment = {
    id: 'assessment-1',
    courseId: 'course-1',
    title: 'Travel safety check',
    description: 'Check the essentials.',
    instructions: 'Select the safest choice.',
    timeLimitMin: 15,
    attemptLimit: 2,
    passMarkPercent: 70,
    status: 'DRAFT',
    availableFrom: null,
    availableTo: null,
  };
  let createdAssessment;
  let createdQuestion;
  const questionWrites = [];
  let updatedAssessment;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => admin),
    stubMethod(prisma.assessment, 'create', async ({ data }) => {
      createdAssessment = data;
      return assessment;
    }),
    stubMethod(prisma.assessment, 'findUnique', async (args) => (
      args.include?.questions ? { ...assessment, questions: [createdQuestion] } : assessment
    )),
    stubMethod(prisma.assessment, 'update', async ({ data }) => {
      updatedAssessment = data;
      return { ...assessment, ...data };
    }),
    stubMethod(prisma.assessmentAttempt, 'count', async () => 0),
    stubMethod(prisma.question, 'count', async () => 0),
    stubMethod(prisma.question, 'create', async ({ data }) => {
      questionWrites.push(data);
      createdQuestion = { id: 'question-1', ...data };
      return {
        ...createdQuestion,
        options: data.options === Prisma.DbNull ? null : data.options,
        correctAnswer: data.correctAnswer === Prisma.DbNull ? null : data.correctAnswer,
      };
    }),
    stubMethod(prisma.auditLog, 'create', async () => ({ id: 'audit-1' })),
  ];
  let server;
  try {
    server = await startServer();
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/assessments`;
    const headers = {
      Cookie: `reoa_session=${signToken({ sub: admin.id })}`,
      'content-type': 'application/json',
    };

    const createResponse = await fetch(baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        courseId: 'course-1',
        title: 'Travel safety check',
        description: 'Check the essentials.',
        instructions: 'Select the safest choice.',
        timeLimitMin: 15,
        attemptLimit: 2,
        passMarkPercent: 70,
        status: 'DRAFT',
      }),
    });
    assert.equal(createResponse.status, 201);
    assert.equal(createdAssessment.instructions, 'Select the safest choice.');
    assert.equal(createdAssessment.passMarkPercent, 70);
    assert.equal(createdAssessment.type, 'ASSESSMENT');

    const questionResponse = await fetch(`${baseUrl}/assessment-1/questions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        type: 'MULTIPLE_CHOICE',
        prompt: 'What should the traveler do first?',
        points: 2,
        options: ['Check the advisory', 'Ignore the route'],
        correctAnswer: 'Check the advisory',
        explanation: 'Review current travel guidance.',
      }),
    });
    assert.equal(questionResponse.status, 201);
    assert.equal(createdQuestion.explanation, 'Review current travel guidance.');

    const shortAnswerResponse = await fetch(`${baseUrl}/assessment-1/questions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        type: 'SHORT_ANSWER',
        prompt: 'Name one travel document to verify.',
        points: 1,
      }),
    });
    assert.equal(shortAnswerResponse.status, 201);
    assert.equal(questionWrites[1].options, Prisma.DbNull);
    assert.equal(questionWrites[1].correctAnswer, Prisma.DbNull);

    const publishResponse = await fetch(`${baseUrl}/assessment-1`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ status: 'PUBLISHED' }),
    });
    assert.equal(publishResponse.status, 200);
    assert.equal(updatedAssessment.status, 'PUBLISHED');
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('assessment builder rejects invalid availability ranges before persisting', async () => {
  const admin = { id: 'admin-1', status: 'ACTIVE', role: { name: 'SUPER_ADMIN' } };
  let createCount = 0;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => admin),
    stubMethod(prisma.assessment, 'create', async () => { createCount += 1; }),
  ];
  let server;
  try {
    server = await startServer();
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/assessments`, {
      method: 'POST',
      headers: {
        Cookie: `reoa_session=${signToken({ sub: admin.id })}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        courseId: 'course-1',
        title: 'Invalid assessment',
        availableFrom: '2027-03-01T00:00:00.000Z',
        availableTo: '2027-02-01T00:00:00.000Z',
      }),
    });

    assert.equal(response.status, 400);
    assert.equal(createCount, 0);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('assessment updates reject ranges that conflict with saved availability dates', async () => {
  const admin = { id: 'admin-1', status: 'ACTIVE', role: { name: 'SUPER_ADMIN' } };
  let updateCount = 0;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => admin),
    stubMethod(prisma.assessment, 'findUnique', async () => ({
      id: 'assessment-1',
      courseId: 'course-1',
      status: 'DRAFT',
      availableFrom: new Date('2027-03-01T00:00:00.000Z'),
      availableTo: null,
    })),
    stubMethod(prisma.assessmentAttempt, 'count', async () => 0),
    stubMethod(prisma.assessment, 'update', async () => { updateCount += 1; }),
  ];
  let server;
  try {
    server = await startServer();
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/assessments/assessment-1`, {
      method: 'PUT',
      headers: {
        Cookie: `reoa_session=${signToken({ sub: admin.id })}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ availableTo: '2027-02-01T00:00:00.000Z' }),
    });

    assert.equal(response.status, 400);
    assert.equal(updateCount, 0);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('examination results stay held until the examination is closed and all attempts are graded', async () => {
  const admin = { id: 'admin-1', status: 'ACTIVE', role: { name: 'SUPER_ADMIN' } };
  const assessment = {
    id: 'exam-1',
    courseId: 'course-1',
    status: 'CLOSED',
    type: 'EXAMINATION',
    resultsReleased: false,
    availableFrom: null,
    availableTo: null,
  };
  let countCalls = 0;
  let updateData;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => admin),
    stubMethod(prisma.assessment, 'findUnique', async () => assessment),
    stubMethod(prisma.assessmentAttempt, 'count', async () => {
      countCalls += 1;
      return countCalls === 1 ? 2 : 0;
    }),
    stubMethod(prisma.assessment, 'update', async ({ data }) => {
      updateData = data;
      return { ...assessment, ...data };
    }),
    stubMethod(prisma.auditLog, 'create', async () => ({ id: 'audit-1' })),
  ];
  let server;
  try {
    server = await startServer();
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/assessments/exam-1`, {
      method: 'PUT',
      headers: {
        Cookie: `reoa_session=${signToken({ sub: admin.id })}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ resultsReleased: true }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(updateData, { resultsReleased: true });
    assert.equal(countCalls, 2);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('assessment creation rejects a Program Offering that belongs to a different Program', async () => {
  const admin = { id: 'admin-1', status: 'ACTIVE', role: { name: 'SUPER_ADMIN' } };
  let createCount = 0;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => admin),
    stubMethod(prisma.course, 'findUnique', async () => ({ programmeId: 'programme-a' })),
    stubMethod(prisma.intakeProgramOffering, 'findUnique', async () => ({
      id: 'offering-b',
      programmeId: 'programme-b',
    })),
    stubMethod(prisma.assessment, 'create', async () => { createCount += 1; }),
  ];
  let server;
  try {
    server = await startServer();
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/assessments`, {
      method: 'POST',
      headers: {
        Cookie: `reoa_session=${signToken({ sub: admin.id })}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        courseId: 'course-a',
        title: 'Winter programme assessment',
        programOfferingId: 'offering-b',
      }),
    });

    assert.equal(response.status, 400);
    assert.equal(createCount, 0);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('Tutors cannot release examination results', async () => {
  const tutor = { id: 'tutor-1', status: 'ACTIVE', role: { name: 'TRAINER' } };
  const exam = {
    id: 'exam-1',
    courseId: 'course-1',
    status: 'CLOSED',
    type: 'EXAMINATION',
    resultsReleased: false,
    availableFrom: null,
    availableTo: null,
  };
  let updateCount = 0;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => tutor),
    stubMethod(prisma.assessment, 'findUnique', async () => exam),
    stubMethod(prisma.courseTrainer, 'findUnique', async () => ({ id: 'assignment-1' })),
    stubMethod(prisma.assessment, 'update', async () => { updateCount += 1; }),
  ];
  let server;
  try {
    server = await startServer();
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/assessments/exam-1`, {
      method: 'PUT',
      headers: {
        Cookie: `reoa_session=${signToken({ sub: tutor.id })}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ resultsReleased: true }),
    });

    assert.equal(response.status, 403);
    assert.equal(updateCount, 0);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('a published examination with attempts can be closed without changing its settings', async () => {
  const admin = { id: 'admin-1', status: 'ACTIVE', role: { name: 'SUPER_ADMIN' } };
  const assessment = {
    id: 'exam-1',
    courseId: 'course-1',
    status: 'PUBLISHED',
    type: 'EXAMINATION',
    resultsReleased: false,
    availableFrom: null,
    availableTo: null,
  };
  let updateData;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => admin),
    stubMethod(prisma.assessment, 'findUnique', async () => assessment),
    stubMethod(prisma.assessmentAttempt, 'count', async () => 1),
    stubMethod(prisma.assessment, 'update', async ({ data }) => {
      updateData = data;
      return { ...assessment, ...data };
    }),
  ];
  let server;
  try {
    server = await startServer();
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/assessments/exam-1`, {
      method: 'PUT',
      headers: {
        Cookie: `reoa_session=${signToken({ sub: admin.id })}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ status: 'CLOSED' }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(updateData, { status: 'CLOSED' });
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('examination results cannot be released before closing', async () => {
  const admin = { id: 'admin-1', status: 'ACTIVE', role: { name: 'SUPER_ADMIN' } };
  const assessment = {
    id: 'exam-1',
    courseId: 'course-1',
    status: 'PUBLISHED',
    type: 'EXAMINATION',
    resultsReleased: false,
    availableFrom: null,
    availableTo: null,
  };
  let updateCount = 0;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => admin),
    stubMethod(prisma.assessment, 'findUnique', async () => assessment),
    stubMethod(prisma.assessmentAttempt, 'count', async () => 1),
    stubMethod(prisma.assessment, 'update', async () => { updateCount += 1; }),
  ];
  let server;
  try {
    server = await startServer();
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/assessments/exam-1`, {
      method: 'PUT',
      headers: {
        Cookie: `reoa_session=${signToken({ sub: admin.id })}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ resultsReleased: true }),
    });

    assert.equal(response.status, 409);
    assert.match((await response.json()).message, /close the examination/i);
    assert.equal(updateCount, 0);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('examination results cannot be released while any attempt is ungraded', async () => {
  const admin = { id: 'admin-1', status: 'ACTIVE', role: { name: 'SUPER_ADMIN' } };
  const assessment = {
    id: 'exam-1',
    courseId: 'course-1',
    status: 'CLOSED',
    type: 'EXAMINATION',
    resultsReleased: false,
    availableFrom: null,
    availableTo: null,
  };
  let countCalls = 0;
  let updateCount = 0;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => admin),
    stubMethod(prisma.assessment, 'findUnique', async () => assessment),
    stubMethod(prisma.assessmentAttempt, 'count', async () => {
      countCalls += 1;
      return 1;
    }),
    stubMethod(prisma.assessment, 'update', async () => { updateCount += 1; }),
  ];
  let server;
  try {
    server = await startServer();
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/assessments/exam-1`, {
      method: 'PUT',
      headers: {
        Cookie: `reoa_session=${signToken({ sub: admin.id })}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ resultsReleased: true }),
    });

    assert.equal(response.status, 409);
    assert.match((await response.json()).message, /grade all examination attempts/i);
    assert.equal(countCalls, 2);
    assert.equal(updateCount, 0);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});
