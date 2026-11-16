import prisma from '../config/database.js';
import { ok, fail } from '../utils/response.js';
import { audit } from '../utils/audit.js';

export const listAnnouncements = async (req, res) => {
  const where = {};
  if (req.query.programmeId) where.programmeId = req.query.programmeId;
  if (req.query.cohortId) where.cohortId = req.query.cohortId;
  if (req.query.courseId) where.courseId = req.query.courseId;
  const announcements = await prisma.announcement.findMany({ where, orderBy: { createdAt: 'desc' } });
  return ok(res, announcements);
};

export const createAnnouncement = async (req, res) => {
  const { title, body, programmeId, cohortId, courseId } = req.body || {};
  const announcement = await prisma.announcement.create({
    data: { title, body, authorId: req.user.id, programmeId, cohortId, courseId },
  });
  await audit({ actorId: req.user.id, action: 'CREATE_ANNOUNCEMENT', entity: 'Announcement', entityId: announcement.id, ipAddress: req.ip });
  return ok(res, announcement, 'Created', 201);
};
