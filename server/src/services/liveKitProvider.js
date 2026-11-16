import {
  AccessToken,
  EncodingOptionsPreset,
  EgressStatus,
  EncodedFileOutput,
  EncodedFileType,
  EgressClient,
  RoomServiceClient,
  S3Upload,
} from 'livekit-server-sdk';
import {
  DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { LIVEKIT_JOIN_TOKEN_TTL_SECONDS } from '../utils/liveClassScheduling.js';
import { createS3Client } from './objectStorage.js';

export const isLiveKitConfigured = () => Boolean(
  env.livekitUrl && env.livekitApiKey && env.livekitApiSecret,
);

export const createJoinToken = async ({
  roomName,
  user,
  canPublish,
  ttlSeconds = LIVEKIT_JOIN_TOKEN_TTL_SECONDS,
}) => {
  if (!isLiveKitConfigured()) {
    const error = new Error(
      'Live classroom is unavailable. Configure LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET on the server.',
    );
    error.status = 503;
    throw error;
  }

  const token = new AccessToken(env.livekitApiKey, env.livekitApiSecret, {
    identity: user.id,
    name: `${user.firstName} ${user.lastName}`.trim(),
    ttl: ttlSeconds,
    metadata: JSON.stringify({ role: user.role.name, userId: user.id }),
  });
  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish,
    canSubscribe: true,
    canPublishData: true,
  });

  return { serverUrl: env.livekitUrl, token: await token.toJwt() };
};

const createRoomServiceClient = () => {
  const serviceUrl = env.livekitUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
  return new RoomServiceClient(serviceUrl, env.livekitApiKey, env.livekitApiSecret);
};

export const closeRoom = async (roomName) => {
  if (!isLiveKitConfigured()) return;
  const roomService = createRoomServiceClient();
  const rooms = await roomService.listRooms([roomName]);
  if (rooms.some((room) => room.name === roomName)) {
    await roomService.deleteRoom(roomName);
  }
};

export const updateParticipantPublishPermission = async (roomName, identity, canPublish) => {
  if (!isLiveKitConfigured()) {
    const error = new Error('Live classroom service is not configured');
    error.status = 503;
    throw error;
  }
  return createRoomServiceClient().updateParticipant(roomName, identity, {
    permission: {
      canSubscribe: true,
      canPublish,
      canPublishData: true,
    },
  });
};

export const removeLiveKitParticipant = async (roomName, identity) => {
  if (!isLiveKitConfigured()) return false;
  const roomService = createRoomServiceClient();
  const rooms = await roomService.listRooms([roomName]);
  if (!rooms.some((room) => room.name === roomName)) return false;
  const participants = await roomService.listParticipants(roomName);
  if (!participants.some((participant) => participant.identity === identity)) return false;
  await roomService.removeParticipant(roomName, identity);
  return true;
};

export const listLiveKitParticipants = async (roomName) => {
  if (!isLiveKitConfigured()) return [];
  const roomService = createRoomServiceClient();
  const rooms = await roomService.listRooms([roomName]);
  if (!rooms.some((room) => room.name === roomName)) return [];
  const participants = await roomService.listParticipants(roomName);
  return participants.map(({ identity }) => identity);
};

export const isLiveKitRecordingConfigured = () => Boolean(
  isLiveKitConfigured()
  && env.livekitRecordingS3Bucket
  && env.livekitRecordingS3Region
  && env.livekitRecordingS3AccessKey
  && env.livekitRecordingS3Secret,
);

export const mapEgressRecordingStatus = (status) => {
  switch (status) {
    case EgressStatus.EGRESS_STARTING: return 'STARTING';
    case EgressStatus.EGRESS_ACTIVE: return 'ACTIVE';
    case EgressStatus.EGRESS_ENDING: return 'STOPPED';
    case EgressStatus.EGRESS_COMPLETE: return 'COMPLETE';
    case EgressStatus.EGRESS_FAILED:
    case EgressStatus.EGRESS_ABORTED:
      return 'FAILED';
    default: return null;
  }
};

const createEgressClient = () => {
  const serviceUrl = env.livekitUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
  return new EgressClient(serviceUrl, env.livekitApiKey, env.livekitApiSecret);
};

