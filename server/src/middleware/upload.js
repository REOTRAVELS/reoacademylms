import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { env } from '../config/env.js';
import { avatarTypes, resourceTypes } from '../utils/uploadValidation.js';

const dir = env.uploadDir;
if (env.fileStorageProvider === 'local' && !fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, dir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

const createUploadMiddleware = (instance) => (req, res, next) => {
  instance.single('file')(req, res, (error) => {
    if (!error) return next();
    error.status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return next(error);
  });
};

const createUploader = (allowedTypes, maxFileSize, uploadStorage = storage) => multer({
  storage: uploadStorage,
  limits: { fileSize: maxFileSize },
  fileFilter: (req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.get(extension)?.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Unsupported file type'));
  },
});

export const uploadResourceFile = createUploadMiddleware(
  createUploader(resourceTypes, env.maxFileSizeMb * 1024 * 1024),
);

// Keep proxied files below Vercel's request-body limit; larger files use signed storage uploads.
export const uploadObjectStorageProxyFile = createUploadMiddleware(
  createUploader(resourceTypes, 4 * 1024 * 1024, multer.memoryStorage()),
);

export const uploadAvatarFile = createUploadMiddleware(
  createUploader(avatarTypes, 5 * 1024 * 1024),
);

export const uploadAvatarMemoryFile = createUploadMiddleware(
  createUploader(avatarTypes, 5 * 1024 * 1024, multer.memoryStorage()),
);
