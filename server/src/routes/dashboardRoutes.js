import { Router } from 'express';
import * as c from '../controllers/dashboardController.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/role.js';
import { requireProgramDashboardAccess } from '../middleware/programEnrollment.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const r = Router();
r.use(authenticate);
r.get('/admin', requireRole('SUPER_ADMIN'), asyncHandler(c.adminDashboard));
r.get('/trainer', requireRole('TRAINER'), asyncHandler(c.trainerDashboard));
r.get('/student', requireRole('STUDENT'), requireProgramDashboardAccess, asyncHandler(c.studentDashboard));
export default r;
