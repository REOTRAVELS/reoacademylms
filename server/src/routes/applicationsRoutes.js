import { Router } from 'express';
import * as c from '../controllers/applicationsController.js';
import { authenticate, authenticateApplicant } from '../middleware/auth.js';
import { requireRole } from '../middleware/role.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  approveApplicationSchema,
  rejectApplicationSchema,
  submitApplicationSchema,
} from '../validators/applications.js';

const r = Router();

r.get('/offerings', asyncHandler(c.getOpenOfferings));
r.get('/me', authenticateApplicant, asyncHandler(c.getMyApplication));
r.post('/', authenticateApplicant, validate(submitApplicationSchema), asyncHandler(c.submitApplication));

r.get('/admin', authenticate, requireRole('SUPER_ADMIN'), asyncHandler(c.listApplications));
r.get('/admin/:id', authenticate, requireRole('SUPER_ADMIN'), asyncHandler(c.getApplication));
r.post(
  '/admin/:id/approve',
  authenticate,
  requireRole('SUPER_ADMIN'),
  validate(approveApplicationSchema),
  asyncHandler(c.approveApplication),
);
r.post(
  '/admin/:id/reject',
  authenticate,
  requireRole('SUPER_ADMIN'),
  validate(rejectApplicationSchema),
  asyncHandler(c.rejectApplication),
);

export default r;
