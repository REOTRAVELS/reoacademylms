import { Router } from 'express';
import { uploadResourceFile } from '../middleware/upload.js';
import * as c from '../controllers/resourcesController.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/role.js';
import { requireActiveProgramEnrollment } from '../middleware/programEnrollment.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { env } from '../config/env.js';

const r = Router();
r.use(authenticate);
r.use(requireActiveProgramEnrollment);
r.get('/', asyncHandler(c.listResources));
r.post(
  '/upload-intent',
  requireRole('SUPER_ADMIN', 'TRAINER'),
  asyncHandler(c.createResourceUploadIntent),
);
r.post('/', requireRole('SUPER_ADMIN', 'TRAINER'), (req, res, next) => {
  if (req.is('application/json')) {
    return asyncHandler(c.finalizeResourceUpload)(req, res, next);
  }
  if (env.nodeEnv === 'production') {
    return res.status(503).json({ success: false, message: 'Use the secure object storage upload flow' });
  }
  return uploadResourceFile(req, res, next);
}, asyncHandler(c.uploadResource));
r.get('/:id/download', asyncHandler(c.downloadResource));
r.put('/:id', requireRole('SUPER_ADMIN', 'TRAINER'), asyncHandler(c.updateResource));
r.delete('/:id', asyncHandler(c.deleteResource));
export default r;
