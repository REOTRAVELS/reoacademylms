import prisma from '../config/database.js';
import { ok, fail } from '../utils/response.js';
import { audit } from '../utils/audit.js';
import { revalidateLiveClassAccess } from '../services/liveClassRealtime.js';
import { verifyPassword, hashPassword } from '../utils/password.js';
import { env } from '../config/env.js';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { avatarFileMatchesType, avatarTypes, hasAllowedUploadType } from '../utils/uploadValidation.js';
import { getObjectStorage, isObjectStorageEnabled } from '../services/objectStorage.js';

const avatarUrlFor = (user) => (
  user.avatarUrl
    ? `/users/${user.id}/avatar?v=${encodeURIComponent(user.avatarUrl)}`
    : null
);

export const listUsers = async (req, res) => {
  const role = req.query.role;
  const status = req.query.status;
  const search = req.query.search;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(50, Number(req.query.pageSize) || 20);
  const where = { deletedAt: null };
  if (role) where.role = { name: role };
  if (status) where.status = status;
  if (search) {
    where.OR = [
      { firstName: { contains: search, mode: 'insensitive' } },
      { lastName: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
  }
  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      include: { role: true },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return ok(res, {
    items: users.map((u) => ({
      id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email, phone: u.phone,
      role: u.role.name, status: u.status, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt,
    })),
    total, page, pageSize,
  });
};

export const getUser = async (req, res) => {
  if (req.params.id !== req.user.id && req.user.role.name !== 'SUPER_ADMIN') {
    return fail(res, 'Forbidden', 403);
  }
  const user = await prisma.user.findUnique({ where: { id: req.params.id }, include: { role: true } });
  if (!user || user.deletedAt) return fail(res, 'User not found', 404);
  return ok(res, {
    id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email,
    phone: user.phone, role: user.role.name, status: user.status, bio: user.bio,
    avatarUrl: avatarUrlFor(user), createdAt: user.createdAt, lastLoginAt: user.lastLoginAt,
  });
};

export const updateUser = async (req, res) => {
  const isAdmin = req.user.role.name === 'SUPER_ADMIN';
  if (req.params.id !== req.user.id && !isAdmin) return fail(res, 'Forbidden', 403);
  const { firstName, lastName, phone, bio, status } = req.body || {};
  const target = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: { deletedAt: true, role: { select: { name: true } } },
  });
  if (!target || target.deletedAt) return fail(res, 'User not found', 404);
  if (status !== undefined && !isAdmin) return fail(res, 'Only an administrator can change account status', 403);
  if (status !== undefined && target.role.name === 'STUDENT') {
    return fail(res, 'Student status must be managed through Program admissions or access controls', 409);
  }
  const data = {};
  if (firstName) data.firstName = firstName;
  if (lastName) data.lastName = lastName;
  if (phone !== undefined) data.phone = phone;
  if (bio !== undefined) data.bio = bio;
  if (status) data.status = status;
  const updated = await prisma.user.update({ where: { id: req.params.id }, data, include: { role: true } });
  await audit({ actorId: req.user.id, action: 'UPDATE_USER', entity: 'User', entityId: updated.id, ipAddress: req.ip });
  if (status !== undefined && updated.status !== 'ACTIVE') await revalidateLiveClassAccess();
  return ok(res, { id: updated.id, status: updated.status, avatarUrl: avatarUrlFor(updated) }, 'Updated');
};

export const uploadAvatar = async (req, res) => {
  if (!req.file) return fail(res, 'Choose a PNG, JPEG, or WebP profile picture', 400);
  const image = fs.readFileSync(req.file.path);
  if (!avatarFileMatchesType(image, req.file.mimetype)) {
    fs.unlinkSync(req.file.path);
    return fail(res, 'The uploaded file is not a valid PNG, JPEG, or WebP image', 400);
  }

  const existing = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: { id: true, avatarUrl: true },
  });
  if (!existing) {
    fs.unlinkSync(req.file.path);
    return fail(res, 'User not found', 404);
  }
  const previousAvatarUrl = existing.avatarUrl;

  let updated;
  try {
    updated = await prisma.user.update({
      where: { id: existing.id },
      data: { avatarUrl: req.file.filename },
      include: { role: true },
    });
  } catch (error) {
    fs.unlinkSync(req.file.path);
    throw error;
  }

  if (previousAvatarUrl && path.basename(previousAvatarUrl) === previousAvatarUrl) {
    const oldFile = path.join(env.uploadDir, previousAvatarUrl);
    if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
  }
  await audit({ actorId: req.user.id, action: 'UPDATE_PROFILE_PICTURE', entity: 'User', entityId: updated.id, ipAddress: req.ip });
  return ok(res, { avatarUrl: avatarUrlFor(updated) }, 'Profile picture updated');
};

