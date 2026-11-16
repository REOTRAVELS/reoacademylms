import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ||= 'course-publication-http-integration-secret';
process.env.DATABASE_URL ||= '******localhost:5432/test';

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

const courseRecord = (overrides = {}) => ({
  id: 'course-1',
  title: 'Travel Operations',
  description: 'Learn to plan safe and effective travel.',
  category: 'Travel',
  difficulty: 'All Levels',
  language: 'English',
  thumbnail: 'https://academy.example/course.jpg',
  programmeId: 'programme-1',
  programme: { id: 'programme-1', status: 'ACTIVE' },
  visibility: 'public',
  learningObjectives: JSON.stringify(['Plan itineraries']),
  learningOutcomes: JSON.stringify(['Create an itinerary']),
  targetAudience: 'Travel professionals',
  completionRequirements: '{}',
  status: 'DRAFT',
  startDate: null,
  endDate: null,
  trainers: [{ trainer: { id: 'trainer-1', status: 'ACTIVE' } }],
  cohorts: [{
    cohort: {
      id: 'cohort-1',
      programmeId: 'programme-1',
      intakeProgramOfferingId: 'offering-1',
    },
  }],
  resources: [],
  modules: [{
    id: 'module-1',
    title: 'Foundations',
    position: 0,
    lessons: [{
      id: 'lesson-1',
      title: 'Planning',
      position: 0,
      isPublished: true,
      content: JSON.stringify([{ type: 'rich_text', content: 'Begin with the client brief.' }]),
      resources: [],
    }],
  }],
  assessments: [],
  ...overrides,
});

