import { Router } from 'express';
import * as c from '../controllers/authController.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/role.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  registerSchema,
  loginSchema,
  acceptInviteSchema,
  approveSchema,
  createInvitationSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from '../validators/auth.js';

const r = Router();
r.post('/register', validate(registerSchema), asyncHandler(c.register));
r.post('/login', validate(loginSchema), asyncHandler(c.login));
r.post('/logout', asyncHandler(c.logout));
r.get('/me', authenticate, asyncHandler(c.me));
r.post('/accept-invitation', validate(acceptInviteSchema), asyncHandler(c.acceptInvitation));
r.post('/forgot-password', validate(forgotPasswordSchema), asyncHandler(c.forgotPassword));
r.post('/reset-password', validate(resetPasswordSchema), asyncHandler(c.resetPassword));
r.post('/invitations', authenticate, requireRole('SUPER_ADMIN'), validate(createInvitationSchema), asyncHandler(c.createInvitation));
r.post('/users/approve', authenticate, requireRole('SUPER_ADMIN'), validate(approveSchema), asyncHandler(c.approveUser));
export default r;