export const uploadAvatarToObjectStorage = async (req, res) => {
  const file = req.file;
  if (
    !file
    || !Buffer.isBuffer(file.buffer)
    || !hasAllowedUploadType(avatarTypes, file.originalname, file.mimetype)
    || !avatarFileMatchesType(file.buffer, file.mimetype)
  ) return fail(res, 'The uploaded file is not a valid PNG, JPEG, or WebP image', 400);
  if (!file.buffer.length || file.buffer.length > 5 * 1024 * 1024) {
    return fail(res, 'Profile pictures must be no larger than 5 MB', 413);
  }

  const target = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: { id: true, avatarUrl: true },
  });
  if (!target) return fail(res, 'User not found', 404);

  const extension = path.extname(file.originalname).toLowerCase();
  const storageKey = `avatars/${target.id}/${randomUUID()}${extension}`;
  const storage = getObjectStorage();
  await storage.putObject({
    key: storageKey,
    body: file.buffer,
    contentType: file.mimetype,
    contentLength: file.buffer.length,
    metadata: {
      'owner-id': req.user.id,
      'expected-size': String(file.buffer.length),
    },
  });

  let updated;
  try {
    updated = await prisma.user.update({
      where: { id: target.id },
      data: { avatarUrl: storageKey },
      include: { role: true },
    });
  } catch (error) {
    try {
      await storage.deleteObject(storageKey);
    } catch (cleanupError) {
      console.error('Could not remove unreferenced profile image', cleanupError);
    }
    throw error;
  }

  if (target.avatarUrl?.startsWith('avatars/')) {
    await storage.deleteObject(target.avatarUrl);
  }
  await audit({
    actorId: req.user.id,
    action: 'UPDATE_PROFILE_PICTURE',
    entity: 'User',
    entityId: updated.id,
    ipAddress: req.ip,
  });
  return ok(res, { avatarUrl: avatarUrlFor(updated) }, 'Profile picture updated');
};

const avatarUploadDetails = (body = {}) => {
  const originalName = path.posix.basename(String(body.originalName || '').replace(/\\/g, '/')).trim();
  const mimeType = body.mimeType;
  const sizeBytes = Number(body.sizeBytes);
  if (
    !originalName
    || originalName.length > 255
    || /[\u0000-\u001f\u007f]/.test(originalName)
    || typeof mimeType !== 'string'
    || !hasAllowedUploadType(avatarTypes, originalName, mimeType)
  ) return { error: 'Choose a PNG, JPEG, or WebP profile picture', status: 400 };
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > 5 * 1024 * 1024) {
    return { error: 'Profile pictures must be no larger than 5 MB', status: 413 };
  }
  return { originalName, mimeType, sizeBytes };
};

const avatarUploadKeyIsOwned = (key, userId) => {
  const parts = typeof key === 'string' ? key.split('/') : [];
  return parts.length === 3
    && parts[0] === 'avatars'
    && parts[1] === userId
    && /^[0-9a-f-]{36}\.(png|jpe?g|webp)$/i.test(parts[2]);
};

export const createAvatarUploadIntent = async (req, res) => {
  const details = avatarUploadDetails(req.body);
  if (details.error) return fail(res, details.error, details.status);
  const target = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: { id: true },
  });
  if (!target) return fail(res, 'User not found', 404);
  if (!isObjectStorageEnabled()) return ok(res, { mode: 'local' });

  const extension = path.extname(details.originalName).toLowerCase();
  const storageKey = `avatars/${target.id}/${randomUUID()}${extension}`;
  const intent = await getObjectStorage().createUploadIntent({
    key: storageKey,
    contentType: details.mimeType,
    ownerId: req.user.id,
    sizeBytes: details.sizeBytes,
  });
  return ok(res, { mode: 's3', storageKey, ...intent });
};

export const finalizeAvatarUpload = async (req, res) => {
  if (!isObjectStorageEnabled()) return fail(res, 'Object storage uploads are unavailable', 503);
  const details = avatarUploadDetails(req.body);
  if (details.error) return fail(res, details.error, details.status);
  if (!avatarUploadKeyIsOwned(req.body.storageKey, req.params.id)) {
    return fail(res, 'Upload key is invalid', 400);
  }
  const target = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: { id: true, avatarUrl: true },
  });
  if (!target) return fail(res, 'User not found', 404);

  const storage = getObjectStorage();
  let header;
  try {
    header = await storage.verifyUpload({
      key: req.body.storageKey,
      contentType: details.mimeType,
      ownerId: req.user.id,
      sizeBytes: details.sizeBytes,
    });
  } catch (error) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      return fail(res, 'Upload was not found or has expired', 400);
    }
    throw error;
  }
  if (!header || !avatarFileMatchesType(header, details.mimeType)) {
    await storage.deleteObject(req.body.storageKey);
    return fail(res, 'The uploaded file is not a valid PNG, JPEG, or WebP image', 400);
  }

  let updated;
  try {
    updated = await prisma.user.update({
      where: { id: target.id },
      data: { avatarUrl: req.body.storageKey },
      include: { role: true },
    });
  } catch (error) {
    try {
      await storage.deleteObject(req.body.storageKey);
    } catch (cleanupError) {
      console.error('Could not remove unreferenced profile image', cleanupError);
    }
    throw error;
  }
  if (target.avatarUrl?.startsWith('avatars/')) {
    await storage.deleteObject(target.avatarUrl);
  }
  await audit({
    actorId: req.user.id,
    action: 'UPDATE_PROFILE_PICTURE',
    entity: 'User',
    entityId: updated.id,
    ipAddress: req.ip,
  });
  return ok(res, { avatarUrl: avatarUrlFor(updated) }, 'Profile picture updated');
};

