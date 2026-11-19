import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.JWT_SECRET ||= 'object-storage-proxy-upload-test-secret';
process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test';

const [{ default: app }, { default: prisma }, { signToken }, { env }] = await Promise.all([
  import('../src/app.js'),
  import('../src/config/database.js'),
  import('../src/utils/jwt.js'),
  import('../src/config/env.js'),
]);

const admin = { id: 'admin-1', status: 'ACTIVE', role: { name: 'SUPER_ADMIN' } };
const stubMethod = (target, key, implementation) => {
  const original = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, writable: true, value: implementation });
  return () => {
    if (original) Object.defineProperty(target, key, original);
    else delete target[key];
  };
};
const startServer = async (server) => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
};
const closeServer = (server) => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
});

test('small S3-backed resource and timetable uploads are proxied through the LMS API', async () => {
  const originalStorageConfig = {
    fileStorageProvider: env.fileStorageProvider,
    livekitRecordingS3Endpoint: env.livekitRecordingS3Endpoint,
    livekitRecordingS3PlaybackEndpoint: env.livekitRecordingS3PlaybackEndpoint,
    livekitRecordingS3Bucket: env.livekitRecordingS3Bucket,
    livekitRecordingS3Region: env.livekitRecordingS3Region,
    livekitRecordingS3AccessKey: env.livekitRecordingS3AccessKey,
    livekitRecordingS3Secret: env.livekitRecordingS3Secret,
    livekitRecordingS3ForcePathStyle: env.livekitRecordingS3ForcePathStyle,
  };
  const receivedUploads = [];
  const offering = { id: 'offering-1', timetableStoragePath: null };
  const restores = [];
  const storageServer = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      receivedUploads.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks),
      });
      res.writeHead(200, { ETag: '"proxy-test"' });
      res.end();
    });
  });
  let apiServer;

  try {
    await startServer(storageServer);
    Object.assign(env, {
      fileStorageProvider: 's3',
      livekitRecordingS3Endpoint: `http://127.0.0.1:${storageServer.address().port}`,
      livekitRecordingS3PlaybackEndpoint: undefined,
      livekitRecordingS3Bucket: 'test-bucket',
      livekitRecordingS3Region: 'us-east-1',
      livekitRecordingS3AccessKey: 'test-access-key',
      livekitRecordingS3Secret: 'test-secret-key',
      livekitRecordingS3ForcePathStyle: true,
    });

    restores.push(stubMethod(prisma.user, 'findUnique', async () => admin));
    restores.push(stubMethod(prisma.resource, 'create', async ({ data }) => ({
      id: 'resource-1',
      ...data,
      createdAt: new Date(),
    })));
    restores.push(stubMethod(prisma.intakeProgramOffering, 'findFirst', async () => offering));
    restores.push(stubMethod(prisma.intakeProgramOffering, 'update', async ({ data }) => ({
      id: offering.id,
      timetableFileName: data.timetableFileName,
      timetableMimeType: data.timetableMimeType,
      timetableSizeBytes: data.timetableSizeBytes,
    })));
    restores.push(stubMethod(prisma.auditLog, 'create', async () => ({ id: 'audit-1' })));

    apiServer = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => apiServer.once('listening', resolve));
    const cookie = `reoa_session=${signToken({ sub: admin.id })}`;
    const pdf = Buffer.from('%PDF-1.7\nproxy upload test\n');

    const resourceForm = new FormData();
    resourceForm.append('courseId', 'course-1');
    resourceForm.append('file', new Blob([pdf], { type: 'application/pdf' }), 'guide.pdf');
    const resourceResponse = await fetch(`http://127.0.0.1:${apiServer.address().port}/api/resources/`, {
      method: 'POST',
      headers: { Cookie: cookie },
      body: resourceForm,
    });
    assert.equal(resourceResponse.status, 201);
    const resourceUpload = receivedUploads[0];
    assert.equal(resourceUpload.method, 'PUT');
    assert.match(
      new URL(resourceUpload.url, 'http://localhost').pathname,
      /\/test-bucket\/course-resources\/admin-1\/[0-9a-f-]{36}\.pdf$/,
    );
    assert.deepEqual(resourceUpload.body, pdf);

    const timetableForm = new FormData();
    timetableForm.append('file', new Blob([pdf], { type: 'application/pdf' }), 'schedule.pdf');
    const timetableResponse = await fetch(
      `http://127.0.0.1:${apiServer.address().port}/api/intakes/intake-1/offerings/offering-1/timetable`,
      {
        method: 'POST',
        headers: { Cookie: cookie },
        body: timetableForm,
      },
    );
    assert.equal(timetableResponse.status, 201);
    const timetableUpload = receivedUploads[1];
    assert.equal(timetableUpload.method, 'PUT');
    assert.match(
      new URL(timetableUpload.url, 'http://localhost').pathname,
      /\/test-bucket\/program-offering-timetables\/admin-1\/[0-9a-f-]{36}\.pdf$/,
    );
    assert.deepEqual(timetableUpload.body, pdf);
  } finally {
    Object.assign(env, originalStorageConfig);
    if (apiServer?.listening) await closeServer(apiServer);
    if (storageServer.listening) await closeServer(storageServer);
    restores.reverse().forEach((restore) => restore());
  }
});
