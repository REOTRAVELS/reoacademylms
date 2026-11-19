import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import prisma from '../config/database.js';
import { ok, fail } from '../utils/response.js';
import { audit } from '../utils/audit.js';
import { getObjectStorage, isObjectStorageEnabled } from '../services/objectStorage.js';
import { hasAllowedUploadType, resourceFileMatchesType } from '../utils/uploadValidation.js';

const timetableFileTypes = new Map([
  ['.pdf', ['application/pdf']],
  ['.doc', ['application/msword']],
  ['.docx', ['application/vnd.openxmlformats-officedocument.wordprocessingml.document']],
  ['.ppt', ['application/vnd.ms-powerpoint']],
  ['.pptx', ['application/vnd.openxmlformats-officedocument.presentationml.presentation']],
  ['.xls', ['application/vnd.ms-excel']],
  ['.xlsx', ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']],
  ['.csv', ['text/csv', 'application/vnd.ms-excel']],
]);

const maxTimetableFileSizeBytes = 1024 * 1024 * 1024;

const timetableUploadDetails = (body = {}) => {
  const originalName = path.posix.basename(String(body.originalName || '').replace(/\\/g, '/')).trim();
  const mimeType = body.mimeType;
  const sizeBytes = Number(body.sizeBytes);
  if (
    !originalName
    || originalName.length > 255
    || /[\u0000-\u001f\u007f]/.test(originalName)
    || typeof mimeType !== 'string'
    || !hasAllowedUploadType(timetableFileTypes, originalName, mimeType)
  ) return { error: 'Choose a PDF, Word, PowerPoint, or Excel timetable file', status: 400 };
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > maxTimetableFileSizeBytes) {
    return { error: 'Timetable files must be no larger than 1 GB', status: 413 };
  }
  return { originalName, mimeType, sizeBytes };
};

const readTimetableFileHeader = (filePath) => {
  const descriptor = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(16);
    const bytesRead = fs.readSync(descriptor, header, 0, header.length, 0);
    return header.subarray(0, bytesRead);
  } finally {
    fs.closeSync(descriptor);
  }
};

export const cleanupOfferingTimetableFile = async (storagePath) => {
  if (!storagePath) return;
  if (storagePath.startsWith('program-offering-timetables/')) {
    if (isObjectStorageEnabled()) await getObjectStorage().deleteObject(storagePath);
  } else if (fs.existsSync(storagePath)) {
    fs.unlinkSync(storagePath);
  }
};

const replaceOfferingTimetable = async (intakeId, offeringId, file) => {
  const previous = await prisma.intakeProgramOffering.findFirst({
    where: { id: offeringId, intakeId },
    select: { id: true, timetableStoragePath: true },
  });
  if (!previous) return null;
  const updated = await prisma.intakeProgramOffering.update({
    where: { id: previous.id },
    data: {
      timetableFileName: file.originalName,
      timetableMimeType: file.mimeType,
      timetableStoragePath: file.storagePath,
      timetableSizeBytes: file.sizeBytes,
    },
    select: {
      id: true,
      timetableFileName: true,
      timetableMimeType: true,
      timetableSizeBytes: true,
    },
  });
  if (previous.timetableStoragePath && previous.timetableStoragePath !== file.storagePath) {
    try {
      await cleanupOfferingTimetableFile(previous.timetableStoragePath);
    } catch (error) {
      console.error('Could not remove the replaced program offering timetable file', error);
    }
  }
  return updated;
};

const auditOfferingTimetableUpload = (req, intakeId, offeringId) => audit({
  actorId: req.user.id,
  action: 'UPLOAD_PROGRAM_OFFERING_TIMETABLE',
  entity: 'IntakeProgramOffering',
  entityId: offeringId,
  metadata: { intakeId },
  ipAddress: req.ip,
});

