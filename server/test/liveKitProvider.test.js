import test from 'node:test';
import assert from 'node:assert/strict';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '../src/config/env.js';
import {
  createJoinToken,
  createRecordingDownloadCommand,
  deleteRecordingObject,
  isLiveKitConfigured,
  mapEgressRecordingStatus,
  startRoomRecording,
} from '../src/services/liveKitProvider.js';
import { EgressClient, EgressStatus, EncodingOptionsPreset } from 'livekit-server-sdk';

test('LiveKit join credentials are signed for one room and preserve publish permissions', async () => {
  const previous = {
    url: env.livekitUrl,
    key: env.livekitApiKey,
    secret: env.livekitApiSecret,
  };
  env.livekitUrl = 'wss://rtc.example.test';
  env.livekitApiKey = 'test-api-key';
  env.livekitApiSecret = 'test-api-secret';

  try {
    const result = await createJoinToken({
      roomName: 'reo-test-room',
      user: { id: 'student-1', firstName: 'Test', lastName: 'Student', role: { name: 'STUDENT' } },
      canPublish: false,
    });
    const payload = JSON.parse(Buffer.from(result.token.split('.')[1], 'base64url').toString('utf8'));
    assert.equal(result.serverUrl, env.livekitUrl);
    assert.equal(payload.sub, 'student-1');
    assert.equal(payload.video.room, 'reo-test-room');
    assert.equal(payload.video.roomJoin, true);
    assert.equal(payload.video.canPublish, false);
    assert.equal(payload.video.canSubscribe, true);
  } finally {
    env.livekitUrl = previous.url;
    env.livekitApiKey = previous.key;
    env.livekitApiSecret = previous.secret;
  }
});

test('LiveKit configuration is required before issuing a room token', async () => {
  const previous = {
    url: env.livekitUrl,
    key: env.livekitApiKey,
    secret: env.livekitApiSecret,
  };
  env.livekitUrl = undefined;
  env.livekitApiKey = undefined;
  env.livekitApiSecret = undefined;
  try {
    assert.equal(isLiveKitConfigured(), false);
    await assert.rejects(
      createJoinToken({ roomName: 'room', user: { id: 'user' }, canPublish: false }),
      (error) => error.status === 503
        && error.message.includes('LIVEKIT_URL')
        && error.message.includes('LIVEKIT_API_KEY')
        && error.message.includes('LIVEKIT_API_SECRET'),
    );
  } finally {
    env.livekitUrl = previous.url;
    env.livekitApiKey = previous.key;
    env.livekitApiSecret = previous.secret;
  }
});

test('LiveKit Egress statuses map to recording lifecycle states', () => {
  assert.equal(mapEgressRecordingStatus(EgressStatus.EGRESS_STARTING), 'STARTING');
  assert.equal(mapEgressRecordingStatus(EgressStatus.EGRESS_ACTIVE), 'ACTIVE');
  assert.equal(mapEgressRecordingStatus(EgressStatus.EGRESS_ENDING), 'STOPPED');
  assert.equal(mapEgressRecordingStatus(EgressStatus.EGRESS_COMPLETE), 'COMPLETE');
  assert.equal(mapEgressRecordingStatus(EgressStatus.EGRESS_FAILED), 'FAILED');
  assert.equal(mapEgressRecordingStatus(EgressStatus.EGRESS_ABORTED), 'FAILED');
  assert.equal(mapEgressRecordingStatus(999), null);
});

test('room recordings request 1080p video with audio enabled', async (t) => {
  const previous = {
    url: env.livekitUrl,
    key: env.livekitApiKey,
    secret: env.livekitApiSecret,
    bucket: env.livekitRecordingS3Bucket,
    region: env.livekitRecordingS3Region,
    accessKey: env.livekitRecordingS3AccessKey,
    storageSecret: env.livekitRecordingS3Secret,
    endpoint: env.livekitRecordingS3Endpoint,
    pathStyle: env.livekitRecordingS3ForcePathStyle,
  };
  Object.assign(env, {
    livekitUrl: 'wss://rtc.example.test',
    livekitApiKey: 'test-api-key',
    livekitApiSecret: 'test-api-secret',
    livekitRecordingS3Bucket: 'recordings',
    livekitRecordingS3Region: 'us-east-005',
    livekitRecordingS3AccessKey: 'test-access-key',
    livekitRecordingS3Secret: 'test-secret-key',
    livekitRecordingS3Endpoint: 'https://s3.example.test',
    livekitRecordingS3ForcePathStyle: false,
  });

  const startEgress = t.mock.method(
    EgressClient.prototype,
    'startRoomCompositeEgress',
    async () => ({ egressId: 'egress-1' }),
  );
  try {
    await startRoomRecording('room-1', 'recording.mp4');

    const [, , options] = startEgress.mock.calls[0].arguments;
    assert.equal(options.encodingOptions, EncodingOptionsPreset.H264_1080P_30);
    assert.equal(options.audioOnly, false);
    assert.equal(options.videoOnly, false);
  } finally {
    Object.assign(env, previous);
  }
});

test('recording downloads use an attachment response while playback stays inline', () => {
  const download = createRecordingDownloadCommand({
    bucket: 'recordings',
    storageKey: 'live-class-recordings/class-1/recording.mp4',
    download: true,
  });
  const playback = createRecordingDownloadCommand({
    bucket: 'recordings',
    storageKey: 'live-class-recordings/class-1/recording.mp4',
  });

  assert.equal(download.input.Bucket, 'recordings');
  assert.equal(download.input.ResponseContentDisposition, 'attachment; filename="REO-Academy-class-recording.mp4"');
  assert.equal(playback.input.ResponseContentDisposition, undefined);
});

test('recording object deletion uses the configured private bucket and storage key', async (t) => {
  const previous = {
    url: env.livekitUrl,
    key: env.livekitApiKey,
    secret: env.livekitApiSecret,
    bucket: env.livekitRecordingS3Bucket,
    region: env.livekitRecordingS3Region,
    accessKey: env.livekitRecordingS3AccessKey,
    storageSecret: env.livekitRecordingS3Secret,
    endpoint: env.livekitRecordingS3Endpoint,
    playbackEndpoint: env.livekitRecordingS3PlaybackEndpoint,
    pathStyle: env.livekitRecordingS3ForcePathStyle,
  };
  Object.assign(env, {
    livekitUrl: 'wss://rtc.example.test',
    livekitApiKey: 'test-api-key',
    livekitApiSecret: 'test-api-secret',
    livekitRecordingS3Bucket: 'recordings',
    livekitRecordingS3Region: 'us-east-005',
    livekitRecordingS3AccessKey: 'test-access-key',
    livekitRecordingS3Secret: 'test-secret-key',
    livekitRecordingS3Endpoint: 'https://s3.example.test',
    livekitRecordingS3PlaybackEndpoint: 'https://playback.example.test',
    livekitRecordingS3ForcePathStyle: false,
  });
  const send = t.mock.method(S3Client.prototype, 'send', async () => ({ $metadata: {} }));
  try {
    await deleteRecordingObject('live-class-recordings/class-1/recording.mp4');

    const [command] = send.mock.calls[0].arguments;
    assert.ok(command instanceof DeleteObjectCommand);
    assert.equal(command.input.Bucket, 'recordings');
    assert.equal(command.input.Key, 'live-class-recordings/class-1/recording.mp4');
  } finally {
    Object.assign(env, previous);
  }
});
