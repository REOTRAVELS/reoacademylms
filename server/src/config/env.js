import dotenv from 'dotenv';

dotenv.config();

const nodeEnv = process.env.NODE_ENV || 'development';
const port = process.env.PORT === undefined ? 5000 : Number(process.env.PORT);
const emailFrom = process.env.EMAIL_FROM || process.env.SMTP_FROM;
const hasBrevoEmailConfig = Boolean(process.env.BREVO_API_KEY && emailFrom);
const hasSmtpEmailConfig = Boolean(process.env.SMTP_URL && process.env.SMTP_FROM);
const fileStorageProvider = process.env.FILE_STORAGE_PROVIDER || (
  nodeEnv === 'production' ? 's3' : 'local'
);
const maxUploadFileSizeMb = 2048;
const maxFileSizeMb = process.env.MAX_FILE_SIZE_MB === undefined
  ? maxUploadFileSizeMb
  : Number(process.env.MAX_FILE_SIZE_MB);
const attendanceThresholdPercent = process.env.ATTENDANCE_THRESHOLD_PERCENT === undefined
  ? 75
  : Number(process.env.ATTENDANCE_THRESHOLD_PERCENT);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}
if (!Number.isFinite(maxFileSizeMb) || maxFileSizeMb <= 0 || maxFileSizeMb > maxUploadFileSizeMb) {
  throw new Error('MAX_FILE_SIZE_MB must be a positive number no greater than 2048');
}
if (!Number.isFinite(attendanceThresholdPercent) || attendanceThresholdPercent <= 0 || attendanceThresholdPercent > 100) {
  throw new Error('ATTENDANCE_THRESHOLD_PERCENT must be greater than 0 and no greater than 100');
}
if (!['local', 's3'].includes(fileStorageProvider)) {
  throw new Error('FILE_STORAGE_PROVIDER must be local or s3');
}
if (nodeEnv === 'production' && fileStorageProvider !== 's3') {
  throw new Error('FILE_STORAGE_PROVIDER must be s3 in production');
}
if (fileStorageProvider === 's3' && recordingStorageConfigMissing()) {
  throw new Error('S3 file storage requires a bucket, region, access key, and secret');
}
if (nodeEnv === 'production' && (typeof process.env.JWT_SECRET !== 'string' || process.env.JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET must be at least 32 characters in production');
}
if (nodeEnv === 'production' && !process.env.CLIENT_URL?.startsWith('https://')) {
  throw new Error('CLIENT_URL must use HTTPS in production');
}
const liveKitConfigCount = [
  process.env.LIVEKIT_URL,
  process.env.LIVEKIT_API_KEY,
  process.env.LIVEKIT_API_SECRET,
].filter(Boolean).length;
if (liveKitConfigCount !== 0 && liveKitConfigCount !== 3) {
  throw new Error('LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET must be configured together');
}
const recordingStorageConfig = [
  process.env.LIVEKIT_RECORDING_S3_BUCKET,
  process.env.LIVEKIT_RECORDING_S3_REGION,
  process.env.LIVEKIT_RECORDING_S3_ACCESS_KEY,
  process.env.LIVEKIT_RECORDING_S3_SECRET,
];
const recordingStorageConfigCount = recordingStorageConfig.filter(Boolean).length;
if (recordingStorageConfigCount !== 0 && recordingStorageConfigCount !== recordingStorageConfig.length) {
  throw new Error('All LIVEKIT_RECORDING_S3_BUCKET, LIVEKIT_RECORDING_S3_REGION, LIVEKIT_RECORDING_S3_ACCESS_KEY, and LIVEKIT_RECORDING_S3_SECRET values are required together');
}
if (recordingStorageConfigCount && liveKitConfigCount !== 3) {
  throw new Error('LiveKit credentials must be configured to enable classroom recordings');
}
if (nodeEnv === 'production') {
  if (liveKitConfigCount !== 3) {
    throw new Error('LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET are required in production');
  }
  if (recordingStorageConfigCount !== recordingStorageConfig.length) {
    throw new Error('LiveKit recording S3 bucket, region, access key, and secret are required in production');
  }
  if (!hasBrevoEmailConfig && !hasSmtpEmailConfig) {
    throw new Error('Configure BREVO_API_KEY with EMAIL_FROM, or SMTP_URL with SMTP_FROM, in production');
  }
  if (process.env.VERCEL === '1' && !process.env.REDIS_URL) {
    throw new Error('REDIS_URL is required on Vercel for shared classroom realtime state');
  }
  let liveKitUrl;
  let smtpUrl;
  try {
    liveKitUrl = new URL(process.env.LIVEKIT_URL);
  } catch {
    throw new Error('LIVEKIT_URL must be a valid secure WSS URL in production');
  }
  if (liveKitUrl.protocol !== 'wss:' || ['localhost', '127.0.0.1', '::1', '[::1]'].includes(liveKitUrl.hostname)) {
    throw new Error('LIVEKIT_URL must use a reachable WSS host in production');
  }
  if (process.env.SMTP_URL) {
    try {
      smtpUrl = new URL(process.env.SMTP_URL);
    } catch {
      throw new Error('SMTP_URL must be a valid smtp:// or smtps:// URL in production');
    }
    if (!['smtp:', 'smtps:'].includes(smtpUrl.protocol) || !smtpUrl.hostname) {
      throw new Error('SMTP_URL must use a valid smtp:// or smtps:// URL in production');
    }
  }

  for (const [name, value] of [
    ['LIVEKIT_RECORDING_S3_ENDPOINT', process.env.LIVEKIT_RECORDING_S3_ENDPOINT],
    ['LIVEKIT_RECORDING_S3_PLAYBACK_ENDPOINT', process.env.LIVEKIT_RECORDING_S3_PLAYBACK_ENDPOINT],
  ]) {
    if (!value) continue;
    let endpoint;
    try {
      endpoint = new URL(value);
    } catch {
      throw new Error(`${name} must be a valid HTTPS URL in production`);
    }
    if (endpoint.protocol !== 'https:' || ['localhost', '127.0.0.1', '::1', '[::1]'].includes(endpoint.hostname)) {
      throw new Error(`${name} must use a reachable HTTPS host in production`);
    }
  }
}

function recordingStorageConfigMissing() {
  return ![
    process.env.LIVEKIT_RECORDING_S3_BUCKET,
    process.env.LIVEKIT_RECORDING_S3_REGION,
    process.env.LIVEKIT_RECORDING_S3_ACCESS_KEY,
    process.env.LIVEKIT_RECORDING_S3_SECRET,
  ].every(Boolean);
}

export const env = {
  nodeEnv,
  port,
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  cookieName: process.env.COOKIE_NAME || 'reoa_session',
  uploadDir: process.env.UPLOAD_DIR || './uploads',
  maxFileSizeMb,
  attendanceThresholdPercent,
  smtpUrl: process.env.SMTP_URL,
  smtpFrom: process.env.SMTP_FROM,
  emailFrom,
  brevoApiKey: process.env.BREVO_API_KEY,
  fileStorageProvider,
  redisUrl: process.env.REDIS_URL,
  livekitUrl: process.env.LIVEKIT_URL,
  livekitApiKey: process.env.LIVEKIT_API_KEY,
  livekitApiSecret: process.env.LIVEKIT_API_SECRET,
  livekitRecordingS3Bucket: process.env.LIVEKIT_RECORDING_S3_BUCKET,
  livekitRecordingS3Region: process.env.LIVEKIT_RECORDING_S3_REGION,
  livekitRecordingS3AccessKey: process.env.LIVEKIT_RECORDING_S3_ACCESS_KEY,
  livekitRecordingS3Secret: process.env.LIVEKIT_RECORDING_S3_SECRET,
  livekitRecordingS3Endpoint: process.env.LIVEKIT_RECORDING_S3_ENDPOINT,
  livekitRecordingS3PlaybackEndpoint: process.env.LIVEKIT_RECORDING_S3_PLAYBACK_ENDPOINT,
  livekitRecordingS3ForcePathStyle: process.env.LIVEKIT_RECORDING_S3_FORCE_PATH_STYLE === 'true',
};

if (
  process.env.LIVEKIT_RECORDING_S3_FORCE_PATH_STYLE !== undefined
  && !['true', 'false'].includes(process.env.LIVEKIT_RECORDING_S3_FORCE_PATH_STYLE)
) {
  throw new Error('LIVEKIT_RECORDING_S3_FORCE_PATH_STYLE must be true or false');
}

if (!env.jwtSecret) {
  throw new Error('JWT_SECRET is required');
}