export const createOfferingTimetableUploadIntent = async (req, res) => {
  const details = timetableUploadDetails(req.body);
  if (details.error) return fail(res, details.error, details.status);
  const offering = await prisma.intakeProgramOffering.findFirst({
    where: { id: req.params.offeringId, intakeId: req.params.id },
    select: { id: true },
  });
  if (!offering) return fail(res, 'Program offering not found', 404);
  if (!isObjectStorageEnabled()) return ok(res, { mode: 'local' });

  const extension = path.extname(details.originalName).toLowerCase();
  const storageKey = `program-offering-timetables/${req.user.id}/${randomUUID()}${extension}`;
  const intent = await getObjectStorage().createUploadIntent({
    key: storageKey,
    contentType: details.mimeType,
    ownerId: req.user.id,
    sizeBytes: details.sizeBytes,
  });
  return ok(res, { mode: 's3', storageKey, ...intent });
};

const uploadOfferingTimetableToObjectStorage = async (req, res) => {
  const file = req.file;
  if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length !== file.size) {
    return fail(res, 'No timetable file uploaded', 400);
  }
  const details = timetableUploadDetails({
    originalName: file.originalname,
    mimeType: file.mimetype,
    sizeBytes: file.size,
  });
  if (details.error) return fail(res, details.error, details.status);
  if (!resourceFileMatchesType(file.buffer.subarray(0, 16), details.originalName, details.mimeType)) {
    return fail(res, 'Choose a supported timetable file with matching file contents', 400);
  }

  const offering = await prisma.intakeProgramOffering.findFirst({
    where: { id: req.params.offeringId, intakeId: req.params.id },
    select: { id: true },
  });
  if (!offering) return fail(res, 'Program offering not found', 404);

  const extension = path.extname(details.originalName).toLowerCase();
  const storageKey = `program-offering-timetables/${req.user.id}/${randomUUID()}${extension}`;
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

  let timetable;
  try {
    timetable = await replaceOfferingTimetable(req.params.id, req.params.offeringId, {
      ...details,
      storagePath: storageKey,
    });
  } catch (error) {
    try {
      await storage.deleteObject(storageKey);
    } catch (cleanupError) {
      console.error('Could not remove unreferenced program offering timetable upload', cleanupError);
    }
    throw error;
  }
  if (!timetable) {
    await storage.deleteObject(storageKey);
    return fail(res, 'Program offering not found', 404);
  }
  await auditOfferingTimetableUpload(req, req.params.id, req.params.offeringId);
  return ok(res, timetable, 'Timetable uploaded', 201);
};

