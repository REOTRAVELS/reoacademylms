import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

process.env.JWT_SECRET ||= 'object-storage-test-secret';
const [{ createObjectStorageService, createS3Client }, {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
}] = await Promise.all([
  import('../src/services/objectStorage.js'),
  import('@aws-sdk/client-s3'),
]);

test('S3 client does not add optional checksums to presigned uploads', async () => {
  const client = createS3Client();
  assert.equal(await client.config.requestChecksumCalculation(), 'WHEN_REQUIRED');
  client.destroy();
});

test('object storage signs uploads with owner, content type, and expected size', async () => {
  let command;
  const storage = createObjectStorageService({
    bucket: 'private-bucket',
    uploadClient: { send: async () => ({}) },
    signUrl: async (_client, signedCommand, options) => {
      command = { signedCommand, options };
      return 'https://storage.example.test/signed-upload';
    },
  });

  const intent = await storage.createUploadIntent({
    key: 'avatars/user-1/image.png',
    contentType: 'image/png',
    ownerId: 'user-1',
    sizeBytes: 123,
  });

  assert.equal(intent.uploadUrl, 'https://storage.example.test/signed-upload');
  assert.deepEqual(intent.headers, {
    'Content-Type': 'image/png',
    'x-amz-meta-owner-id': 'user-1',
    'x-amz-meta-expected-size': '123',
  });
  assert.ok(command.signedCommand instanceof PutObjectCommand);
  assert.deepEqual(command.signedCommand.input.Metadata, {
    'owner-id': 'user-1',
    'expected-size': '123',
  });
  assert.equal(command.options.expiresIn, 300);
});

test('object storage verifies upload ownership and inspects a bounded file header', async () => {
  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]);
  const sent = [];
  const storage = createObjectStorageService({
    bucket: 'private-bucket',
    uploadClient: {
      send: async (command) => {
        sent.push(command);
        if (command instanceof HeadObjectCommand) {
          return {
            Metadata: { 'owner-id': 'user-1', 'expected-size': '10' },
            ContentLength: 10,
            ContentType: 'image/png',
          };
        }
        return { Body: Readable.from([header]) };
      },
    },
  });

  assert.deepEqual(await storage.verifyUpload({
    key: 'avatars/user-1/image.png',
    contentType: 'image/png',
    ownerId: 'user-1',
    sizeBytes: 10,
  }), header);
  assert.ok(sent[0] instanceof HeadObjectCommand);
  assert.ok(sent[1] instanceof GetObjectCommand);
  assert.equal(sent[1].input.Range, 'bytes=0-15');

  const mismatchStorage = createObjectStorageService({
    bucket: 'private-bucket',
    uploadClient: {
      send: async () => ({
        Metadata: { 'owner-id': 'another-user', 'expected-size': '10' },
        ContentLength: 10,
        ContentType: 'image/png',
      }),
    },
  });
  assert.equal(await mismatchStorage.verifyUpload({
    key: 'avatars/user-1/image.png',
    contentType: 'image/png',
    ownerId: 'user-1',
    sizeBytes: 10,
  }), null);
});
