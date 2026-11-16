import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ||= 'workflow-http-integration-secret';
process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test';

const [{ default: app }, { default: prisma }, { signToken }] = await Promise.all([
  import('../src/app.js'),
  import('../src/config/database.js'),
  import('../src/utils/jwt.js'),
]);

const student = {
  id: 'student-1',
  status: 'ACTIVE',
  role: { name: 'STUDENT' },
};

const stubMethod = (target, key, implementation) => {
  const original = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, writable: true, value: implementation });
  return () => {
    if (original) Object.defineProperty(target, key, original);
    else delete target[key];
  };
};

const listen = (server) => new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});

const close = (server) => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
});

test('authenticated HTTP workflows finalize expired attempts and scope personal data', async () => {
  const restores = [];
  const now = new Date();
  const attempt = {
    id: 'attempt-1',
    studentId: student.id,
    startedAt: new Date(now.getTime() - 10 * 60_000),
    submittedAt: null,
    assessment: {
      id: 'assessment-1',
      title: 'Safety check',
      courseId: 'course-1',
      timeLimitMin: 1,
      questions: [{ id: 'question-1', type: 'MULTIPLE_CHOICE', prompt: 'Choose', points: 2, correctAnswer: 'A' }],
    },
    answers: [{ id: 'answer-1', questionId: 'question-1', answer: 'A', points: null, isCorrect: null }],
  };
  let savedAttempt = { ...attempt };
  let inProgressQueryCount = 0;
  let unreadWhere;
  let server;

  restores.push(stubMethod(prisma.user, 'findUnique', async () => student));
  restores.push(stubMethod(prisma.programEnrollment, 'findFirst', async () => ({
    id: 'program-enrollment-1',
    programmeId: 'programme-1',
    programOfferingId: 'offering-1',
  })));
  restores.push(stubMethod(prisma.assessmentAttempt, 'findMany', async ({ where }) => {
    if (where.submittedAt === null) {
      inProgressQueryCount += 1;
      return inProgressQueryCount === 1 ? [attempt] : [];
    }
    return [{ ...savedAttempt, assessment: { id: 'assessment-1', title: 'Safety check' } }];
  }));
  restores.push(stubMethod(prisma.assessmentAttempt, 'updateMany', async ({ data }) => {
    savedAttempt = { ...savedAttempt, ...data };
    return { count: 1 };
  }));
  restores.push(stubMethod(prisma.assessmentAttempt, 'update', async ({ data }) => {
    savedAttempt = { ...savedAttempt, ...data };
    return savedAttempt;
  }));
  restores.push(stubMethod(prisma.assessmentAttempt, 'findUnique', async () => savedAttempt));
  restores.push(stubMethod(prisma.assessmentAnswer, 'update', async ({ where, data }) => {
    savedAttempt.answers = savedAttempt.answers.map((answer) => answer.id === where.id ? { ...answer, ...data } : answer);
    return savedAttempt.answers.find((answer) => answer.id === where.id);
  }));
  restores.push(stubMethod(prisma.course, 'findFirst', async () => ({ id: 'course-1' })));
  restores.push(stubMethod(prisma.auditLog, 'create', async () => ({})));
  restores.push(stubMethod(prisma.notification, 'count', async ({ where }) => {
    unreadWhere = where;
    return 3;
  }));
  restores.push(stubMethod(prisma, '$transaction', async (callback) => callback({
    assessmentAttempt: {
      findUnique: async () => savedAttempt,
      updateMany: prisma.assessmentAttempt.updateMany,
      update: prisma.assessmentAttempt.update,
    },
    assessmentAnswer: { update: prisma.assessmentAnswer.update },
  })));

  try {
    server = app.listen(0, '127.0.0.1');
    const port = await new Promise((resolve) => server.once('listening', () => resolve(server.address().port)));
    const cookie = `reoa_session=${signToken({ sub: student.id })}`;

    const attemptResponse = await fetch(`http://127.0.0.1:${port}/api/assessments/attempts`, {
      headers: { Cookie: cookie },
    });
    assert.equal(attemptResponse.status, 200);
    const attempts = await attemptResponse.json();
    assert.equal(attempts.data[0].status, 'GRADED');
    assert.equal(attempts.data[0].score, 2);
    assert.ok(attempts.data[0].submittedAt);

    const detailResponse = await fetch(`http://127.0.0.1:${port}/api/assessments/attempts/attempt-1`, {
      headers: { Cookie: cookie },
    });
    assert.equal(detailResponse.status, 200);
    const detail = await detailResponse.json();
    assert.equal('correctAnswer' in detail.data.assessment.questions[0], false);
    assert.equal(detail.data.answers[0].points, 2);
    assert.equal(detail.data.answers[0].isCorrect, true);

    const countResponse = await fetch(`http://127.0.0.1:${port}/api/notifications/unread-count`, {
      headers: { Cookie: cookie },
    });
    assert.equal(countResponse.status, 200);
    assert.equal((await countResponse.json()).data.count, 3);
    assert.deepEqual(unreadWhere, {
      userId: student.id,
      read: false,
      audienceStatus: 'CLASSIFIED',
      OR: [
        { isGlobal: true },
        { isGlobal: false, programmeId: 'programme-1', programOfferingId: null },
        { isGlobal: false, programmeId: 'programme-1', programOfferingId: 'offering-1' },
      ],
    });
  } finally {
    if (server?.listening) await close(server);
    restores.reverse().forEach((restore) => restore());
  }
});