const createS3Upload = () => new S3Upload({
  accessKey: env.livekitRecordingS3AccessKey,
  secret: env.livekitRecordingS3Secret,
  bucket: env.livekitRecordingS3Bucket,
  region: env.livekitRecordingS3Region,
  endpoint: env.livekitRecordingS3Endpoint || '',
  forcePathStyle: env.livekitRecordingS3ForcePathStyle,
});

export const createRecordingDownloadCommand = ({ bucket, storageKey, download = false }) => (
  new GetObjectCommand({
    Bucket: bucket,
    Key: storageKey,
    ...(download ? {
      ResponseContentDisposition: 'attachment; filename="REO-Academy-class-recording.mp4"',
    } : {}),
  })
);

export const createRecordingKey = (liveClassId) => (
  `live-class-recordings/${liveClassId}/${randomUUID()}.mp4`
);

export const startRoomRecording = async (roomName, storageKey) => {
  if (!isLiveKitRecordingConfigured()) {
    const error = new Error(
      'Recording is unavailable. Configure LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_RECORDING_S3_BUCKET, LIVEKIT_RECORDING_S3_REGION, LIVEKIT_RECORDING_S3_ACCESS_KEY, and LIVEKIT_RECORDING_S3_SECRET on the server.',
    );
    error.status = 503;
    throw error;
  }
  const file = new EncodedFileOutput({
    fileType: EncodedFileType.MP4,
    filepath: storageKey,
    output: { case: 's3', value: createS3Upload() },
  });
  return createEgressClient().startRoomCompositeEgress(roomName, { file }, {
    encodingOptions: EncodingOptionsPreset.H264_1080P_30,
    audioOnly: false,
    videoOnly: false,
  });
};

export const stopRoomRecording = async (egressId) => {
  if (!isLiveKitRecordingConfigured()) {
    const error = new Error(
      'Recording is unavailable. Configure LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_RECORDING_S3_BUCKET, LIVEKIT_RECORDING_S3_REGION, LIVEKIT_RECORDING_S3_ACCESS_KEY, and LIVEKIT_RECORDING_S3_SECRET on the server.',
    );
    error.status = 503;
    throw error;
  }
  return createEgressClient().stopEgress(egressId);
};

export const getRoomRecordingInfo = async (egressId) => {
  if (!isLiveKitRecordingConfigured()) return null;
  const [info] = await createEgressClient().listEgress({ egressId });
  return info || null;
};

export const checkRecordingStorage = async () => {
  const endpoint = env.livekitRecordingS3PlaybackEndpoint || env.livekitRecordingS3Endpoint;
  await createS3Client(endpoint).send(new HeadBucketCommand({
    Bucket: env.livekitRecordingS3Bucket,
  }));
};

export const getRecordingPlaybackUrl = async (storageKey, { download = false } = {}) => {
  if (!isLiveKitRecordingConfigured()) {
    const error = new Error(
      'Recording playback is unavailable. Configure LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_RECORDING_S3_BUCKET, LIVEKIT_RECORDING_S3_REGION, LIVEKIT_RECORDING_S3_ACCESS_KEY, and LIVEKIT_RECORDING_S3_SECRET on the server.',
    );
    error.status = 503;
    throw error;
  }
  const endpoint = env.livekitRecordingS3PlaybackEndpoint || env.livekitRecordingS3Endpoint;
  const client = createS3Client(endpoint);
  await client.send(new HeadObjectCommand({
    Bucket: env.livekitRecordingS3Bucket,
    Key: storageKey,
  }));
  return getSignedUrl(
    client,
    createRecordingDownloadCommand({
      bucket: env.livekitRecordingS3Bucket,
      storageKey,
      download,
    }),
    { expiresIn: 300 },
  );
};

export const deleteRecordingObject = async (storageKey) => {
  if (!isLiveKitRecordingConfigured()) {
    const error = new Error('Recording storage is not configured');
    error.status = 503;
    throw error;
  }
  const endpoint = env.livekitRecordingS3PlaybackEndpoint || env.livekitRecordingS3Endpoint;
  return createS3Client(endpoint).send(new DeleteObjectCommand({
    Bucket: env.livekitRecordingS3Bucket,
    Key: storageKey,
  }));
};
