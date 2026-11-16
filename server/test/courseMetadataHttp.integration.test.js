import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ||= 'course-metadata-http-integration-secret';
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

test('course creation persists builder metadata using schema-backed fields', async () => {
  const admin = { id: 'admin-1', status: 'ACTIVE', role: { name: 'SUPER_ADMIN' } };
  const body = {
    title: 'Travel Operations',
    subtitle: 'A practical introduction',
    introduction: 'Welcome to the course.',
    category: 'Travel',
    requirements: 'Basic computer skills',
    learningObjectives: ['Plan travel itineraries'],
    learningOutcomes: ['Create a compliant itinerary'],
    startDate: '2027-01-01T00:00:00.000Z',
    endDate: '2027-02-01T00:00:00.000Z',
  };
  let createdData;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => admin),
    stubMethod(prisma.course, 'findUnique', async () => null),
    stubMethod(prisma.course, 'create', async ({ data }) => {
      createdData = data;
      return { id: 'course-1', ...data };
    }),
    stubMethod(prisma.auditLog, 'create', async () => ({ id: 'audit-1' })),
  ];
  let server;
  try {
    server = await startServer();
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/courses`, {
      method: 'POST',
      headers: {
        Cookie: `reoa_session=${signToken({ sub: admin.id })}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    assert.equal(response.status, 201);
    assert.equal(createdData.subtitle, body.subtitle);
    assert.equal(createdData.introduction, body.introduction);
    assert.equal(createdData.category, body.category);
    assert.equal(createdData.requirements, body.requirements);
    assert.equal(createdData.learningObjectives, JSON.stringify(body.learningObjectives));
    assert.equal(createdData.learningOutcomes, JSON.stringify(body.learningOutcomes));
    assert.equal(createdData.startDate.toISOString(), body.startDate);
    assert.equal(createdData.endDate.toISOString(), body.endDate);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('course updates cannot move the start after the stored end date', async () => {
  const admin = { id: 'admin-1', status: 'ACTIVE', role: { name: 'SUPER_ADMIN' } };
  let updateCalled = false;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => admin),
    stubMethod(prisma.course, 'findUnique', async () => ({
      id: 'course-1',
      startDate: new Date('2027-01-01T00:00:00.000Z'),
      endDate: new Date('2027-02-01T00:00:00.000Z'),
    })),
    stubMethod(prisma.course, 'update', async () => {
      updateCalled = true;
      return { id: 'course-1' };
    }),
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
      body: JSON.stringify({ startDate: '2027-03-01T00:00:00.000Z' }),
    });

    assert.equal(response.status, 400);
    assert.equal(updateCalled, false);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});
