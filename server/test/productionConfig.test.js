import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = new URL('../src/config/env.js', import.meta.url).href;

const loadConfig = (overrides = {}) => spawnSync(
  process.execPath,
  ['--input-type=module', '-e', `await import(${JSON.stringify(configPath)})`],
  {
    cwd: serverDirectory,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      FILE_STORAGE_PROVIDER: 's3',
      JWT_SECRET: 'a-production-secret-that-is-long-enough',
      CLIENT_URL: 'https://academy.example.test',
      PORT: '5000',
      BREVO_API_KEY: '',
      EMAIL_FROM: '',
      SMTP_URL: 'smtps://mail-user:mail-password@smtp.example.test:465',
      SMTP_FROM: 'REO Academy <no-reply@example.test>',
      VERCEL: '',
      REDIS_URL: '',
      LIVEKIT_URL: 'wss://rtc.example.test',
      LIVEKIT_API_KEY: 'livekit-test-key',
      LIVEKIT_API_SECRET: 'livekit-test-secret',
      LIVEKIT_RECORDING_S3_BUCKET: 'reo-recordings',
      LIVEKIT_RECORDING_S3_REGION: 'us-east-1',
      LIVEKIT_RECORDING_S3_ACCESS_KEY: 's3-test-access',
      LIVEKIT_RECORDING_S3_SECRET: 's3-test-secret',
      LIVEKIT_RECORDING_S3_ENDPOINT: 'https://s3.example.test',
      LIVEKIT_RECORDING_S3_PLAYBACK_ENDPOINT: 'https://s3.example.test',
      ...overrides,
    },
  },
);

test('production configuration rejects a short JWT secret', () => {
  const result = loadConfig({ JWT_SECRET: 'too-short' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /JWT_SECRET must be at least 32 characters in production/);
});

test('production configuration requires HTTPS for the client origin', () => {
  const result = loadConfig({ CLIENT_URL: 'http://academy.example.test' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CLIENT_URL must use HTTPS in production/);
});

test('production configuration rejects invalid port and upload size values', () => {
  const invalidPort = loadConfig({ PORT: '70000' });
  assert.notEqual(invalidPort.status, 0);
  assert.match(invalidPort.stderr, /PORT must be an integer between 1 and 65535/);

  const invalidUploadSize = loadConfig({ MAX_FILE_SIZE_MB: 'not-a-size' });
  assert.notEqual(invalidUploadSize.status, 0);
  assert.match(invalidUploadSize.stderr, /MAX_FILE_SIZE_MB must be a positive number no greater than 2048/);

  const oversizedUploadLimit = loadConfig({ MAX_FILE_SIZE_MB: '2049' });
  assert.notEqual(oversizedUploadLimit.status, 0);
  assert.match(oversizedUploadLimit.stderr, /MAX_FILE_SIZE_MB must be a positive number no greater than 2048/);
});

test('production configuration accepts valid deployment values', () => {
  const result = loadConfig();
  assert.equal(result.status, 0, result.stderr);
});

test('production configuration accepts the 2 GB upload limit', () => {
  const result = loadConfig({ MAX_FILE_SIZE_MB: '2048' });
  assert.equal(result.status, 0, result.stderr);
});

test('production configuration requires LiveKit, private recording storage, and email delivery', () => {
  for (const overrides of [
    { LIVEKIT_URL: '' },
    { LIVEKIT_RECORDING_S3_BUCKET: '' },
    { SMTP_URL: '' },
    { SMTP_FROM: '' },
  ]) {
    const result = loadConfig(overrides);
    assert.notEqual(result.status, 0);
  }
});

test('production configuration accepts Brevo HTTPS email and requires Vercel Redis', () => {
  const brevoConfig = loadConfig({
    SMTP_URL: '',
    SMTP_FROM: '',
    BREVO_API_KEY: 'brevo-test-key',
    EMAIL_FROM: 'REO Academy <sender@example.test>',
  });
  assert.equal(brevoConfig.status, 0, brevoConfig.stderr);

  const missingRedis = loadConfig({ VERCEL: '1', REDIS_URL: '' });
  assert.notEqual(missingRedis.status, 0);
  assert.match(missingRedis.stderr, /REDIS_URL is required on Vercel/);

  const withRedis = loadConfig({ VERCEL: '1', REDIS_URL: 'rediss://user:pass@redis.example.test:6379' });
  assert.equal(withRedis.status, 0, withRedis.stderr);
});

test('production configuration rejects insecure or local recording service endpoints', () => {
  for (const overrides of [
    { LIVEKIT_URL: 'ws://rtc.example.test' },
    { LIVEKIT_URL: 'wss://localhost:7880' },
    { LIVEKIT_RECORDING_S3_ENDPOINT: 'http://storage.example.test' },
    { LIVEKIT_RECORDING_S3_PLAYBACK_ENDPOINT: 'https://localhost:9000' },
  ]) {
    const result = loadConfig(overrides);
    assert.notEqual(result.status, 0);
  }
});
