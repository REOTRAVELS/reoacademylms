import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.JWT_SECRET ||= 'chunked-resource-upload-test-secret';
process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test';

const [
  { default: app },
  { default: prisma },
  { signToken },
  { env },
] = await Promise.all([
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
const readRequestBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
};

test('large course resources upload through ordered LMS API chunks and S3 multipart', async () => {
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
  const objects = new Map();
  const multipartUploads = new Map();
  const restores = [];
  let resourceRecord;
  const storageServer = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const segments = url.pathname.split('/').filter(Boolean);
    const key = decodeURIComponent(segments.slice(1).join('/'));
    const body = await readRequestBody(req);

    if (req.method === 'POST' && url.searchParams.has('uploads')) {
      const uploadId = `upload-${multipartUploads.size + 1}`;
      multipartUploads.set(uploadId, {
        key,
        contentType: req.headers['content-type'],
        metadata: {
          'owner-id': req.headers['x-amz-meta-owner-id'],
          'expected-size': req.headers['x-amz-meta-expected-size'],
        },
        parts: new Map(),
      });
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      res.end(`<CreateMultipartUploadResult><Bucket>test-bucket</Bucket><Key>${key}</Key><UploadId>${uploadId}</UploadId></CreateMultipartUploadResult>`);
      return;
    }

    const uploadId = url.searchParams.get('uploadId');
    if (req.method === 'PUT' && uploadId) {
      const upload = multipartUploads.get(uploadId);
      assert.ok(upload);
      const partNumber = Number(url.searchParams.get('partNumber'));
      const etag = `"part-${partNumber}"`;
      upload.parts.set(partNumber, { body, etag });
      res.writeHead(200, { ETag: etag });
      res.end();
      return;
    }

    if (req.method === 'POST' && uploadId) {
      const upload = multipartUploads.get(uploadId);
      assert.ok(upload);
      const completeBody = body.toString('utf8');
      const partNumbers = [...completeBody.matchAll(/<PartNumber>(\d+)<\/PartNumber>/g)]
        .map((match) => Number(match[1]));
      const completeBodyBuffer = Buffer.concat(partNumbers.map((partNumber) => {
        const part = upload.parts.get(partNumber);
        assert.ok(part);
        return part.body;
      }));
      objects.set(key, {
        body: completeBodyBuffer,
        contentType: upload.contentType,
        metadata: upload.metadata,
      });
      multipartUploads.delete(uploadId);
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      res.end(`<CompleteMultipartUploadResult><Bucket>test-bucket</Bucket><Key>${key}</Key><ETag>"complete"</ETag></CompleteMultipartUploadResult>`);
      return;
    }

    if (req.method === 'DELETE' && uploadId) {
      multipartUploads.delete(uploadId);
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'PUT') {
      objects.set(key, {
        body,
        contentType: req.headers['content-type'],
        metadata: {
          'owner-id': req.headers['x-amz-meta-owner-id'],
          'expected-size': req.headers['x-amz-meta-expected-size'],
        },
      });
      res.writeHead(200, { ETag: '"temporary"' });
      res.end();
      return;
    }

    const object = objects.get(key);
    if (req.method === 'HEAD') {
      assert.ok(object, `Expected object ${key} to exist`);
      res.writeHead(200, {
        'Content-Length': object.body.length,
        'Content-Type': object.contentType,
        'ETag': '"stored"',
        'x-amz-meta-owner-id': object.metadata['owner-id'],
        'x-amz-meta-expected-size': object.metadata['expected-size'],
      });
      res.end();
      return;
    }

    if (req.method === 'GET') {
      assert.ok(object, `Expected object ${key} to exist`);
      const range = req.headers.range;
      const responseBody = range ? object.body.subarray(0, 16) : object.body;
      res.writeHead(range ? 206 : 200, {
        'Content-Length': responseBody.length,
        'Content-Type': object.contentType || 'application/octet-stream',
        ...(range ? { 'Content-Range': `bytes 0-${responseBody.length - 1}/${object.body.length}` } : {}),
      });
      res.end(responseBody);
      return;
    }

    if (req.method === 'DELETE') {
      objects.delete(key);
      res.writeHead(204);
      res.end();
      return;
    }

    res.writeHead(500);
    res.end('Unexpected storage request');
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
    restores.push(stubMethod(prisma.resource, 'findFirst', async () => null));
    restores.push(stubMethod(prisma.resource, 'create', async ({ data }) => {
      resourceRecord = {
        id: 'resource-1',
        courseId: data.courseId,
        lessonId: data.lessonId,
        originalName: data.originalName,
        mimeType: data.mimeType,
        sizeBytes: data.sizeBytes,
        storagePath: data.storagePath,
        createdAt: new Date(),
      };
      return resourceRecord;
    }));
    restores.push(stubMethod(prisma.auditLog, 'create', async () => ({ id: 'audit-1' })));

    apiServer = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => apiServer.once('listening', resolve));
    const baseUrl = `http://127.0.0.1:${apiServer.address().port}/api/resources`;
    const cookie = `reoa_session=${signToken({ sub: admin.id })}`;
    const file = Buffer.alloc(10 * 1024 * 1024);
    file.write('ftyp', 4, 'ascii');

    const initResponse = await fetch(`${baseUrl}/chunked-upload`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        courseId: 'course-1',
        originalName: 'lesson.mp4',
        mimeType: 'video/mp4',
        sizeBytes: file.length,
      }),
    });
    assert.equal(initResponse.status, 201);
    const initPayload = await initResponse.json();
    assert.equal(initPayload.data.mode, 's3');
    assert.equal(initPayload.data.chunkSizeBytes, 4 * 1024 * 1024);
    let uploadToken = initPayload.data.uploadToken;

    const chunkSize = initPayload.data.chunkSizeBytes;
    const incompleteFinalize = await fetch(`${baseUrl}/chunked-upload/finalize`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
        'X-Resource-Upload-Token': uploadToken,
      },
      body: '{}',
    });
    assert.equal(incompleteFinalize.status, 409);

    const outOfOrderResponse = await fetch(`${baseUrl}/chunked-upload/chunks/1`, {
      method: 'PUT',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/octet-stream',
        'X-Resource-Upload-Token': uploadToken,
      },
      body: file.subarray(chunkSize, chunkSize * 2),
    });
    assert.equal(outOfOrderResponse.status, 409);

    for (let start = 0, index = 0; start < file.length; start += chunkSize, index += 1) {
      const requestToken = uploadToken;
      const chunkResponse = await fetch(`${baseUrl}/chunked-upload/chunks/${index}`, {
        method: 'PUT',
        headers: {
          Cookie: cookie,
          'Content-Type': 'application/octet-stream',
          'X-Resource-Upload-Token': requestToken,
        },
        body: file.subarray(start, Math.min(start + chunkSize, file.length)),
      });
      assert.equal(chunkResponse.status, 200);
      let chunkPayload = await chunkResponse.json();
      if (index === 0) {
        const retryResponse = await fetch(`${baseUrl}/chunked-upload/chunks/${index}`, {
          method: 'PUT',
          headers: {
            Cookie: cookie,
            'Content-Type': 'application/octet-stream',
            'X-Resource-Upload-Token': requestToken,
          },
          body: file.subarray(start, Math.min(start + chunkSize, file.length)),
        });
        assert.equal(retryResponse.status, 200);
        chunkPayload = await retryResponse.json();
      } else if (index === 1) {
        const conflictingRetry = await fetch(`${baseUrl}/chunked-upload/chunks/${index}`, {
          method: 'PUT',
          headers: {
            Cookie: cookie,
            'Content-Type': 'application/octet-stream',
            'X-Resource-Upload-Token': requestToken,
          },
          body: file.subarray(start, Math.min(start + chunkSize, file.length)),
        });
        assert.equal(conflictingRetry.status, 200);
        chunkPayload = await conflictingRetry.json();
        const conflictingRetryChunk = Buffer.from(file.subarray(start, start + chunkSize));
        conflictingRetryChunk[0] = 1;
        const rejectedRetry = await fetch(`${baseUrl}/chunked-upload/chunks/${index}`, {
          method: 'PUT',
          headers: {
            Cookie: cookie,
            'Content-Type': 'application/octet-stream',
            'X-Resource-Upload-Token': requestToken,
          },
          body: conflictingRetryChunk,
        });
        assert.equal(rejectedRetry.status, 409);
      }
      uploadToken = chunkPayload.data.uploadToken;
    }

    const finalizeResponse = await fetch(`${baseUrl}/chunked-upload/finalize`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
        'X-Resource-Upload-Token': uploadToken,
      },
      body: '{}',
    });
    assert.equal(finalizeResponse.status, 201);
    assert.equal(resourceRecord.originalName, 'lesson.mp4');
    assert.equal(resourceRecord.sizeBytes, file.length);
    assert.deepEqual(objects.get(resourceRecord.storagePath).body, file);
    assert.equal(multipartUploads.size, 0);
  } finally {
    Object.assign(env, originalStorageConfig);
    if (apiServer?.listening) await closeServer(apiServer);
    if (storageServer.listening) await closeServer(storageServer);
    restores.reverse().forEach((restore) => restore());
  }
});
