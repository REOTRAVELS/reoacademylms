import { Server } from 'socket.io';
import prisma from '../config/database.js';
import { env } from '../config/env.js';
import { verifyToken } from '../utils/jwt.js';
import { canManageLiveClass, findAccessibleLiveClass } from '../utils/liveClassAccess.js';
import { activeProgramCohortForStudent } from '../utils/courseAccess.js';
import { isLiveClassJoinable } from '../utils/liveClassScheduling.js';
import {
  isLiveKitConfigured,
  listLiveKitParticipants,
  removeLiveKitParticipant,
  updateParticipantPublishPermission,
} from './liveKitProvider.js';

const classRoom = (id) => `live-class:${id}`;
const trainerRoom = (id) => `live-class:${id}:trainers`;
const participantSocketSet = (liveClassId, userId) => (
  `reoacademy:live-sockets:${liveClassId}:${userId}`
);
const addSocketScript = `
  local added = redis.call('SADD', KEYS[1], ARGV[1])
  redis.call('EXPIRE', KEYS[1], 120)
  if added == 1 and redis.call('SCARD', KEYS[1]) == 1 then return 1 end
  return 0
`;
const removeSocketScript = `
  redis.call('SREM', KEYS[1], ARGV[1])
  if redis.call('SCARD', KEYS[1]) == 0 then
    redis.call('DEL', KEYS[1])
    return 1
  end
  return 0
`;
const socketsByParticipant = new Map();
let realtimeServer = null;
let realtimeRedisClient = null;
const allowedTypes = new Set([
  'HAND_RAISE', 'HAND_LOWER', 'POLL', 'QUIZ', 'POLL_RESPONSE', 'QUIZ_RESPONSE',
  'QUESTION', 'ANSWER', 'ANNOUNCEMENT', 'EXERCISE', 'EXERCISE_COMPLETION', 'CHAT',
]);
const engagementTypes = new Map([
  ['POLL_RESPONSE', 'POLL_RESPONSE'],
  ['QUIZ_RESPONSE', 'QUIZ_RESPONSE'],
  ['QUESTION', 'QUESTION'],
  ['CHAT', 'DISCUSSION'],
  ['EXERCISE_COMPLETION', 'EXERCISE_COMPLETION'],
]);

const acknowledge = (callback, response) => {
  if (typeof callback === 'function') callback(response);
};

