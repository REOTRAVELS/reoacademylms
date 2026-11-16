import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ||= 'student-course-http-integration-secret';
process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test';

const [{ default: app }, { default: prisma }, { signToken }] = await Promise.all([
  import('../src/app.js'),
  import('../src/config/database.js'),
  import('../src/utils/jwt.js'),
]);

const student = { id: 'student-1', status: 'ACTIVE', role: { name: 'STUDENT' } };
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

const get = (server, path) => fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
  headers: { Cookie: `reoa_session=${signToken({ sub: student.id })}` },
});

test('student course overview returns safe lesson summaries and lesson content through its authorized endpoint', async () => {
  let courseQuery;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => student),
    stubMethod(prisma.programEnrollment, 'findFirst', async () => ({
      id: 'enrollment-1',
      programmeId: 'programme-1',
      programOfferingId: 'offering-1',
    })),
    stubMethod(prisma.course, 'findFirst', async () => ({ id: 'course-1' })),
    stubMethod(prisma.course, 'findUnique', async (query) => {
      courseQuery = query;
      return {
        id: 'course-1',
        title: 'Travel Operations',
        status: 'PUBLISHED',
        programmeId: 'programme-1',
        visibility: 'public',
        startDate: null,
        endDate: null,
        completionRequirements: '{}',
        modules: [{
          id: 'module-1',
          title: 'Planning',
          lessons: [{
            id: 'lesson-1',
            title: 'Route basics',
            type: 'TEXT',
            position: 0,
            isPublished: true,
            estimatedDuration: '10 minutes',
          }],
        }],
        trainers: [],
        resources: [],
      };
    }),
    stubMethod(prisma.lessonProgress, 'findMany', async () => []),
    stubMethod(prisma.lesson, 'findUnique', async () => ({
      id: 'lesson-1',
      title: 'Route basics',
      type: 'TEXT',
      content: JSON.stringify([{ type: 'rich_text', content: 'Lesson material.' }]),
      isPublished: true,
      module: {
        id: 'module-1',
        title: 'Planning',
        courseId: 'course-1',
        course: { id: 'course-1', title: 'Travel Operations', status: 'PUBLISHED' },
      },
      resources: [],
    })),
    stubMethod(prisma.lessonProgress, 'findUnique', async () => ({
      completed: false,
      completedAt: null,
    })),
  ];
  let server;
  try {
    server = await startServer();
    const courseResponse = await get(server, '/courses/course-1');
    const courseBody = await courseResponse.json();
    assert.equal(courseResponse.status, 200);
    const lessonSelection = courseQuery.include.modules.include.lessons.select;
    assert.equal(lessonSelection.content, undefined);
    assert.equal(lessonSelection.title, true);
    assert.equal(courseBody.data.modules[0].lessons[0].content, undefined);

    const lessonResponse = await get(server, '/courses/lessons/lesson-1');
    const lessonBody = await lessonResponse.json();
    assert.equal(lessonResponse.status, 200);
    assert.equal(lessonBody.data.content, '[{"type":"rich_text","content":"Lesson material."}]');
    assert.equal(lessonBody.data.module.title, 'Planning');
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});