export const getAvatar = async (req, res) => {
  if (req.params.id !== req.user.id && req.user.role.name !== 'SUPER_ADMIN') {
    return fail(res, 'Forbidden', 403);
  }
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: { avatarUrl: true },
  });
  if (user?.avatarUrl?.startsWith('avatars/')) {
    const extension = path.extname(user.avatarUrl).toLowerCase();
    const contentType = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
    }[extension];
    if (!contentType) return fail(res, 'Not found', 404);
    const url = await getObjectStorage().createDownloadUrl({
      key: user.avatarUrl,
      fileName: path.basename(user.avatarUrl),
      contentType,
    });
    return res.redirect(302, url);
  }
  if (!user?.avatarUrl || path.basename(user.avatarUrl) !== user.avatarUrl) return fail(res, 'Not found', 404);
  const filePath = path.resolve(env.uploadDir, user.avatarUrl);
  if (!fs.existsSync(filePath)) return fail(res, 'Not found', 404);
  const extension = path.extname(user.avatarUrl).toLowerCase();
  const contentType = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
  }[extension];
  if (!contentType) return fail(res, 'Not found', 404);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', fs.statSync(filePath).size);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return fs.createReadStream(filePath).pipe(res);
};

export const changePassword = async (req, res) => {
  if (req.params.id !== req.user.id) return fail(res, 'Forbidden', 403);
  const { currentPassword, newPassword } = req.body || {};
  if (
    typeof currentPassword !== 'string'
    || !currentPassword
    || typeof newPassword !== 'string'
    || newPassword.length < 8
    || newPassword.length > 128
  ) return fail(res, 'Provide your current password and a new password between 8 and 128 characters', 400);
  if (!(await verifyPassword(currentPassword, req.user.passwordHash))) {
    return fail(res, 'Current password is incorrect', 400);
  }
  if (await verifyPassword(newPassword, req.user.passwordHash)) {
    return fail(res, 'Choose a password different from your current password', 400);
  }
  await prisma.user.update({
    where: { id: req.user.id },
    data: { passwordHash: await hashPassword(newPassword), resetToken: null, resetTokenExpiresAt: null },
  });
  await audit({ actorId: req.user.id, action: 'CHANGE_PASSWORD', entity: 'User', entityId: req.user.id, ipAddress: req.ip });
  return ok(res, null, 'Password changed');
};

export const deleteUser = async (req, res) => {
  if (req.params.id === req.user.id) {
    return fail(res, 'You cannot delete your own account', 400);
  }
  const target = await prisma.user.findUnique({
    where: { id: req.params.id },
    include: { role: true },
  });
  if (!target || target.deletedAt) return fail(res, 'User not found', 404);
  if (target.role.name === 'SUPER_ADMIN') {
    return fail(res, 'Administrator accounts cannot be deleted here', 403);
  }

  const deletedAt = new Date();
  const passwordHash = await hashPassword(randomUUID());
  await prisma.$transaction(async (tx) => {
    if (target.role.name === 'STUDENT') {
      const pendingApplications = await tx.programApplication.findMany({
        where: { studentId: target.id, status: 'PENDING' },
        select: { id: true },
      });
      if (pendingApplications.length) {
        const updateResult = await tx.programApplication.updateMany({
          where: { studentId: target.id, status: 'PENDING' },
          data: {
            status: 'REJECTED',
            rejectionReason: 'Applicant account removed by an administrator',
            reviewedAt: deletedAt,
            reviewedById: req.user.id,
          },
        });
        if (updateResult.count !== pendingApplications.length) {
          const error = new Error('A Program application changed during account removal. Please retry.');
          error.status = 409;
          throw error;
        }
        await tx.programApplicationStatusHistory.createMany({
          data: pendingApplications.map(({ id }) => ({
            applicationId: id,
            fromStatus: 'PENDING',
            toStatus: 'REJECTED',
            reason: 'Applicant account removed by an administrator',
            changedById: req.user.id,
          })),
        });
      }
    }
    await tx.user.update({
      where: { id: target.id },
      data: {
        firstName: 'Deleted',
        lastName: 'User',
        email: `deleted-${target.id}@deleted.invalid`,
        phone: null,
        bio: null,
        avatarUrl: null,
        passwordHash,
        resetToken: null,
        resetTokenExpiresAt: null,
        status: 'SUSPENDED',
        deletedAt,
      },
    });
  }, { isolationLevel: 'Serializable' });
  await audit({ actorId: req.user.id, action: 'DELETE_USER', entity: 'User', entityId: req.params.id, ipAddress: req.ip });
  await revalidateLiveClassAccess();
  return ok(res, null, 'Account removed. Academic history was retained.');
};
