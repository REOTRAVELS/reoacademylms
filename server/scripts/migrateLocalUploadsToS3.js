import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import prisma from '../src/config/database.js';
import { env } from '../src/config/env.js';
import { getObjectStorage, isObjectStorageEnabled } from '../src/services/objectStorage.js';

const serverDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const uploadDirectory = path.resolve(serverDirectory, env.uploadDir);
const confirmed = process.env.CONFIRM_OBJECT_STORAGE_MIGRATION === 'YES';

const safeLocalPath = (storedPath) => {
  const resolvedPath = path.isAbsolute(storedPath)
    ? path.resolve(storedPath)
    : path.resolve(serverDirectory, storedPath);
  const relativePath = path.relative(uploadDirectory, resolvedPath);
  if (
    !relativePath
    || relativePath === '..'
    || relativePath.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativePath)
  ) return null;
  return resolvedPath;
};

const safeKeySegment = (value) => String(value).replace(/[^A-Za-z0-9_-]/g, '_');

const buildMigrationPlan = async () => {
  const plan = [];
  const missing = [];

  const resources = await prisma.resource.findMany({
    where: { NOT: { storagePath: { startsWith: 'course-resources/' } } },
    select: { id: true, storagePath: true, uploadedById: true, fileName: true, mimeType: true },
  });
  for (const resource of resources) {
    const filePath = safeLocalPath(resource.storagePath);
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      missing.push(`resource:${resource.id}`);
      continue;
    }
    const extension = path.extname(resource.fileName || filePath).toLowerCase();
    plan.push({
      type: 'resource',
      id: resource.id,
      filePath,
      key: `course-resources/${resource.uploadedById}/migrated-${safeKeySegment(resource.id)}${extension}`,
      contentType: resource.mimeType,
    });
  }

  const users = await prisma.user.findMany({
    where: {
      avatarUrl: { not: null },
      NOT: { avatarUrl: { startsWith: 'avatars/' } },
    },
    select: { id: true, avatarUrl: true },
  });
  for (const user of users) {
    if (path.basename(user.avatarUrl) !== user.avatarUrl) {
      missing.push(`avatar:${user.id}`);
      continue;
    }
    const filePath = safeLocalPath(path.join(uploadDirectory, user.avatarUrl));
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      missing.push(`avatar:${user.id}`);
      continue;
    }
    const extension = path.extname(user.avatarUrl).toLowerCase();
    const contentType = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
    }[extension];
    if (!contentType) {
      missing.push(`avatar:${user.id}`);
      continue;
    }
    plan.push({
      type: 'avatar',
      id: user.id,
      filePath,
      key: `avatars/${user.id}/migrated-${safeKeySegment(user.id)}${extension}`,
      contentType,
    });
  }

  const certificates = await prisma.certificate.findMany({
    where: { fileUrl: { not: null } },
    select: { id: true, studentId: true, fileUrl: true },
  });
  for (const certificate of certificates) {
    const fileName = path.posix.basename(certificate.fileUrl);
    if (!/^certificate-[A-Za-z0-9_-]+-\d+\.pdf$/.test(fileName)) continue;
    const filePath = safeLocalPath(path.join(uploadDirectory, fileName));
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      missing.push(`certificate:${certificate.id}`);
      continue;
    }
    plan.push({
      type: 'certificate',
      id: certificate.id,
      filePath,
      key: `certificates/${certificate.studentId}/${fileName}`,
      contentType: 'application/pdf',
    });
  }

  return { plan, missing };
};

const applyMigration = async (item) => {
  const stat = await fs.promises.stat(item.filePath);
  await getObjectStorage().putObject({
    key: item.key,
    body: fs.createReadStream(item.filePath),
    contentType: item.contentType,
    contentLength: stat.size,
  });

  if (item.type === 'resource') {
    await prisma.resource.update({ where: { id: item.id }, data: { storagePath: item.key } });
  } else if (item.type === 'avatar') {
    await prisma.user.update({ where: { id: item.id }, data: { avatarUrl: item.key } });
  }
};

try {
  if (!isObjectStorageEnabled()) {
    throw new Error('Set FILE_STORAGE_PROVIDER=s3 and configure the destination bucket before migrating');
  }
  const { plan, missing } = await buildMigrationPlan();
  console.log(`Found ${plan.length} local files to migrate and ${missing.length} missing or unsafe paths.`);
  if (missing.length) {
    console.error(`Missing files: ${missing.join(', ')}`);
  }
  if (!confirmed) {
    console.log('Dry run only. Back up the database and uploads, then set CONFIRM_OBJECT_STORAGE_MIGRATION=YES to apply.');
  } else {
    for (const item of plan) await applyMigration(item);
    console.log(`Migrated ${plan.length} files. Local files were retained.`);
  }
  if (missing.length) process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
