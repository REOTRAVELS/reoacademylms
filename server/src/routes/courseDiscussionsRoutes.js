import { Router } from 'express';
import * as c from '../controllers/courseDiscussionsController.js';
import { authenticate } from '../middleware/auth.js';
import { requireActiveProgramEnrollment } from '../middleware/programEnrollment.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const r = Router();
r.use(authenticate);
r.use(requireActiveProgramEnrollment);
r.get('/courses/:courseId/discussions', asyncHandler(c.listCourseDiscussions));
r.post('/courses/:courseId/discussions', asyncHandler(c.createCourseDiscussion));
r.get('/posts/:id', asyncHandler(c.getDiscussionPost));
r.get('/posts/:id/replies', asyncHandler(c.listDiscussionReplies));
r.post('/posts/:id/replies', asyncHandler(c.createDiscussionReply));
r.patch('/posts/:id', asyncHandler(c.updateDiscussionPost));
r.delete('/posts/:id', asyncHandler(c.deleteDiscussionPost));
r.post('/posts/:id/report', asyncHandler(c.reportDiscussionPost));
r.post('/posts/:id/moderate', asyncHandler(c.moderateDiscussionPost));
r.get('/moderation/reports', asyncHandler(c.listDiscussionReports));
r.patch('/moderation/reports/:id', asyncHandler(c.reviewDiscussionReport));
r.get('/moderation/history', asyncHandler(c.listDiscussionModerationHistory));

export default r;
