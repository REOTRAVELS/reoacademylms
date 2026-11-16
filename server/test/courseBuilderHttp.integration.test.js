import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ||= 'course-builder-http-integration-secret';
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

test('course builder persists content blocks and validates structural reorder requests', async () => {
  const admin = { id: 'admin-1', status: 'ACTIVE', role: { name: 'SUPER_ADMIN' } };
  const student = { id: 'student-1', status: 'ACTIVE', role: { name: 'STUDENT' } };
  let authenticatedUser = admin;
  const blocks = [
    { type: 'rich_text', content: 'Plan from the traveler brief.' },
    { type: 'video', content: 'https://academy.example/video.mp4', caption: 'Route planning' },
    { type: 'image', content: 'https://academy.example/map.png', altText: 'Regional map' },
    { type: 'document', content: 'https://academy.example/guide.pdf', title: 'Planning guide' },
    { type: 'link', content: 'https://academy.example/reference', title: 'Reference' },
    { type: 'exercise', content: 'Draft a sample itinerary.', instructions: 'Use the provided scenario.' },
    {
      type: 'knowledge_check',
      content: 'Which source should be checked first?',
      options: ['Official travel advice', 'An old forum post'],
      correctAnswer: 'Official travel advice',
      explanation: 'Use current official sources.',
    },
    { type: 'summary', content: 'Verify details before booking.', title: 'Key takeaway' },
  ];
  let createdModule;
  let createdLesson;
  let savedLessonContent;
  let contentUpdateCount = 0;
  const modulePositions = [];
  const lessonPositions = [];
  const previewRecord = {
    id: 'course-1',
    title: 'Travel Operations',
    description: 'Learn travel planning.',
    modules: [{
      id: 'module-1',
      title: 'Planning',
      lessons: [{ id: 'lesson-1', title: 'Traveler brief', content: JSON.stringify(blocks), isPublished: true }],
    }],
    assessments: [{ id: 'assessment-1', title: 'Safety check', questions: [{ id: 'question-1', prompt: 'Question?' }] }],
    resources: [],
  };
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => authenticatedUser),
    stubMethod(prisma.programEnrollment, 'findFirst', async () => ({
      id: 'enrollment-1',
      programmeId: 'programme-1',
      programOfferingId: 'offering-1',
    })),
    stubMethod(prisma.course, 'findUnique', async (args) => (
      args.include ? previewRecord : { id: 'course-1', modules: [{ id: 'module-1' }, { id: 'module-2' }] }
    )),
    stubMethod(prisma.module, 'count', async () => 0),
    stubMethod(prisma.module, 'create', async ({ data }) => {
      createdModule = { id: 'module-1', ...data };
      return createdModule;
    }),
    stubMethod(prisma.module, 'findUnique', async (args) => (
      args.select.lessons
        ? { id: 'module-1', courseId: 'course-1', lessons: [{ id: 'lesson-1' }, { id: 'lesson-2' }] }
        : { id: 'module-1', courseId: 'course-1' }
    )),
    stubMethod(prisma.module, 'update', async ({ where, data }) => {
      modulePositions.push({ id: where.id, position: data.position });
      return { id: where.id, ...data };
    }),
    stubMethod(prisma.lesson, 'count', async () => 0),
    stubMethod(prisma.lesson, 'create', async ({ data }) => {
      createdLesson = { id: 'lesson-1', ...data };
      return createdLesson;
    }),
    stubMethod(prisma.lesson, 'findUnique', async () => ({ module: { courseId: 'course-1' } })),
    stubMethod(prisma.lesson, 'update', async ({ where, data }) => {
      if (data.content) {
        savedLessonContent = data.content;
        contentUpdateCount += 1;
      }
      if (data.position !== undefined) lessonPositions.push({ id: where.id, position: data.position });
      return { id: where.id, ...data };
    }),
  ];
  const originalTransaction = Object.getOwnPropertyDescriptor(prisma, '$transaction');
  Object.defineProperty(prisma, '$transaction', {
    configurable: true,
    writable: true,
    value: async (operations) => Promise.all(operations),
  });
  let server;
  try {
    server = await startServer();
    const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
    const headers = {
      Cookie: `reoa_session=${signToken({ sub: admin.id })}`,
      'content-type': 'application/json',
    };

    const moduleResponse = await fetch(`${baseUrl}/courses/course-1/modules`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'Planning' }),
    });
    assert.equal(moduleResponse.status, 201);
    assert.equal(createdModule.title, 'Planning');

    const lessonResponse = await fetch(`${baseUrl}/courses/modules/module-1/lessons`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'Traveler brief', content: '[]', isPublished: true }),
    });
    assert.equal(lessonResponse.status, 201);
    assert.equal(createdLesson.moduleId, 'module-1');

    const contentResponse = await fetch(`${baseUrl}/courses/lessons/lesson-1`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ content: JSON.stringify(blocks) }),
    });
    assert.equal(contentResponse.status, 200);
    assert.deepEqual(JSON.parse(savedLessonContent), blocks);

    const moduleOrderResponse = await fetch(`${baseUrl}/courses/course-1/modules/order`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ moduleIds: ['module-2', 'module-1'] }),
    });
    assert.equal(moduleOrderResponse.status, 200);
    assert.deepEqual(modulePositions, [
      { id: 'module-2', position: 0 },
      { id: 'module-1', position: 1 },
    ]);

    const lessonOrderResponse = await fetch(`${baseUrl}/courses/modules/module-1/lessons/order`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ lessonIds: ['lesson-2', 'lesson-1'] }),
    });
    assert.equal(lessonOrderResponse.status, 200);
    assert.deepEqual(lessonPositions, [
      { id: 'lesson-2', position: 0 },
      { id: 'lesson-1', position: 1 },
    ]);

    const invalidOrder = await fetch(`${baseUrl}/courses/course-1/modules/order`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ moduleIds: ['module-1', 'module-1'] }),
    });
    assert.equal(invalidOrder.status, 400);

    const previewResponse = await fetch(`${baseUrl}/courses/course-1/preview`, { headers });
    assert.equal(previewResponse.status, 200);
    assert.deepEqual((await previewResponse.json()).data, previewRecord);

    authenticatedUser = student;
    const forbiddenUpdate = await fetch(`${baseUrl}/courses/lessons/lesson-1`, {
      method: 'PUT',
      headers: {
        Cookie: `reoa_session=${signToken({ sub: student.id })}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ content: JSON.stringify(blocks) }),
    });
    assert.equal(forbiddenUpdate.status, 403);
    assert.equal(contentUpdateCount, 1);
  } finally {
    if (server?.listening) await closeServer(server);
    if (originalTransaction) Object.defineProperty(prisma, '$transaction', originalTransaction);
    else delete prisma.$transaction;
    restores.reverse().forEach((restore) => restore());
  }
});
