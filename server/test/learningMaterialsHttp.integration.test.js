import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.JWT_SECRET ||= 'learning-materials-http-integration-secret';
process.env.DATABASE_URL ||= 'postgresql://placeholder:placeholder@localhost:5432/test';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'reoacademy-materials-'));

const [{ default: app }, { default: prisma }, { signToken }, { env }] = await Promise.all([
  import('../src/app.js'),
  import('../src/config/database.js'),
  import('../src/utils/jwt.js'),
  import('../src/config/env.js'),
]);

const trainer = {
  id: 'trainer-1',
  status: 'ACTIVE',
  role: { name: 'TRAINER' },
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

test('trainers can upload course videos and stream authorized byte ranges safely', async () => {
  const restores = [];
  let resource;
  let resourceCreateCount = 0;
  let server;

  restores.push(stubMethod(prisma.user, 'findUnique', async () => trainer));
  restores.push(stubMethod(prisma.courseTrainer, 'findUnique', async () => ({ id: 'trainer-course-assignment' })));
  restores.push(stubMethod(prisma.resource, 'create', async ({ data }) => {
    resourceCreateCount += 1;
    resource = {
      id: 'resource-1',
      ...data,
      course: { id: data.courseId, status: 'PUBLISHED' },
      lesson: null,
    };
    return {
      id: resource.id,
      courseId: resource.courseId,
      lessonId: resource.lessonId,
      originalName: resource.originalName,
      mimeType: resource.mimeType,
      sizeBytes: resource.sizeBytes,
      createdAt: new Date(),
    };
  }));
  restores.push(stubMethod(prisma.resource, 'findUnique', async () => resource));
  restores.push(stubMethod(prisma.auditLog, 'create', async () => ({})));

  try {
    server = await startServer();
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/resources`;
    const headers = { Cookie: `reoa_session=${signToken({ sub: trainer.id })}` };
    const mp4Bytes = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);
    const form = new FormData();
    form.append('courseId', 'course-1');
    form.append('file', new Blob([mp4Bytes], { type: 'video/mp4' }), 'training.mp4');

    const uploadResponse = await fetch(baseUrl, { method: 'POST', headers, body: form });
    assert.equal(uploadResponse.status, 201);
    assert.equal((await uploadResponse.json()).data.mimeType, 'video/mp4');
    assert.equal(resourceCreateCount, 1);
    assert.equal(fs.existsSync(resource.storagePath), true);

    const videoResponse = await fetch(`${baseUrl}/${resource.id}/download`, {
      headers: { ...headers, Range: 'bytes=4-7' },
    });
    assert.equal(videoResponse.status, 206);
    assert.equal(videoResponse.headers.get('content-range'), `bytes 4-7/${mp4Bytes.length}`);
    assert.equal(videoResponse.headers.get('content-type'), 'video/mp4');
    assert.deepEqual(Buffer.from(await videoResponse.arrayBuffer()), mp4Bytes.subarray(4, 8));

    const invalidTypeForm = new FormData();
    invalidTypeForm.append('courseId', 'course-1');
    invalidTypeForm.append('file', new Blob(['not a video'], { type: 'video/mp4' }), 'spoofed.mp4');
    const invalidTypeResponse = await fetch(baseUrl, { method: 'POST', headers, body: invalidTypeForm });
    assert.equal(invalidTypeResponse.status, 400);
    assert.equal(resourceCreateCount, 1);

    const executableForm = new FormData();
    executableForm.append('courseId', 'course-1');
    executableForm.append('file', new Blob(['blocked'], { type: 'application/x-msdownload' }), 'program.exe');
    const executableResponse = await fetch(baseUrl, { method: 'POST', headers, body: executableForm });
    assert.equal(executableResponse.status, 400);
    assert.equal(resourceCreateCount, 1);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
    fs.rmSync(env.uploadDir, { recursive: true, force: true });
  }
});
