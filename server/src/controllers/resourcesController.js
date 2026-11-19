import prisma from '../config/database.js';
import { ok, fail } from '../utils/response.js';
import { audit } from '../utils/audit.js';
import { env } from '../config/env.js';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'node:crypto';
import { canAccessCourse, canManageCourse, studentCourseAccessWhere } from '../utils/courseAccess.js';
import { hasAllowedUploadType, resourceFileMatchesType, resourceTypes } from '../utils/uploadValidation.js';
import { getObjectStorage, isObjectStorageEnabled } from '../services/objectStorage.js';

const readFileHeader = (filePath) => {
  const descriptor = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(16);
    const bytesRead = fs.readSync(descriptor, header, 0, header.length, 0);
    return header.subarray(0, bytesRead);
  } finally {
    fs.closeSync(descriptor);
  }
};

const safeOriginalName = (value) => (
  path.posix.basename(String(value || '').replace(/\\/g, '/')).trim()
);

const uploadDetails = (body = {}) => {
  const originalName = safeOriginalName(body.originalName);
  const mimeType = body.mimeType;
  const sizeBytes = Number(body.sizeBytes);
  if (
    !originalName
    || originalName.length > 255
    || /[\u0000-\u001f\u007f]/.test(originalName)
    || typeof mimeType !== 'string'
    || !hasAllowedUploadType(resourceTypes, originalName, mimeType)
  ) return { error: 'Choose a supported learning material file', status: 400 };
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > env.maxFileSizeMb * 1024 * 1024) {
    return { error: `File must be no larger than ${env.maxFileSizeMb} MB`, status: 413 };
  }
  return { originalName, mimeType, sizeBytes };
};

const resolveResourceCourse = async ({ courseId, lessonId }, user) => {
  if (!courseId && !lessonId) return { error: 'courseId or lessonId is required', status: 400 };
  let resolvedCourseId = courseId;
  if (lessonId) {
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      select: { module: { select: { courseId: true } } },
    });
    if (!lesson || (courseId && lesson.module.courseId !== courseId)) {
      return { error: 'Lesson does not belong to the selected course', status: 400 };
    }
    resolvedCourseId = lesson.module.courseId;
  }
  if (!(await canManageCourse(resolvedCourseId, user))) {
    return { error: 'You are not assigned to this course', status: 403 };
  }
  return { courseId: resolvedCourseId };
};

const resourceUploadKeyIsOwned = (key, userId) => {
  const parts = typeof key === 'string' ? key.split('/') : [];
  return parts.length === 3
    && parts[0] === 'course-resources'
    && parts[1] === userId
    && /^[0-9a-f-]{36}\.[a-z0-9]+$/i.test(parts[2]);
};

const createResourceRecord = async ({ courseId, lessonId, originalName, mimeType, sizeBytes, key, user }) => (
  prisma.resource.create({
    data: {
      courseId,
      lessonId: lessonId || null,
      fileName: key.startsWith('course-resources/')
        ? path.posix.basename(key)
        : path.basename(key),
      originalName,
      mimeType,
      sizeBytes,
      storagePath: key,
      uploadedById: user.id,
    },
    select: {
      id: true,
      courseId: true,
      lessonId: true,
      originalName: true,
      mimeType: true,
      sizeBytes: true,
      createdAt: true,
    },
  })
);

export const createResourceUploadIntent = async (req, res) => {
  const details = uploadDetails(req.body);
  if (details.error) return fail(res, details.error, details.status);
  const course = await resolveResourceCourse(req.body, req.user);
  if (course.error) return fail(res, course.error, course.status);
  if (!isObjectStorageEnabled()) return ok(res, { mode: 'local' });

  const extension = path.extname(details.originalName).toLowerCase();
  const storageKey = `course-resources/${req.user.id}/${randomUUID()}${extension}`;
  const intent = await getObjectStorage().createUploadIntent({
    key: storageKey,
    contentType: details.mimeType,
    ownerId: req.user.id,
    sizeBytes: details.sizeBytes,
  });
  return ok(res, { mode: 's3', storageKey, ...intent });
};