export const uploadOfferingTimetable = async (req, res) => {
  if (req.file?.buffer && isObjectStorageEnabled()) {
    return uploadOfferingTimetableToObjectStorage(req, res);
  }
  if (req.is('application/json')) {
    if (!isObjectStorageEnabled()) return fail(res, 'Object storage uploads are unavailable', 503);
    const details = timetableUploadDetails(req.body);
    if (details.error) return fail(res, details.error, details.status);

    const { storageKey } = req.body;
    if (typeof storageKey !== 'string') return fail(res, 'Upload key is invalid', 400);
    const keyParts = storageKey.split('/');
    const extension = path.extname(details.originalName).toLowerCase();
    if (
      keyParts.length !== 3
      || keyParts[0] !== 'program-offering-timetables'
      || keyParts[1] !== req.user.id
      || path.extname(keyParts[2]).toLowerCase() !== extension
      || !/^[0-9a-f-]{36}\.[a-z0-9]+$/i.test(keyParts[2])
    ) return fail(res, 'Upload key is invalid', 400);

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
    let timetable;
    try {
      timetable = await replaceOfferingTimetable(req.params.id, req.params.offeringId, {
        ...details,
        storagePath: storageKey,
      });
    } catch (error) {
      try {
        await storage.deleteObject(storageKey);
      } catch (cleanupError) {
        console.error('Could not remove unreferenced program offering timetable upload', cleanupError);
      }
      throw error;
    }
    if (!timetable) {
      await storage.deleteObject(storageKey);
      return fail(res, 'Program offering not found', 404);
    }
    await auditOfferingTimetableUpload(req, req.params.id, req.params.offeringId);
    return ok(res, timetable, 'Timetable uploaded', 201);
  }

  if (!req.file) return fail(res, 'No timetable file uploaded', 400);
  const details = {
    originalName: path.posix.basename(req.file.originalname.replace(/\\/g, '/')).trim(),
    mimeType: req.file.mimetype,
    sizeBytes: req.file.size,
  };
  if (
    !hasAllowedUploadType(timetableFileTypes, details.originalName, details.mimeType)
    || !resourceFileMatchesType(readTimetableFileHeader(req.file.path), details.originalName, details.mimeType)
  ) {
    fs.unlinkSync(req.file.path);
    return fail(res, 'Choose a supported timetable file with matching file contents', 400);
  }
  let timetable;
  try {
    timetable = await replaceOfferingTimetable(req.params.id, req.params.offeringId, {
      ...details,
      storagePath: req.file.path,
    });
  } catch (error) {
    try {
      fs.unlinkSync(req.file.path);
    } catch (cleanupError) {
      console.error('Could not remove unreferenced program offering timetable upload', cleanupError);
    }
    throw error;
  }
  if (!timetable) {
    fs.unlinkSync(req.file.path);
    return fail(res, 'Program offering not found', 404);
  }
  await auditOfferingTimetableUpload(req, req.params.id, req.params.offeringId);
  return ok(res, timetable, 'Timetable uploaded', 201);
};

const canAccessOfferingTimetable = async (offeringId, user) => {
  if (user.role.name === 'SUPER_ADMIN') return true;
  if (user.role.name === 'TRAINER') {
    const cohort = await prisma.cohort.findFirst({
      where: {
        intakeProgramOfferingId: offeringId,
        OR: [
          { trainers: { some: { trainerId: user.id } } },
          {
            courses: {
              some: {
                course: {
                  trainers: { some: { trainerId: user.id } },
                },
              },
            },
          },
        ],
      },
      select: { id: true },
    });
    return Boolean(cohort);
  }
  if (user.role.name !== 'STUDENT') return false;
  const now = new Date();
  const enrollment = await prisma.programEnrollment.findFirst({
    where: {
      programOfferingId: offeringId,
      studentId: user.id,
      status: 'ACTIVE',
      effectiveAt: { lte: now },
      student: {
        is: {
          status: 'ACTIVE',
          role: { is: { name: 'STUDENT' } },
        },
      },
      AND: [
        { OR: [{ endedAt: null }, { endedAt: { gt: now } }] },
        { OR: [{ applicationId: null }, { application: { is: { status: 'APPROVED' } } }] },
      ],
    },
    select: { id: true },
  });
  return Boolean(enrollment);
};

export const downloadOfferingTimetable = async (req, res) => {
  const offering = await prisma.intakeProgramOffering.findFirst({
    where: { id: req.params.offeringId, intakeId: req.params.id },
    select: {
      id: true,
      timetableFileName: true,
      timetableMimeType: true,
      timetableStoragePath: true,
    },
  });
  if (
    !offering?.timetableStoragePath
    || !(await canAccessOfferingTimetable(offering.id, req.user))
  ) return fail(res, 'Timetable not found', 404);

  if (offering.timetableStoragePath.startsWith('program-offering-timetables/')) {
    const url = await getObjectStorage().createDownloadUrl({
      key: offering.timetableStoragePath,
      fileName: offering.timetableFileName,
      contentType: offering.timetableMimeType,
    });
    return res.redirect(302, url);
  }
  const filePath = path.resolve(offering.timetableStoragePath);
  if (!fs.existsSync(filePath)) return fail(res, 'Timetable file missing', 404);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', offering.timetableMimeType);
  return res.download(filePath, path.basename(offering.timetableFileName));
};
