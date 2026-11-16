import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ||= 'live-class-realtime-test-secret';
process.env.DATABASE_URL ||= '******localhost:5432/test';

const [{ createInteraction, ensureActivePresence }, { default: prisma }] = await Promise.all([
  import('../src/services/liveClassRealtime.js'),
  import('../src/config/database.js'),
]);

const stubMethod = (target, key, implementation) => {
  const original = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, writable: true, value: implementation });
  return () => {
    if (original) Object.defineProperty(target, key, original);
    else delete target[key];
  };
};

test('socket reconnect accounts for disconnection time and increments the rejoin count', async () => {
  const leftAt = new Date(Date.now() - 3000);
  let updatedPresence;
  let createdPresence;
  let transactionOptions;
  const transactionClient = {
    liveClassPresence: {
      findFirst: async ({ where }) => (where.leftAt === null
        ? null
        : { id: 'presence-previous', rejoinCount: 2, leftAt, disconnectionDuration: 12 }),
      update: async (query) => {
        updatedPresence = query;
        return query;
      },
      create: async (query) => {
        createdPresence = query;
        return { id: 'presence-current', ...query.data };
      },
    },
  };
  const restore = stubMethod(prisma, '$transaction', async (callback, options) => {
    transactionOptions = options;
    return callback(transactionClient);
  });
  try {
    const presence = await ensureActivePresence('class-1', {
      id: 'trainer-1',
      role: { name: 'TRAINER' },
    });

    assert.equal(presence.id, 'presence-current');
    assert.equal(updatedPresence.where.id, 'presence-previous');
    assert.ok(updatedPresence.data.disconnectionDuration >= 14);
    assert.equal(createdPresence.data.liveClassId, 'class-1');
    assert.equal(createdPresence.data.userId, 'trainer-1');
    assert.equal(createdPresence.data.rejoinCount, 3);
    assert.equal(createdPresence.data.isTrainer, true);
    assert.equal(transactionOptions.isolationLevel, 'Serializable');
  } finally {
    restore();
  }
});

test('socket joins reuse an existing active presence', async () => {
  let presenceCreated = false;
  const transactionClient = {
    liveClassPresence: {
      findFirst: async () => ({ id: 'presence-active' }),
      create: async () => {
        presenceCreated = true;
        throw new Error('An active presence must not be duplicated.');
      },
    },
  };
  const restore = stubMethod(prisma, '$transaction', async (callback) => callback(transactionClient));
  try {
    const presence = await ensureActivePresence('class-1', {
      id: 'student-1',
      role: { name: 'STUDENT' },
    });
    assert.deepEqual(presence, { id: 'presence-active' });
    assert.equal(presenceCreated, false);
  } finally {
    restore();
  }
});

test('lowering a hand deactivates the existing raise without storing HAND_LOWER', async () => {
  let update;
  let created = false;
  let emitted;
  const restoreFindUnique = stubMethod(prisma.liveClassInteraction, 'findUnique', async () => null);
  const restoreUpdateMany = stubMethod(prisma.liveClassInteraction, 'updateMany', async (query) => {
    update = query;
    return { count: 1 };
  });
  const restoreCreate = stubMethod(prisma.liveClassInteraction, 'create', async () => {
    created = true;
    throw new Error('Lowering a hand must not create an interaction.');
  });
  const io = { to: (room) => ({ emit: (event, data) => { emitted = { room, event, data }; } }) };
  try {
    const result = await createInteraction(
      io,
      { data: { user: { id: 'student-1', role: { name: 'STUDENT' } } } },
      { id: 'class-1' },
      { type: 'HAND_LOWER', payload: {}, parentId: null, clientEventId: 'lower-event-1' },
    );

    assert.deepEqual(update, {
      where: { liveClassId: 'class-1', senderId: 'student-1', type: 'HAND_RAISE', active: true },
      data: { active: false },
    });
    assert.equal(created, false);
    assert.deepEqual(result, { liveClassId: 'class-1', type: 'HAND_LOWER', senderId: 'student-1', active: false });
    assert.deepEqual(emitted, {
      room: 'live-class:class-1',
      event: 'classroom:interaction',
      data: result,
    });
  } finally {
    restoreCreate();
    restoreUpdateMany();
    restoreFindUnique();
  }
});
