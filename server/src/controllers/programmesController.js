import prisma from '../config/database.js';
import { ok, fail } from '../utils/response.js';
import { audit } from '../utils/audit.js';
import slugify from '../utils/slugify.js';
import { revalidateLiveClassAccess } from '../services/liveClassRealtime.js';

const trainerProgrammeScope = (trainerId) => ({
  OR: [
    { courses: { some: { trainers: { some: { trainerId } } } } },
    { cohorts: { some: { trainers: { some: { trainerId } } } } },
  ],
});

export const listProgrammes = async (req, res) => {
  const isTrainer = req.user.role.name === 'TRAINER';
  const items = await prisma.programme.findMany({
    ...(isTrainer ? { where: trainerProgrammeScope(req.user.id) } : {}),
    orderBy: { createdAt: 'desc' },
    ...(!isTrainer ? { include: { _count: { select: { cohorts: true, courses: true, intakeOfferings: true } } } } : {}),
  });
  return ok(res, items);
};

export const getProgramme = async (req, res) => {
  const isTrainer = req.user.role.name === 'TRAINER';
  const query = {
    where: {
      id: req.params.id,
      ...(isTrainer ? trainerProgrammeScope(req.user.id) : {}),
    },
    include: isTrainer
      ? {
        cohorts: { where: { trainers: { some: { trainerId: req.user.id } } } },
        courses: { where: { trainers: { some: { trainerId: req.user.id } } } },
      }
      : {
        cohorts: true,
        courses: true,
      },
  };
  const p = isTrainer
    ? await prisma.programme.findFirst(query)
    : await prisma.programme.findUnique(query);
  if (!p) return fail(res, 'Not found', 404);
  return ok(res, p);
};

export const createProgramme = async (req, res) => {
  const { title, description, qualificationType, startDate, endDate, status } = req.body || {};
  if (typeof title !== 'string' || title.trim().length === 0) return fail(res, 'Programme title is required.', 400);
  if (qualificationType !== undefined && qualificationType !== null &&
      (typeof qualificationType !== 'string' || qualificationType.trim().length > 80)) {
    return fail(res, 'Qualification type must be 80 characters or fewer.', 400);
  }
  if (status !== undefined && !['DRAFT', 'ACTIVE', 'ARCHIVED'].includes(status)) {
    return fail(res, 'Programme status is invalid.', 400);
  }
  const slug = await slugify(title, prisma.programme);
  const p = await prisma.programme.create({
    data: {
      title: title.trim(),
      slug,
      description,
      qualificationType: typeof qualificationType === 'string' ? qualificationType.trim() || null : null,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      status: status || 'DRAFT',
    },
  });
  await audit({ actorId: req.user.id, action: 'CREATE_PROGRAMME', entity: 'Programme', entityId: p.id, ipAddress: req.ip });
  return ok(res, p, 'Created', 201);
};

export const updateProgramme = async (req, res) => {
  const { title, description, qualificationType, startDate, endDate, status } = req.body || {};
  const data = {};
  if (title !== undefined) {
    if (typeof title !== 'string' || title.trim().length === 0) return fail(res, 'Programme title is required.', 400);
    data.title = title.trim();
  }
  if (description !== undefined) data.description = description;
  if (qualificationType !== undefined) {
    if (qualificationType !== null &&
        (typeof qualificationType !== 'string' || qualificationType.trim().length > 80)) {
      return fail(res, 'Qualification type must be 80 characters or fewer.', 400);
    }
    data.qualificationType = typeof qualificationType === 'string' ? qualificationType.trim() || null : null;
  }
  if (startDate !== undefined) data.startDate = startDate ? new Date(startDate) : null;
  if (endDate !== undefined) data.endDate = endDate ? new Date(endDate) : null;
  if (status !== undefined) {
    if (!['DRAFT', 'ACTIVE', 'ARCHIVED'].includes(status)) return fail(res, 'Programme status is invalid.', 400);
    data.status = status;
  }
  const p = await prisma.programme.update({ where: { id: req.params.id }, data });
  await audit({ actorId: req.user.id, action: 'UPDATE_PROGRAMME', entity: 'Programme', entityId: p.id, ipAddress: req.ip });
  await revalidateLiveClassAccess();
  return ok(res, p, 'Updated');
};

export const deleteProgramme = async (req, res) => {
  const programme = await prisma.programme.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { cohorts: true, courses: true, intakeOfferings: true } } },
  });
  if (!programme) return fail(res, 'Programme not found.', 404);
  if (programme._count.cohorts > 0 || programme._count.courses > 0 || programme._count.intakeOfferings > 0) {
    return fail(res, 'This programme has academic history or intake offerings. Archive it instead.', 409);
  }
  try {
    await prisma.programme.delete({ where: { id: programme.id } });
  } catch (error) {
    if (error?.code === 'P2003') {
      return fail(res, 'This programme is in use and cannot be deleted. Archive it instead.', 409);
    }
    throw error;
  }
  await audit({ actorId: req.user.id, action: 'DELETE_PROGRAMME', entity: 'Programme', entityId: req.params.id, ipAddress: req.ip });
  return ok(res, null, 'Deleted');
};
