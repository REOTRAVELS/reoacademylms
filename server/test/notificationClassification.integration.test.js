import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ||= 'notification-classification-integration-secret';
process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test';

const [{ default: app }, { default: prisma }, { signToken }] = await Promise.all([
  import('../src/app.js'),
  import('../src/config/database.js'),
  import('../src/utils/jwt.js'),
]);

const users = {
  admin: { id: 'admin-1', status: 'ACTIVE', role: { name: 'SUPER_ADMIN' } },
  trainer: { id: 'trainer-1', status: 'ACTIVE', role: { name: 'TRAINER' } },
  student: { id: 'student-1', status: 'ACTIVE', role: { name: 'STUDENT' } },
};
const usersById = Object.fromEntries(Object.values(users).map((user) => [user.id, user]));

const stubMethod = (target, key, implementation) => {
  const original = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, writable: true, value: implementation });
  return () => {
    if (original) Object.defineProperty(target, key, original);
    else delete target[key];
  };
};

const startServer = async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return server;
};

const closeServer = (server) => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
});

const send = (server, path, { method = 'GET', body, user = users.admin } = {}) => fetch(
  `http://127.0.0.1:${server.address().port}/api${path}`,
  {
    method,
    headers: {
      Cookie: `reoa_session=${signToken({ sub: user.id })}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  },
);

test('notification review lists old records as unclassified instead of exposing them as global', async () => {
  let query;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => users.admin),
    stubMethod(prisma.notification, 'findMany', async (args) => {
      query = args;
      return [{ id: 'legacy-notification', audienceStatus: 'UNCLASSIFIED', isGlobal: false }];
    }),
  ];
  let server;
  try {
    server = await startServer();
    const response = await send(server, '/notifications/admin/legacy');
    assert.equal(response.status, 200);
    assert.deepEqual(query.where, { audienceStatus: 'UNCLASSIFIED' });
    assert.ok(query.select.classificationHistory);
    assert.equal((await response.json()).data.items[0].isGlobal, false);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('offering classification derives Program from the persisted offering and atomically records history', async () => {
  const events = [];
  let updateArgs;
  let historyArgs;
  let offeringQuery;
  const current = {
    id: 'legacy-notification',
    audienceStatus: 'UNCLASSIFIED',
    isGlobal: false,
    programmeId: null,
    programOfferingId: null,
  };
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => users.admin),
    stubMethod(prisma, '$transaction', async (operation) => operation({
      notification: {
        findUnique: async () => current,
        updateMany: async (args) => {
          events.push('notification-updated');
          updateArgs = args;
          return { count: 1 };
        },
      },
      intakeProgramOffering: {
        findUnique: async (args) => {
          offeringQuery = args;
          return { id: 'offering-1', programmeId: 'programme-from-db' };
        },
      },
      notificationClassificationHistory: {
        create: async ({ data }) => {
          events.push('history-created');
          historyArgs = data;
          return { id: 'history-1', ...data };
        },
      },
    })),
  ];
  let server;
  try {
    server = await startServer();
    const response = await send(server, '/notifications/admin/legacy-notification/classification', {
      method: 'POST',
      body: { audienceType: 'OFFERING', programOfferingId: 'offering-1' },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(events, ['notification-updated', 'history-created']);
    assert.deepEqual(offeringQuery, {
      where: { id: 'offering-1' },
      select: { id: true, programmeId: true },
    });
    assert.deepEqual(updateArgs.data, {
      audienceStatus: 'CLASSIFIED',
      isGlobal: false,
      programmeId: 'programme-from-db',
      programOfferingId: 'offering-1',
    });
    assert.deepEqual(updateArgs.where, {
      id: current.id,
      audienceStatus: 'UNCLASSIFIED',
      isGlobal: false,
      programmeId: null,
      programOfferingId: null,
    });
    assert.equal(historyArgs.changedById, users.admin.id);
    assert.equal(historyArgs.previousClassification.audienceStatus, 'UNCLASSIFIED');
    assert.equal(historyArgs.newClassification.programmeId, 'programme-from-db');
    assert.equal('title' in updateArgs.data, false);
    assert.equal('body' in updateArgs.data, false);
    assert.equal('read' in updateArgs.data, false);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('global classification is explicit and records the administrator in append-only history', async () => {
  let nextClassification;
  let historyCount = 0;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => users.admin),
    stubMethod(prisma, '$transaction', async (operation) => operation({
      notification: {
        findUnique: async () => ({
          id: 'legacy-notification',
          audienceStatus: 'UNCLASSIFIED',
          isGlobal: false,
          programmeId: null,
          programOfferingId: null,
        }),
        updateMany: async ({ data }) => {
          nextClassification = data;
          return { count: 1 };
        },
      },
      notificationClassificationHistory: {
        create: async ({ data }) => {
          historyCount += 1;
          assert.equal(data.changedById, users.admin.id);
          assert.deepEqual(data.newClassification, nextClassification);
          return { id: 'history-1', ...data };
        },
      },
    })),
  ];
  let server;
  try {
    server = await startServer();
    const response = await send(server, '/notifications/admin/legacy-notification/classification', {
      method: 'POST',
      body: { audienceType: 'GLOBAL' },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(nextClassification, {
      audienceStatus: 'CLASSIFIED',
      isGlobal: true,
      programmeId: null,
      programOfferingId: null,
    });
    assert.equal(historyCount, 1);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('classification rejects forged Program ids, non-admin requests and concurrent changes', async () => {
  let transactionCount = 0;
  let historyCount = 0;
  let updateCount = 0;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async ({ where }) => usersById[where.id] || users.student),
    stubMethod(prisma, '$transaction', async (operation) => {
      transactionCount += 1;
      return operation({
        notification: {
          findUnique: async () => ({
            id: 'legacy-notification',
            audienceStatus: 'UNCLASSIFIED',
            isGlobal: false,
            programmeId: null,
            programOfferingId: null,
          }),
          updateMany: async () => {
            updateCount += 1;
            return { count: 0 };
          },
        },
        intakeProgramOffering: { findUnique: async () => null },
        programme: { findUnique: async () => ({ id: 'programme-1' }) },
        notificationClassificationHistory: {
          create: async () => {
            historyCount += 1;
            return { id: 'history-1' };
          },
        },
      });
    }),
  ];
  let server;
  try {
    server = await startServer();
    const forbidden = await send(server, '/notifications/admin/legacy-notification/classification', {
      method: 'POST',
      user: users.student,
      body: { audienceType: 'GLOBAL' },
    });
    assert.equal(forbidden.status, 403);
    const trainerForbidden = await send(server, '/notifications/admin/legacy-notification/classification', {
      method: 'POST',
      user: users.trainer,
      body: { audienceType: 'GLOBAL' },
    });
    assert.equal(trainerForbidden.status, 403);

    const forged = await send(server, '/notifications/admin/legacy-notification/classification', {
      method: 'POST',
      body: { audienceType: 'OFFERING', programOfferingId: 'offering-1', programmeId: 'forged-program' },
    });
    assert.equal(forged.status, 400);
    assert.equal(transactionCount, 0);

    const unknownOffering = await send(server, '/notifications/admin/legacy-notification/classification', {
      method: 'POST',
      body: { audienceType: 'OFFERING', programOfferingId: 'missing-offering' },
    });
    assert.equal(unknownOffering.status, 404);

    const conflict = await send(server, '/notifications/admin/legacy-notification/classification', {
      method: 'POST',
      body: { audienceType: 'PROGRAMME', programmeId: 'programme-1' },
    });
    assert.equal(conflict.status, 409);
    assert.equal(updateCount, 1);
    assert.equal(historyCount, 0);
    assert.equal(transactionCount, 2);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});
