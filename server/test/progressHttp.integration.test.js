import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ||= 'progress-http-integration-secret';
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

const postLessonCompletion = async (server) => fetch(
  `http://127.0.0.1:${server.address().port}/api/progress/complete`,
  {
    method: 'POST',
    headers: {
      Cookie: `reoa_session=${signToken({ sub: 'student-1' })}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ lessonId: 'lesson-1' }),
  },
);

const postLessonAccess = async (server, lessonId = 'lesson-1') => fetch(
  `http://127.0.0.1:${server.address().port}/api/progress/access`,
  {
    method: 'POST',
    headers: {
      Cookie: `reoa_session=${signToken({ sub: 'student-1' })}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ lessonId }),
  },
);

const getMyProgress = async (server) => fetch(
  `http://127.0.0.1:${server.address().port}/api/progress/me`,
  { headers: { Cookie: `reoa_session=${signToken({ sub: 'student-1' })}` } },
);

test('student progress endpoint permits courses in the active Program without cohort enrollment', async () => {
  const student = { id: 'student-1', status: 'ACTIVE', role: { name: 'STUDENT' } };
  let savedProgress;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => student),
    stubMethod(prisma.programEnrollment, 'findFirst', async () => ({ id: 'program-enrollment-1' })),
    stubMethod(prisma.course, 'findFirst', async () => ({ id: 'course-1' })),
    stubMethod(prisma.lesson, 'findUnique', async ({ select }) => {
      assert.equal(select.module.select.course.select.visibility, true);
      assert.equal(select.module.select.course.select.startDate, true);
      assert.equal(select.module.select.course.select.endDate, true);
      return {
        isPublished: true,
        module: {
          course: {
            id: 'course-1',
            status: 'PUBLISHED',
            programmeId: 'programme-1',
            visibility: 'public',
            startDate: null,
            endDate: null,
            cohorts: [],
          },
        },
      };
    }),
    stubMethod(prisma.lessonProgress, 'upsert', async ({ create }) => {
      savedProgress = create;
      return { ...create, id: 'progress-1' };
    }),
  ];
  let server;
  try {
    server = await startServer();
    const response = await postLessonCompletion(server);
    assert.equal(response.status, 200);
    assert.equal(savedProgress.studentId, student.id);
    assert.equal(savedProgress.lessonId, 'lesson-1');
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('student progress endpoint rejects Program course lessons outside availability dates', async () => {
  const student = { id: 'student-1', status: 'ACTIVE', role: { name: 'STUDENT' } };
  let upsertCount = 0;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => student),
    stubMethod(prisma.programEnrollment, 'findFirst', async () => ({ id: 'program-enrollment-1' })),
    stubMethod(prisma.course, 'findFirst', async () => ({ id: 'course-1' })),
    stubMethod(prisma.lesson, 'findUnique', async () => ({
      isPublished: true,
      module: {
        course: {
          id: 'course-1',
          status: 'PUBLISHED',
          programmeId: 'programme-1',
          visibility: 'public',
          startDate: new Date('2999-01-01T00:00:00.000Z'),
          endDate: null,
          cohorts: [],
        },
      },
    })),
    stubMethod(prisma.lessonProgress, 'upsert', async () => {
      upsertCount += 1;
      return {};
    }),
  ];
  let server;
  try {
    server = await startServer();
    const response = await postLessonCompletion(server);
    assert.equal(response.status, 404);
    assert.equal(upsertCount, 0);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('lesson access upserts a resumable position without changing completion history', async () => {
  const student = { id: 'student-1', status: 'ACTIVE', role: { name: 'STUDENT' } };
  const completedAt = new Date('2026-10-12T10:00:00.000Z');
  let upsertArgs;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => student),
    stubMethod(prisma.programEnrollment, 'findFirst', async () => ({ id: 'program-enrollment-1' })),
    stubMethod(prisma.course, 'findFirst', async () => ({ id: 'course-1' })),
    stubMethod(prisma.lesson, 'findUnique', async () => ({
      isPublished: true,
      module: {
        course: {
          id: 'course-1',
          status: 'PUBLISHED',
          programmeId: 'programme-1',
          visibility: 'public',
          startDate: null,
          endDate: null,
          cohorts: [],
        },
      },
    })),
    stubMethod(prisma.lessonProgress, 'upsert', async (args) => {
      upsertArgs = args;
      return {
        id: 'progress-1',
        studentId: student.id,
        lessonId: 'lesson-1',
        completed: true,
        completedAt,
        updatedAt: new Date(),
        lesson: {
          id: 'lesson-1',
          title: 'Current lesson',
          module: { id: 'module-1', title: 'Module 1', course: { id: 'course-1', title: 'Course 1' } },
        },
      };
    }),
  ];
  let server;
  try {
    server = await startServer();
    const response = await postLessonAccess(server);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(upsertArgs.where.studentId_lessonId, { studentId: student.id, lessonId: 'lesson-1' });
    assert.equal(upsertArgs.create.completed, false);
    assert.ok(upsertArgs.update.updatedAt instanceof Date);
    assert.equal(upsertArgs.update.completed, undefined);
    assert.equal(upsertArgs.update.completedAt, undefined);
    assert.equal(body.data.completed, true);
    assert.equal(body.data.completedAt, completedAt.toISOString());
    assert.equal(body.data.lesson.module.course.id, 'course-1');
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('lesson access cannot create a resume record for another Program', async () => {
  const student = { id: 'student-1', status: 'ACTIVE', role: { name: 'STUDENT' } };
  let upsertCount = 0;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => student),
    stubMethod(prisma.programEnrollment, 'findFirst', async () => ({ id: 'program-enrollment-1' })),
    stubMethod(prisma.course, 'findFirst', async () => null),
    stubMethod(prisma.lesson, 'findUnique', async () => ({
      isPublished: true,
      module: {
        course: {
          id: 'course-foreign',
          status: 'PUBLISHED',
          programmeId: 'programme-foreign',
          visibility: 'public',
          startDate: null,
          endDate: null,
          cohorts: [],
        },
      },
    })),
    stubMethod(prisma.lessonProgress, 'upsert', async () => {
      upsertCount += 1;
      return {};
    }),
  ];
  let server;
  try {
    server = await startServer();
    const response = await postLessonAccess(server, 'lesson-foreign');
    assert.equal(response.status, 404);
    assert.equal(upsertCount, 0);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('my progress reloads lesson and course details in last-access order', async () => {
  const student = { id: 'student-1', status: 'ACTIVE', role: { name: 'STUDENT' } };
  let query;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => student),
    stubMethod(prisma.programEnrollment, 'findFirst', async () => ({ id: 'program-enrollment-1' })),
    stubMethod(prisma.lessonProgress, 'findMany', async (args) => {
      query = args;
      return [{
        id: 'progress-1',
        studentId: student.id,
        lessonId: 'lesson-1',
        completed: false,
        updatedAt: new Date('2026-11-14T10:00:00.000Z'),
        lesson: {
          id: 'lesson-1',
          title: 'Resume lesson',
          module: { id: 'module-1', title: 'Module 1', course: { id: 'course-1', title: 'Course 1' } },
        },
      }];
    }),
  ];
  let server;
  try {
    server = await startServer();
    const response = await getMyProgress(server);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(query.where.studentId, student.id);
    assert.equal(query.orderBy.updatedAt, 'desc');
    assert.equal(query.include.lesson.select.module.select.course.select.id, true);
    assert.equal(body.data[0].lesson.module.course.id, 'course-1');
    assert.equal(body.data[0].lessonId, 'lesson-1');
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});
