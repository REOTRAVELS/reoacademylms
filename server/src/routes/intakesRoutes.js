import { Router } from 'express';
import * as c from '../controllers/intakesController.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/role.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import * as timetable from '../controllers/intakeOfferingTimetableController.js';
import { uploadResourceFile } from '../middleware/upload.js';
import { env } from '../config/env.js';

const r = Router();
r.use(authenticate);
r.get('/:id/offerings/:offeringId/timetable', asyncHandler(timetable.downloadOfferingTimetable));
r.use(requireRole('SUPER_ADMIN'));
r.get('/', asyncHandler(c.listIntakes));
r.post('/', asyncHandler(c.createIntake));
r.get('/:id', asyncHandler(c.getIntake));
r.put('/:id', asyncHandler(c.updateIntake));
r.post('/:id/offerings', asyncHandler(c.addIntakeOfferings));
r.patch('/:id/offerings/:offeringId', asyncHandler(c.updateIntakeOffering));
r.post('/:id/offerings/:offeringId/timetable/upload-intent', asyncHandler(timetable.createOfferingTimetableUploadIntent));
r.post('/:id/offerings/:offeringId/timetable', (req, res, next) => {
  if (req.is('application/json')) {
    return asyncHandler(timetable.uploadOfferingTimetable)(req, res, next);
  }
  if (env.nodeEnv === 'production') {
    return res.status(503).json({ success: false, message: 'Use the secure object storage upload flow' });
  }
  return uploadResourceFile(req, res, next);
}, asyncHandler(timetable.uploadOfferingTimetable));
r.delete('/:id/offerings/:offeringId', asyncHandler(c.removeIntakeOffering));
export default r;
