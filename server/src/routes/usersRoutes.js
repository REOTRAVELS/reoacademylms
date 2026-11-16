import { Router } from 'express';
import * as c from '../controllers/usersController.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/role.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { uploadAvatarFile } from '../middleware/upload.js';
import { env } from '../config/env.js';

const r = Router();
r.use(authenticate);
const manageOwnAvatar = (req, res, next) => {
  if (req.params.id !== req.user.id && req.user.role.name !== 'SUPER_ADMIN') {
    return res.status(403).json({ success: false, message: 'Forbidden' });
  }
  return next();
};

r.get('/', requireRole('SUPER_ADMIN'), asyncHandler(c.listUsers));
r.get('/:id/avatar', asyncHandler(c.getAvatar));
r.post('/:id/avatar/upload-intent', manageOwnAvatar, asyncHandler(c.createAvatarUploadIntent));
r.post('/:id/avatar', manageOwnAvatar, (req, res, next) => {
  if (req.is('application/json')) {
    return asyncHandler(c.finalizeAvatarUpload)(req, res, next);
  }
  if (env.nodeEnv === 'production') {
    return res.status(503).json({ success: false, message: 'Use the secure object storage upload flow' });
  }
  return uploadAvatarFile(req, res, next);
}, asyncHandler(c.uploadAvatar));
r.post('/:id/password', asyncHandler(c.changePassword));
r.get('/:id', asyncHandler(c.getUser));
r.put('/:id', asyncHandler(c.updateUser));
r.delete('/:id', requireRole('SUPER_ADMIN'), asyncHandler(c.deleteUser));
export default r;