const parseCookie = (header, cookieName) => {
  const pair = header?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`));
  if (!pair) return null;
  try {
    return decodeURIComponent(pair.slice(cookieName.length + 1));
  } catch {
    return null;
  }
};

const publicInteraction = (interaction, isTrainer) => {
  if (!interaction || isTrainer || !['POLL', 'QUIZ'].includes(interaction.type)
    || ['CLOSED', 'RESOLVED'].includes(interaction.status)) return interaction;
  const payload = { ...interaction.payload };
  delete payload.correctOptionIds;
  return { ...interaction, payload };
};

const loadClassState = async (liveClassId, isTrainer) => {
  const interactions = await prisma.liveClassInteraction.findMany({
    where: {
      liveClassId,
      OR: [
        { status: { in: ['PUBLISHED', 'RESOLVED', 'CLOSED'] } },
        ...(isTrainer ? [{ status: 'PENDING' }] : []),
        { type: 'HAND_RAISE', active: true },
      ],
    },
    include: {
      sender: { select: { id: true, firstName: true, lastName: true, role: { select: { name: true } } } },
    },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });
  return interactions.map((interaction) => publicInteraction(interaction, isTrainer));
};

const elapsedSeconds = (from, to) => Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1000));

export const revalidateLiveClassAccess = async () => {
  if (!realtimeServer) return;
  const participantRoomsToRemove = new Set();
  const invalidatedSockets = [];

  if (realtimeRedisClient) {
    for await (const batch of realtimeRedisClient.scanIterator({
      MATCH: 'reoacademy:live-sockets:*',
      COUNT: 100,
    })) {
      const keys = Array.isArray(batch) ? batch : [batch];
      for (const key of keys) {
        const [, , liveClassId, userId] = key.split(':');
        const socketIds = await realtimeRedisClient.sMembers(key);
        if (!socketIds.length) {
          await realtimeRedisClient.del(key);
          continue;
        }
        const user = await prisma.user.findUnique({
          where: { id: userId },
          include: { role: true },
        });
        if (user?.status === 'ACTIVE' && await findAccessibleLiveClass(liveClassId, user)) continue;
        const invalidClassIds = [liveClassId];
        for (const socketId of socketIds) {
          realtimeServer.to(socketId).emit('classroom:access-revoked', { liveClassIds: invalidClassIds });
          realtimeServer.in(socketId).disconnectSockets(true);
        }
      }
    }
  } else {
    const sockets = [...realtimeServer.sockets.sockets.values()];

    for (const socket of sockets) {
      const liveClassIds = [...(socket.data.classIds || [])];
      if (!liveClassIds.length) continue;

      const user = await prisma.user.findUnique({
        where: { id: socket.data.user.id },
        include: { role: true },
      });
      const invalidClassIds = [];
      for (const liveClassId of liveClassIds) {
        if (!user || user.status !== 'ACTIVE' || !(await findAccessibleLiveClass(liveClassId, user))) {
          invalidClassIds.push(liveClassId);
        }
      }

      if (!invalidClassIds.length) {
        socket.data.user = user;
        continue;
      }

      for (const liveClassId of invalidClassIds) {
        const roomName = socket.data.roomNames?.get(liveClassId);
        if (roomName) participantRoomsToRemove.add(`${roomName}\u0000${socket.data.user.id}`);
      }
      socket.emit('classroom:access-revoked', { liveClassIds: invalidClassIds });
      invalidatedSockets.push(socket);
    }
  }

  if (isLiveKitConfigured()) {
    const liveClasses = await prisma.liveClass.findMany({
      where: { status: { in: ['SCHEDULED', 'LIVE'] } },
      select: { id: true, roomName: true },
    });
    for (const liveClass of liveClasses) {
      const participantIds = await listLiveKitParticipants(liveClass.roomName);
      for (const participantId of participantIds) {
        const user = await prisma.user.findUnique({
          where: { id: participantId },
          include: { role: true },
        });
        if (!user || user.status !== 'ACTIVE'
          || !(await findAccessibleLiveClass(liveClass.id, user))) {
          participantRoomsToRemove.add(`${liveClass.roomName}\u0000${participantId}`);
        }
      }
    }
  }

  invalidatedSockets.forEach((socket) => socket.disconnect(true));
  await Promise.all([...participantRoomsToRemove].map((entry) => {
    const [roomName, participantId] = entry.split('\u0000');
    return removeLiveKitParticipant(roomName, participantId);
  }));
};

const lowerParticipantHand = async (io, liveClassId, participantId) => {
  await prisma.liveClassInteraction.updateMany({
    where: { liveClassId, senderId: participantId, type: 'HAND_RAISE', active: true },
    data: { active: false },
  });
  const data = { liveClassId, type: 'HAND_LOWER', senderId: participantId, active: false };
  io.to(classRoom(liveClassId)).emit('classroom:interaction', data);
  return data;
};

export const ensureActivePresence = async (liveClassId, user) => prisma.$transaction(async (tx) => {
  const active = await tx.liveClassPresence.findFirst({
    where: { liveClassId, userId: user.id, leftAt: null },
    select: { id: true },
  });
  if (active) return active;

  const previous = await tx.liveClassPresence.findFirst({
    where: { liveClassId, userId: user.id },
    orderBy: [{ joinedAt: 'desc' }, { id: 'desc' }],
    select: { id: true, rejoinCount: true, leftAt: true, disconnectionDuration: true },
  });
  const joinedAt = new Date();
  if (previous?.leftAt) {
    await tx.liveClassPresence.update({
      where: { id: previous.id },
      data: {
        disconnectionDuration: previous.disconnectionDuration
          + elapsedSeconds(previous.leftAt, joinedAt),
      },
    });
  }
  return tx.liveClassPresence.create({
    data: {
      liveClassId,
      userId: user.id,
      isTrainer: user.role.name === 'TRAINER' || user.role.name === 'SUPER_ADMIN',
      rejoinCount: previous ? previous.rejoinCount + 1 : 0,
    },
  });
}, { isolationLevel: 'Serializable' });

const validateInteraction = (input, user) => {
  const { type, payload, parentId, clientEventId } = input;
  if (!allowedTypes.has(type)) throw new Error('Unsupported classroom interaction.');
  if (typeof clientEventId !== 'string' || clientEventId.length < 1 || clientEventId.length > 100) {
    throw new Error('A unique event id is required.');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Interaction content is invalid.');
  }
  const text = payload.text ?? payload.prompt ?? payload.title;
  if (typeof text === 'string' && (text.trim().length === 0 || text.length > 4000)) {
    throw new Error('Interaction text must be between 1 and 4000 characters.');
  }

  const isTrainer = user.role.name === 'TRAINER' || user.role.name === 'SUPER_ADMIN';
  if (['POLL', 'QUIZ', 'ANNOUNCEMENT', 'EXERCISE', 'ANSWER'].includes(type) && !isTrainer) {
    throw new Error('Trainer access is required for this interaction.');
  }
  if (['POLL_RESPONSE', 'QUIZ_RESPONSE', 'EXERCISE_COMPLETION', 'ANSWER'].includes(type) && !parentId) {
    throw new Error('This interaction must belong to a classroom activity.');
  }
};

export const createInteraction = async (io, socket, liveClass, input) => {
  const user = socket.data.user;
  validateInteraction(input, user);
  const { type, payload, parentId = null, clientEventId } = input;
  const isTrainer = user.role.name !== 'STUDENT';

  const existing = await prisma.liveClassInteraction.findUnique({
    where: { liveClassId_clientEventId: { liveClassId: liveClass.id, clientEventId } },
    include: {
      sender: { select: { id: true, firstName: true, lastName: true, role: { select: { name: true } } } },
    },
  });
  if (existing) return publicInteraction(existing, isTrainer);

  if (type === 'HAND_LOWER') {
    return lowerParticipantHand(io, liveClass.id, user.id);
  }

  if (parentId) {
    const parent = await prisma.liveClassInteraction.findFirst({
      where: { id: parentId, liveClassId: liveClass.id },
      select: { id: true, type: true, status: true, payload: true },
    });
    if (!parent) throw new Error('The referenced classroom interaction was not found.');
    if (['POLL_RESPONSE', 'QUIZ_RESPONSE'].includes(type)) {
      const expectedType = type === 'POLL_RESPONSE' ? 'POLL' : 'QUIZ';
      const selected = payload.choiceIds;
      const options = parent.payload?.options;
      if (parent.type !== expectedType || parent.status !== 'PUBLISHED'
        || !Array.isArray(selected) || selected.length !== 1
        || !Array.isArray(options) || !options.some((option) => option.id === selected[0])) {
        throw new Error('The selected response is not valid for this active poll or quiz.');
      }
    } else if (type === 'EXERCISE_COMPLETION' && (parent.type !== 'EXERCISE' || parent.status !== 'PUBLISHED')) {
      throw new Error('This exercise is no longer active.');
    } else if (type === 'ANSWER' && parent.type !== 'QUESTION') {
      throw new Error('Answers must be linked to a question.');
    }
  }

  const interaction = await prisma.liveClassInteraction.create({
    data: {
      liveClassId: liveClass.id,
      senderId: user.id,
      parentId,
      type,
      status: type === 'QUESTION' ? 'PENDING' : 'PUBLISHED',
      active: type === 'HAND_RAISE',
      clientEventId,
      payload,
    },
    include: {
      sender: { select: { id: true, firstName: true, lastName: true, role: { select: { name: true } } } },
    },
  });

  const engagementType = engagementTypes.get(type);
  if (engagementType) {
    await prisma.liveClassEngagement.create({
      data: { liveClassId: liveClass.id, userId: user.id, interactionId: interaction.id, type: engagementType, clientEventId },
    }).catch((error) => {
      if (error.code !== 'P2002') throw error;
    });
  }

  const safeInteraction = publicInteraction(interaction, isTrainer);
  io.to(type === 'QUESTION' ? trainerRoom(liveClass.id) : classRoom(liveClass.id))
    .emit(type === 'QUESTION' ? 'classroom:question-pending' : 'classroom:interaction', safeInteraction);
  return safeInteraction;
};

export const emitLiveClassEvent = (io, liveClassId, event, payload) => {
  io.to(classRoom(liveClassId)).emit(event, payload);
};

export const attachLiveClassRealtime = (httpServer, { adapter, redisClient } = {}) => {
  const io = new Server(httpServer, {
    cors: { origin: env.clientUrl, credentials: true },
  });
  if (adapter) io.adapter(adapter);
  realtimeServer = io;
  realtimeRedisClient = redisClient || null;

  io.use(async (socket, next) => {
    try {
      const token = parseCookie(socket.handshake.headers.cookie, env.cookieName);
      if (!token) return next(new Error('Authentication required.'));
      const payload = verifyToken(token);
      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        include: { role: true },
      });
      if (!user || user.status !== 'ACTIVE') return next(new Error('Authentication required.'));
      socket.data.user = user;
      socket.data.classIds = new Set();
      socket.data.roomNames = new Map();
      socket.data.redisSocketKeys = new Set();
      next();
    } catch {
      next(new Error('Authentication required.'));
    }
  });

  io.on('connection', (socket) => {
    socket.on('classroom:join', async ({ liveClassId } = {}, callback) => {
      try {
        const liveClass = await findAccessibleLiveClass(liveClassId, socket.data.user);
        if (!liveClass || !isLiveClassJoinable(liveClass)) throw new Error('You cannot join this live class.');
        const isTrainer = await canManageLiveClass(liveClass, socket.data.user);
        await socket.join(classRoom(liveClass.id));
        if (isTrainer) await socket.join(trainerRoom(liveClass.id));
        socket.data.classIds.add(liveClass.id);
        socket.data.roomNames.set(liveClass.id, liveClass.roomName);

        const key = `${liveClass.id}:${socket.data.user.id}`;
        let isFirstConnection;
        if (redisClient) {
          const redisKey = participantSocketSet(liveClass.id, socket.data.user.id);
          isFirstConnection = Number(await redisClient.eval(addSocketScript, {
            keys: [redisKey],
            arguments: [socket.id],
          })) === 1;
          socket.data.redisSocketKeys.add(redisKey);
          if (!socket.data.redisLeaseTimer) {
            socket.data.redisLeaseTimer = setInterval(() => {
              Promise.all([...socket.data.redisSocketKeys].map((socketKey) => (
                redisClient.expire(socketKey, 120)
              ))).catch((error) => console.error('Could not renew classroom socket lease', error));
            }, 30_000);
            socket.data.redisLeaseTimer.unref();
          }
        } else {
          const participantSockets = socketsByParticipant.get(key) || new Set();
          isFirstConnection = participantSockets.size === 0;
          participantSockets.add(socket.id);
          socketsByParticipant.set(key, participantSockets);
        }
        if (isFirstConnection) {
          await lowerParticipantHand(io, liveClass.id, socket.data.user.id);
        }
        await ensureActivePresence(liveClass.id, socket.data.user);
        acknowledge(callback, { success: true, interactions: await loadClassState(liveClass.id, isTrainer) });
      } catch (error) {
        acknowledge(callback, { success: false, message: error.message || 'Could not join classroom interactions.' });
      }
    });

    socket.on('classroom:interaction:create', async (input = {}, callback) => {
      try {
        const liveClassId = input.liveClassId;
        const liveClass = await findAccessibleLiveClass(liveClassId, socket.data.user);
        if (!liveClass || liveClass.status !== 'LIVE' || !socket.data.classIds.has(liveClassId)) {
          throw new Error('Join this live class before interacting.');
        }
        const data = await createInteraction(io, socket, liveClass, input);
        acknowledge(callback, { success: true, data });
      } catch (error) {
        acknowledge(callback, { success: false, message: error.message || 'Classroom interaction failed.' });
      }
    });

    socket.on('classroom:question:moderate', async ({ liveClassId, interactionId, status } = {}, callback) => {
      try {
        const liveClass = await findAccessibleLiveClass(liveClassId, socket.data.user);
        if (!liveClass || !socket.data.classIds.has(liveClassId)
          || !(await canManageLiveClass(liveClass, socket.data.user))) throw new Error('Trainer access is required.');
        if (!['PUBLISHED', 'HIDDEN', 'RESOLVED'].includes(status)) throw new Error('Invalid moderation action.');
        const question = await prisma.liveClassInteraction.findFirst({
          where: { id: interactionId, liveClassId, type: 'QUESTION' },
          select: { id: true },
        });
        if (!question) throw new Error('Question not found in this class.');
        const updated = await prisma.liveClassInteraction.update({
          where: { id: question.id },
          data: { status },
          include: { sender: { select: { id: true, firstName: true, lastName: true, role: { select: { name: true } } } } },
        });
        const data = publicInteraction(updated, true);
        io.to(classRoom(liveClassId)).emit('classroom:interaction', data);
        acknowledge(callback, { success: true, data });
      } catch (error) {
        acknowledge(callback, { success: false, message: error.message || 'Could not moderate question.' });
      }
    });

    socket.on('classroom:activity:close', async ({ liveClassId, interactionId } = {}, callback) => {
      try {
        const liveClass = await findAccessibleLiveClass(liveClassId, socket.data.user);
        if (!liveClass || !socket.data.classIds.has(liveClassId)
          || !(await canManageLiveClass(liveClass, socket.data.user))) throw new Error('Trainer access is required.');
        const activity = await prisma.liveClassInteraction.findFirst({
          where: { id: interactionId, liveClassId, type: { in: ['POLL', 'QUIZ', 'EXERCISE'] } },
          select: { id: true },
        });
        if (!activity) throw new Error('Class activity not found.');
        const updated = await prisma.liveClassInteraction.update({
          where: { id: activity.id },
          data: { status: 'CLOSED' },
          include: { sender: { select: { id: true, firstName: true, lastName: true, role: { select: { name: true } } } } },
        });
        const data = publicInteraction(updated, true);
        io.to(classRoom(liveClassId)).emit('classroom:interaction', publicInteraction(updated, false));
        acknowledge(callback, { success: true, data });
      } catch (error) {
        acknowledge(callback, { success: false, message: error.message || 'Could not close the activity.' });
      }
    });

    socket.on('classroom:hand:manage', async ({ liveClassId, participantId, active } = {}, callback) => {
      try {
        const liveClass = await findAccessibleLiveClass(liveClassId, socket.data.user);
        if (!liveClass || !socket.data.classIds.has(liveClassId)
          || !(await canManageLiveClass(liveClass, socket.data.user))) throw new Error('Trainer access is required.');
        if (typeof participantId !== 'string' || typeof active !== 'boolean') throw new Error('Invalid hand state.');
        await prisma.liveClassInteraction.updateMany({
          where: { liveClassId, senderId: participantId, type: 'HAND_RAISE', active: !active },
          data: { active },
        });
        const data = { type: active ? 'HAND_RAISE' : 'HAND_LOWER', senderId: participantId, active };
        io.to(classRoom(liveClassId)).emit('classroom:interaction', data);
        acknowledge(callback, { success: true, data });
      } catch (error) {
        acknowledge(callback, { success: false, message: error.message || 'Could not manage raised hand.' });
      }
    });

    socket.on('classroom:presenter:set', async ({ liveClassId, participantId, canPublish } = {}, callback) => {
      try {
        const liveClass = await findAccessibleLiveClass(liveClassId, socket.data.user);
        if (!liveClass || !socket.data.classIds.has(liveClassId)
          || !(await canManageLiveClass(liveClass, socket.data.user))) throw new Error('Trainer access is required.');
        if (typeof participantId !== 'string' || typeof canPublish !== 'boolean') throw new Error('Invalid presenter permission.');
        if (!liveClass.cohortId) throw new Error('This class has no student cohort.');
        const enrolment = await prisma.enrolment.findFirst({
          where: {
            studentId: participantId,
            cohortId: liveClass.cohortId,
            cohort: activeProgramCohortForStudent(participantId),
          },
          select: { id: true },
        });
        if (!enrolment) throw new Error('Participant is not enrolled in this class cohort.');
        await updateParticipantPublishPermission(liveClass.roomName, participantId, canPublish);
        const data = { liveClassId, participantId, canPublish };
        io.to(classRoom(liveClassId)).emit('classroom:presenter-permission', data);
        acknowledge(callback, { success: true, data });
      } catch (error) {
        acknowledge(callback, { success: false, message: error.message || 'Could not update presenter permissions.' });
      }
    });

    socket.on('disconnect', async () => {
      if (socket.data.redisLeaseTimer) clearInterval(socket.data.redisLeaseTimer);
      const user = socket.data.user;
      for (const liveClassId of socket.data.classIds) {
        const key = `${liveClassId}:${user.id}`;
        if (redisClient) {
          const redisKey = participantSocketSet(liveClassId, user.id);
          const isLastConnection = Number(await redisClient.eval(removeSocketScript, {
            keys: [redisKey],
            arguments: [socket.id],
          })) === 1;
          if (!isLastConnection) continue;
        } else {
          const participantSockets = socketsByParticipant.get(key);
          participantSockets?.delete(socket.id);
          if (participantSockets?.size) continue;
          socketsByParticipant.delete(key);
        }
        const leftAt = new Date();
        try {
          const presence = await prisma.liveClassPresence.findFirst({
            where: { liveClassId, userId: user.id, leftAt: null },
            orderBy: { joinedAt: 'desc' },
            select: { id: true, joinedAt: true },
          });
          if (presence) {
            await prisma.liveClassPresence.update({
              where: { id: presence.id },
              data: {
                leftAt,
                totalDuration: Math.max(0, Math.floor((leftAt.getTime() - presence.joinedAt.getTime()) / 1000)),
              },
            });
          }
        } catch (error) {
          console.error('Could not close live-class presence after socket disconnect', error);
        }
        try {
          await lowerParticipantHand(io, liveClassId, user.id);
        } catch (error) {
          console.error('Could not lower raised hand after socket disconnect', error);
        }
      }
    });
  });

  return io;
};
