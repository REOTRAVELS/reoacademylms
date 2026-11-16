import { Router } from 'express';
import * as c from '../controllers/programmesController.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/role.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const r = Router();
r.use(authenticate);
r.get('/', asyncHandler(c.listProgrammes));
r.get('/:id', asyncHandler(c.getProgramme));
r.post('/', requireRole('SUPER_ADMIN'), asyncHandler(c.createProgramme));
r.put('/:id', requireRole('SUPER_ADMIN'), asyncHandler(c.updateProgramme));
r.delete('/:id', requireRole('SUPER_ADMIN'), asyncHandler(c.deleteProgramme));
export default r;