export const finalizeResourceUpload = async (req, res) => {
  if (!isObjectStorageEnabled()) return fail(res, 'Object storage uploads are unavailable', 503);
  const details = uploadDetails(req.body);
  if (details.error) return fail(res, details.error, details.status);
  const course = await resolveResourceCourse(req.body, req.user);
  if (course.error) return fail(res, course.error, course.status);
  const { storageKey } = req.body;
  if (!resourceUploadKeyIsOwned(storageKey, req.user.id)) {
    return fail(res, 'Upload key is invalid', 400);
  }

  const storage = getObjectStorage();
  let header;
  try {
    header = await storage.verifyUpload({
      key: storageKey,
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
  if (!header || !resourceFileMatchesType(header, details.originalName, details.mimeType)) {
    await storage.deleteObject(storageKey);
    return fail(res, 'Uploaded file content does not match its file type', 400);
  }

  let resource;
  try {
    resource = await createResourceRecord({
      ...details,
      courseId: course.courseId,
      lessonId: req.body.lessonId || null,
      key: storageKey,
      user: req.user,
    });
  } catch (error) {
    try {
      await storage.deleteObject(storageKey);
    } catch (cleanupError) {
      console.error('Could not remove unreferenced course upload', cleanupError);
    }
    throw error;
  }
  await audit({
    actorId: req.user.id,
    action: 'UPLOAD_RESOURCE',
    entity: 'Resource',
    entityId: resource.id,
    ipAddress: req.ip,
  });
  return ok(res, resource, 'Uploaded', 201);
};

export const uploadResourceToObjectStorage = async (req, res) => {
  const file = req.file;
  if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length !== file.size) {
    return fail(res, 'No file uploaded', 400);
  }
  const details = uploadDetails({
    originalName: file.originalname,
    mimeType: file.mimetype,
    sizeBytes: file.size,
  });
  if (details.error) return fail(res, details.error, details.status);
  if (!resourceFileMatchesType(file.buffer.subarray(0, 16), details.originalName, details.mimeType)) {
    return fail(res, 'The uploaded file content does not match its file type', 400);
  }

  const course = await resolveResourceCourse(req.body || {}, req.user);
  if (course.error) return fail(res, course.error, course.status);

  const extension = path.extname(details.originalName).toLowerCase();
  const storageKey = `course-resources/${req.user.id}/${randomUUID()}${extension}`;
  const storage = getObjectStorage();
  await storage.putObject({
    key: storageKey,
    body: file.buffer,
    contentType: details.mimeType,
    contentLength: details.sizeBytes,
    metadata: {
      'owner-id': req.user.id,
      'expected-size': String(details.sizeBytes),
    },
  });

  let resource;
  try {
    resource = await createResourceRecord({
      ...details,
      courseId: course.courseId,
      lessonId: req.body?.lessonId || null,
      key: storageKey,
      user: req.user,
    });
  } catch (error) {
    try {
      await storage.deleteObject(storageKey);
    } catch (cleanupError) {
      console.error('Could not remove unreferenced course upload', cleanupError);
    }
    throw error;
  }

  await audit({
    actorId: req.user.id,
    action: 'UPLOAD_RESOURCE',
    entity: 'Resource',
    entityId: resource.id,
    ipAddress: req.ip,
  });
  return ok(res, resource, 'Uploaded', 201);
};

export const uploadResource = async (req, res) => {
  if (!req.file) return fail(res, 'No file uploaded', 400);
  if (!resourceFileMatchesType(readFileHeader(req.file.path), req.file.originalname, req.file.mimetype)) {
    fs.unlinkSync(req.file.path);
    return fail(res, 'The uploaded file content does not match its file type', 400);
  }
  const { courseId, lessonId } = req.body || {};
  const course = await resolveResourceCourse({ courseId, lessonId }, req.user);
  if (course.error) {
    fs.unlinkSync(req.file.path);
    return fail(res, course.error, course.status);
  }
  let r;
  try {
    r = await createResourceRecord({
      courseId: course.courseId,
      lessonId,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      key: req.file.path,
      user: req.user,
    });
  } catch (error) {
    fs.unlinkSync(req.file.path);
    throw error;
  }
  await audit({ actorId: req.user.id, action: 'UPLOAD_RESOURCE', entity: 'Resource', entityId: r.id, ipAddress: req.ip });
  return ok(res, r, 'Uploaded', 201);
};

export const listResources = async (req, res) => {
  const where = {};
  if (req.query.courseId) where.courseId = req.query.courseId;
  if (req.query.lessonId) where.lessonId = req.query.lessonId;
  if (req.user.role.name === 'TRAINER') {
    where.OR = [
      { course: { trainers: { some: { trainerId: req.user.id } } } },
      { lesson: { module: { course: { trainers: { some: { trainerId: req.user.id } } } } } },
    ];
  } else if (req.user.role.name === 'STUDENT') {
    const courseAccess = studentCourseAccessWhere(req.user.id);
    where.OR = [
      { course: courseAccess },
      { lesson: { isPublished: true, module: { course: courseAccess } } },
    ];
  }
  const items = await prisma.resource.findMany({
    where,
    select: { id: true, courseId: true, lessonId: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return ok(res, items);
};

export const downloadResource = async (req, res) => {
  const r = await prisma.resource.findUnique({
    where: { id: req.params.id },
    include: {
      course: { select: { id: true, status: true } },
      lesson: { include: { module: { select: { courseId: true, course: { select: { id: true, status: true } } } } } },
    },
  });
  if (!r) return fail(res, 'Not found', 404);
  const courseId = r.courseId || r.lesson?.module.courseId;
  if (!courseId || !(await canAccessCourse(courseId, req.user))) return fail(res, 'Not found', 404);
  if (req.user.role.name === 'STUDENT' && (
    r.course?.status !== 'PUBLISHED'
    || (r.lesson && (!r.lesson.isPublished || r.lesson.module.course.status !== 'PUBLISHED'))
  )) return fail(res, 'Not found', 404);
  if (r.storagePath.startsWith('course-resources/')) {
    const url = await getObjectStorage().createDownloadUrl({
      key: r.storagePath,
      fileName: r.originalName,
      contentType: r.mimeType,
    });
    return res.redirect(302, url);
  }
  const filePath = path.resolve(r.storagePath);
  if (!fs.existsSync(filePath)) return fail(res, 'File missing', 404);
  const { size } = fs.statSync(filePath);
  const range = req.headers.range;
  const safeName = path.basename(r.originalName).replace(/[\r\n"\\]/g, '_');
  res.setHeader('Content-Type', r.mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Accept-Ranges', 'bytes');

  if (!range) {
    res.setHeader('Content-Length', size);
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) {
    res.setHeader('Content-Range', `bytes */${size}`);
    return res.status(416).end();
  }
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[2] && match[1] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) {
    res.setHeader('Content-Range', `bytes */${size}`);
    return res.status(416).end();
  }

  const boundedEnd = Math.min(end, size - 1);
  res.status(206);
  res.setHeader('Content-Range', `bytes ${start}-${boundedEnd}/${size}`);
  res.setHeader('Content-Length', boundedEnd - start + 1);
  fs.createReadStream(filePath, { start, end: boundedEnd }).pipe(res);
};

export const updateResource = async (req, res) => {
  const resource = await prisma.resource.findUnique({
    where: { id: req.params.id },
    include: { lesson: { include: { module: { select: { courseId: true } } } } },
  });
  if (!resource) return fail(res, 'Not found', 404);
  const courseId = resource.courseId || resource.lesson?.module.courseId;
  if (!courseId || !(await canManageCourse(courseId, req.user))) {
    return fail(res, 'You are not assigned to this course', 403);
  }

  const { originalName } = req.body || {};
  const cleanedName = typeof originalName === 'string' ? originalName.trim() : '';
  if (!cleanedName || cleanedName.length > 255 || /[\u0000-\u001f\u007f]/.test(cleanedName)) {
    return fail(res, 'Resource name must be between 1 and 255 characters', 400);
  }

  const updated = await prisma.resource.update({
    where: { id: resource.id },
    data: { originalName: cleanedName },
    select: { id: true, courseId: true, lessonId: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true },
  });
  await audit({ actorId: req.user.id, action: 'UPDATE_RESOURCE', entity: 'Resource', entityId: updated.id, ipAddress: req.ip });
  return ok(res, updated, 'Updated');
};

export const deleteResource = async (req, res) => {
  const r = await prisma.resource.findUnique({
    where: { id: req.params.id },
    include: { lesson: { include: { module: { select: { courseId: true } } } } },
  });
  if (!r) return fail(res, 'Not found', 404);
  const courseId = r.courseId || r.lesson?.module.courseId;
  if (!courseId || !(await canManageCourse(courseId, req.user))) return fail(res, 'You are not assigned to this course', 403);
  await prisma.resource.delete({ where: { id: r.id } });
  if (r.storagePath.startsWith('course-resources/')) {
    await getObjectStorage().deleteObject(r.storagePath);
  } else if (fs.existsSync(r.storagePath)) {
    fs.unlinkSync(r.storagePath);
  }
  await audit({ actorId: req.user.id, action: 'DELETE_RESOURCE', entity: 'Resource', entityId: r.id, ipAddress: req.ip });
  return ok(res, null, 'Deleted');
};
