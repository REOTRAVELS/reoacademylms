import { Router } from 'express';
import * as c from '../controllers/programEnrollmentsController.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/role.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const r = Router();
r.use(authenticate, requireRole('SUPER_ADMIN'));
r.get('/legacy-students', asyncHandler(c.listLegacyStudents));
r.get('/offerings', asyncHandler(c.listAssignableOfferings));
r.get('/assignment-history', asyncHandler(c.listAssignmentHistory));
r.post('/legacy-students/:studentId/assign', asyncHandler(c.assignLegacyStudent));

export default r;
