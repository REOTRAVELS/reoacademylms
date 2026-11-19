import { Router } from 'express';
import * as c from '../controllers/cohortsController.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/role.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { uploadResourceFile } from '../middleware/upload.js';
import { env } from '../config/env.js';

const r = Router();
r.use(authenticate);
r.get('/', requireRole('SUPER_ADMIN', 'TRAINER'), asyncHandler(c.listCohorts));
r.get('/:id', requireRole('SUPER_ADMIN', 'TRAINER'), asyncHandler(c.getCohort));
r.get('/:id/timetable', asyncHandler(c.downloadCohortTimetable));
r.use(requireRole('SUPER_ADMIN'));
r.post('/', asyncHandler(c.createCohort));
r.put('/:id', asyncHandler(c.updateCohort));
r.post('/:id/timetable/upload-intent', asyncHandler(c.createCohortTimetableUploadIntent));
r.post('/:id/timetable', (req, res, next) => {
  if (req.is('application/json')) {
    return asyncHandler(c.uploadCohortTimetable)(req, res, next);
  }
  if (env.nodeEnv === 'production') {
    return res.status(503).json({ success: false, message: 'Use the secure object storage upload flow' });
  }
  return uploadResourceFile(req, res, next);
}, asyncHandler(c.uploadCohortTimetable));
r.delete('/:id', asyncHandler(c.deleteCohort));
r.post('/:id/enrol', asyncHandler(c.enrolStudent));
r.delete('/:id/enrolments/:enrolmentId', asyncHandler(c.removeEnrolment));
r.post('/:id/trainers', asyncHandler(c.assignTrainer));
r.delete('/:id/trainers/:assignmentId', asyncHandler(c.removeTrainer));
r.post('/:id/courses', asyncHandler(c.assignCourse));
r.delete('/:id/courses/:assignmentId', asyncHandler(c.removeCourse));
export default r;
