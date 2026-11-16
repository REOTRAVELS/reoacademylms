import prisma from '../config/database.js';

export const audit = async ({ actorId, action, entity, entityId, metadata, ipAddress }) => {
  try {
    await prisma.auditLog.create({
      data: { actorId, action, entity, entityId, metadata, ipAddress },
    });
  } catch (e) {
    console.error('Audit log failed', e);
  }
};
