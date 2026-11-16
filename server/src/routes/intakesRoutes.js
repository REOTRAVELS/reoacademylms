import { Router } from 'express';
import * as c from '../controllers/intakesController.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/role.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const r = Router();
r.use(authenticate, requireRole('SUPER_ADMIN'));
r.get('/', asyncHandler(c.listIntakes));
r.post('/', asyncHandler(c.createIntake));
r.get('/:id', asyncHandler(c.getIntake));
r.put('/:id', asyncHandler(c.updateIntake));
r.post('/:id/offerings', asyncHandler(c.addIntakeOfferings));
r.patch('/:id/offerings/:offeringId', asyncHandler(c.updateIntakeOffering));
r.delete('/:id/offerings/:offeringId', asyncHandler(c.removeIntakeOffering));
export default r;
