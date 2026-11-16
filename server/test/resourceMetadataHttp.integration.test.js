import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.JWT_SECRET ||= 'resource-metadata-http-integration-secret';
process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test';

const [{ default: app }, { default: prisma }, { signToken }] = await Promise.all([
  import('../src/app.js'),
  import('../src/config/database.js'),
  import('../src/utils/jwt.js'),
]);

const trainer = { id: 'trainer-1', status: 'ACTIVE', role: { name: 'TRAINER' } };
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

test('resource metadata updates are validated, course-scoped, and restricted to assigned Tutors', async () => {
  let assigned = true;
  let updateCount = 0;
  let deleteCount = 0;
  const storagePath = path.join(os.tmpdir(), `reoacademy-resource-metadata-${process.pid}-${Date.now()}`);
  assert.equal(fs.existsSync(storagePath), false);
  let resource = {
    id: 'resource-1',
    courseId: 'course-1',
    lessonId: null,
    originalName: 'route-guide.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1200,
    createdAt: new Date(),
    storagePath,
    lesson: null,
  };
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => trainer),
    stubMethod(prisma.courseTrainer, 'findUnique', async () => (assigned ? { id: 'assignment-1' } : null)),
    stubMethod(prisma.resource, 'findUnique', async () => resource),
    stubMethod(prisma.resource, 'update', async ({ data }) => {
      updateCount += 1;
      resource = { ...resource, ...data };
      return {
        id: resource.id,
        courseId: resource.courseId,
        lessonId: resource.lessonId,
        originalName: resource.originalName,
        mimeType: resource.mimeType,
        sizeBytes: resource.sizeBytes,
        createdAt: resource.createdAt,
      };
    }),
    stubMethod(prisma.resource, 'delete', async () => {
      deleteCount += 1;
      return resource;
    }),
    stubMethod(prisma.auditLog, 'create', async () => ({})),
  ];
  let server;
  try {
    server = await startServer();
    const url = `http://127.0.0.1:${server.address().port}/api/resources/resource-1`;
    const headers = {
      Cookie: `reoa_session=${signToken({ sub: trainer.id })}`,
      'content-type': 'application/json',
    };

    const updateResponse = await fetch(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ originalName: '  Updated route guide.pdf  ' }),
    });
    assert.equal(updateResponse.status, 200);
    assert.equal((await updateResponse.json()).data.originalName, 'Updated route guide.pdf');
    assert.equal(resource.storagePath, storagePath);
    assert.equal(updateCount, 1);

    for (const originalName of ['', '   ', 'x'.repeat(256), 'unsafe\nname.pdf']) {
      const invalidResponse = await fetch(url, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ originalName }),
      });
      assert.equal(invalidResponse.status, 400);
    }
    assert.equal(updateCount, 1);

    assigned = false;
    const forbiddenResponse = await fetch(url, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ originalName: 'Not assigned.pdf' }),
    });
    assert.equal(forbiddenResponse.status, 403);
    assert.equal(updateCount, 1);

    const forbiddenDelete = await fetch(url, { method: 'DELETE', headers });
    assert.equal(forbiddenDelete.status, 403);
    assert.equal(deleteCount, 0);

    assigned = true;
    const deleteResponse = await fetch(url, { method: 'DELETE', headers });
    assert.equal(deleteResponse.status, 200);
    assert.equal(deleteCount, 1);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});
