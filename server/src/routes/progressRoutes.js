import { Router } from 'express';
import * as c from '../controllers/progressController.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/role.js';
import { requireActiveProgramEnrollment } from '../middleware/programEnrollment.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const r = Router();
r.use(authenticate);
r.use(requireRole('STUDENT'));
r.use(requireActiveProgramEnrollment);
r.get('/me', asyncHandler(c.myProgress));
r.post('/access', asyncHandler(c.recordLessonAccess));
r.post('/complete', asyncHandler(c.markComplete));
export default r;
