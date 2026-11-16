import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ||= 'cohort-offering-assignment-integration-secret';
process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test';

const [{ default: app }, { default: prisma }, { signToken }] = await Promise.all([
  import('../src/app.js'),
  import('../src/config/database.js'),
  import('../src/utils/jwt.js'),
]);

const admin = { id: 'admin-1', status: 'ACTIVE', role: { name: 'SUPER_ADMIN' } };
const trainer = { id: 'trainer-1', status: 'ACTIVE', role: { name: 'TRAINER' } };

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

const send = (server, { user = admin, offeringId = 'offering-1' } = {}) => fetch(
  `http://127.0.0.1:${server.address().port}/api/cohorts/cohort-1`,
  {
    method: 'PUT',
    headers: {
      Cookie: `reoa_session=${signToken({ sub: user.id })}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ intakeProgramOfferingId: offeringId }),
  },
);

test('administrator explicitly links an existing cohort to a matching offering without changing members', async () => {
  let offeringQuery;
  let updateArgs;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async ({ where }) => (where.id === admin.id ? admin : trainer)),
    stubMethod(prisma.cohort, 'findUnique', async () => ({ id: 'cohort-1', programmeId: 'programme-1' })),
    stubMethod(prisma.intakeProgramOffering, 'findFirst', async (args) => {
      offeringQuery = args;
      return { id: 'offering-1' };
    }),
    stubMethod(prisma.cohort, 'update', async (args) => {
      updateArgs = args;
      return { id: 'cohort-1', intakeProgramOfferingId: 'offering-1' };
    }),
    stubMethod(prisma.auditLog, 'create', async () => ({ id: 'audit-1' })),
  ];
  let server;
  try {
    server = await startServer();
    const response = await send(server);
    assert.equal(response.status, 200);
    assert.deepEqual(offeringQuery.where, {
      id: 'offering-1',
      programmeId: 'programme-1',
      status: 'ACTIVE',
      programme: { status: 'ACTIVE' },
      intake: { status: { in: ['UPCOMING', 'ACTIVE'] } },
    });
    assert.deepEqual(updateArgs, {
      where: { id: 'cohort-1' },
      data: { intakeProgramOfferingId: 'offering-1' },
    });
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});

test('cohort Offering linking rejects mismatched offerings and non-administrators', async () => {
  let updateCount = 0;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async ({ where }) => (where.id === admin.id ? admin : trainer)),
    stubMethod(prisma.cohort, 'findUnique', async () => ({ id: 'cohort-1', programmeId: 'programme-1' })),
    stubMethod(prisma.intakeProgramOffering, 'findFirst', async () => null),
    stubMethod(prisma.cohort, 'update', async () => {
      updateCount += 1;
      return {};
    }),
  ];
  let server;
  try {
    server = await startServer();
    assert.equal((await send(server)).status, 400);
    assert.equal((await send(server, { user: trainer })).status, 403);
    assert.equal(updateCount, 0);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});