test('publication endpoint blocks invalid courses and publishes only after quality passes', async () => {
  const admin = { id: 'admin-1', status: 'ACTIVE', role: { name: 'SUPER_ADMIN' } };
  let currentCourse = courseRecord({ description: '' });
  let updateCount = 0;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => admin),
    stubMethod(prisma.course, 'findUnique', async () => currentCourse),
    stubMethod(prisma.course, 'update', async ({ data }) => {
      updateCount += 1;
      currentCourse = { ...currentCourse, ...data };
      return currentCourse;
    }),
    stubMethod(prisma.auditLog, 'create', async () => ({ id: 'audit-1' })),
    stubMethod(prisma, '$transaction', async (callback) => callback(prisma)),
  ];
  let server;
  try {
    server = await startServer();
    const url = `http://127.0.0.1:${server.address().port}/api/courses/course-1/publish`;
    const headers = {
      Cookie: `reoa_session=${signToken({ sub: admin.id })}`,
      'content-type': 'application/json',
    };

    const blocked = await fetch(url, { method: 'POST', headers });
    const blockedBody = await blocked.json();
    assert.equal(blocked.status, 422);
    assert.ok(blockedBody.errors.errors.some(({ code }) => code === 'missing_description'));
    assert.equal(updateCount, 0);

    currentCourse = courseRecord();
    const published = await fetch(url, { method: 'POST', headers });
    const publishedBody = await published.json();
    assert.equal(published.status, 200);
    assert.equal(publishedBody.data.course.status, 'PUBLISHED');
    assert.equal(publishedBody.data.quality.valid, true);
    assert.equal(updateCount, 1);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('trainers cannot publish courses from Programs outside their assigned course scope', async () => {
  const trainer = { id: 'trainer-2', status: 'ACTIVE', role: { name: 'TRAINER' } };
  let updateCount = 0;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => trainer),
    stubMethod(prisma.course, 'findUnique', async () => courseRecord({
      programmeId: 'programme-b',
      programme: { id: 'programme-b', status: 'ACTIVE' },
    })),
    stubMethod(prisma.courseTrainer, 'findUnique', async () => null),
    stubMethod(prisma.course, 'update', async () => { updateCount += 1; }),
    stubMethod(prisma, '$transaction', async (callback) => callback(prisma)),
  ];
  let server;
  try {
    server = await startServer();
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/courses/course-1/publish`, {
      method: 'POST',
      headers: { Cookie: `reoa_session=${signToken({ sub: trainer.id })}` },
    });

    assert.equal(response.status, 403);
    assert.equal(updateCount, 0);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('trainers cannot associate a new course with an unassigned Program', async () => {
  const trainer = { id: 'trainer-2', status: 'ACTIVE', role: { name: 'TRAINER' } };
  let createCount = 0;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => trainer),
    stubMethod(prisma.programme, 'findUnique', async () => ({ id: 'programme-b' })),
    stubMethod(prisma.cohortTrainer, 'findFirst', async () => null),
    stubMethod(prisma.course, 'create', async () => { createCount += 1; }),
  ];
  let server;
  try {
    server = await startServer();
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/courses`, {
      method: 'POST',
      headers: {
        Cookie: `reoa_session=${signToken({ sub: trainer.id })}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Foreign Program course',
        programmeId: 'programme-b',
      }),
    });

    assert.equal(response.status, 403);
    assert.equal(createCount, 0);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('generic course updates cannot change publication state', async () => {
  const admin = { id: 'admin-1', status: 'ACTIVE', role: { name: 'SUPER_ADMIN' } };
  let updateCount = 0;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => admin),
    stubMethod(prisma.course, 'findUnique', async () => ({ id: 'course-1', status: 'PUBLISHED', startDate: null, endDate: null })),
    stubMethod(prisma.course, 'update', async () => { updateCount += 1; }),
  ];
  let server;
  try {
    server = await startServer();
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/courses/course-1`, {
      method: 'PUT',
      headers: {
        Cookie: `reoa_session=${signToken({ sub: admin.id })}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ status: 'DRAFT' }),
    });

    assert.equal(response.status, 400);
    assert.equal(updateCount, 0);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('course updates cannot remove cohorts that contain enrolled students', async () => {
  const admin = { id: 'admin-1', status: 'ACTIVE', role: { name: 'SUPER_ADMIN' } };
  let updateCount = 0;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => admin),
    stubMethod(prisma.course, 'findUnique', async () => ({
      id: 'course-1',
      status: 'PUBLISHED',
      startDate: null,
      endDate: null,
      cohorts: [{ cohortId: 'cohort-1' }],
    })),
    stubMethod(prisma.cohort, 'findMany', async () => []),
    stubMethod(prisma.enrolment, 'count', async () => 1),
    stubMethod(prisma.course, 'update', async () => { updateCount += 1; }),
  ];
  let server;
  try {
    server = await startServer();
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/courses/course-1`, {
      method: 'PUT',
      headers: {
        Cookie: `reoa_session=${signToken({ sub: admin.id })}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ cohortIds: [] }),
    });

    assert.equal(response.status, 409);
    assert.equal(updateCount, 0);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('editing a published course keeps its publication and learner-history records unchanged', async () => {
  const admin = { id: 'admin-1', status: 'ACTIVE', role: { name: 'SUPER_ADMIN' } };
  let savedData;
  let progressQueries = 0;
  let enrolmentQueries = 0;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => admin),
    stubMethod(prisma.course, 'findUnique', async () => ({
      id: 'course-1',
      status: 'PUBLISHED',
      startDate: null,
      endDate: null,
      cohorts: [],
    })),
    stubMethod(prisma.course, 'update', async ({ data }) => {
      savedData = data;
      return { id: 'course-1', status: 'PUBLISHED', ...data };
    }),
    stubMethod(prisma.lessonProgress, 'count', async () => { progressQueries += 1; }),
    stubMethod(prisma.enrolment, 'count', async () => { enrolmentQueries += 1; }),
  ];
  let server;
  try {
    server = await startServer();
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/courses/course-1`, {
      method: 'PUT',
      headers: {
        Cookie: `reoa_session=${signToken({ sub: admin.id })}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ title: 'Updated travel operations' }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.status, 'PUBLISHED');
    assert.equal(savedData.title, 'Updated travel operations');
    assert.equal(savedData.status, undefined);
    assert.equal(progressQueries, 0);
    assert.equal(enrolmentQueries, 0);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});
