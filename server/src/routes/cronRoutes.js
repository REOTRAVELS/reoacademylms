import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { env } from '../config/env.js';
import { ensureGeneratedOrdinaryClasses } from '../services/cohortTimetable.js';
import { createUpcomingLiveClassReminders } from '../services/liveClassReminders.js';

const r = Router();

export const isValidCronAuthorization = (authorization, secret) => {
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(authorization || '');
  return received.length === expected.length && timingSafeEqual(received, expected);
};

r.get('/class-reminders', async (req, res, next) => {
  if (!env.cronSecret) {
    return res.status(503).json({ success: false, message: 'Scheduled reminders are not configured' });
  }

  if (!isValidCronAuthorization(req.get('authorization'), env.cronSecret)) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    await ensureGeneratedOrdinaryClasses();
    await createUpcomingLiveClassReminders();
    return res.json({ success: true, message: 'Class reminders processed' });
  } catch (error) {
    return next(error);
  }
});

export default r;
