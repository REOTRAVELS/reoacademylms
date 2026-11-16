import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ||= 'programme-scope-http-integration-secret';
process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/test';

const [{ default: app }, { default: prisma }, { signToken }] = await Promise.all([
  import('../src/app.js'),
  import('../src/config/database.js'),
  import('../src/utils/jwt.js'),
]);

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

test('Tutors can list and view only Programs in their course or cohort assignment scope', async () => {
  const trainer = { id: 'trainer-1', status: 'ACTIVE', role: { name: 'TRAINER' } };
  let listQuery;
  const detailQueries = [];
  const restores = [
    stubMethod(prisma.user, 'findUnique', async () => trainer),
    stubMethod(prisma.programme, 'findMany', async (query) => {
      listQuery = query;
      return [{ id: 'programme-a', title: 'Assigned Program' }];
    }),
    stubMethod(prisma.programme, 'findFirst', async (query) => {
      detailQueries.push(query);
      return query.where.id === 'programme-a' ? { id: 'programme-a', title: 'Assigned Program' } : null;
    }),
  ];
  let server;
  try {
    server = await startServer();
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/programmes`;
    const headers = { Cookie: `reoa_session=${signToken({ sub: trainer.id })}` };
    const listed = await fetch(baseUrl, { headers });
    const visiblePrograms = await listed.json();
    assert.equal(listed.status, 200);
    assert.equal(visiblePrograms.data.length, 1);
    assert.deepEqual(listQuery.where, {
      OR: [
        { courses: { some: { trainers: { some: { trainerId: trainer.id } } } } },
        { cohorts: { some: { trainers: { some: { trainerId: trainer.id } } } } },
      ],
    });
    assert.equal(listQuery.include, undefined);

    const assigned = await fetch(`${baseUrl}/programme-a`, { headers });
    assert.equal(assigned.status, 200);
    const foreign = await fetch(`${baseUrl}/programme-b`, { headers });
    assert.equal(foreign.status, 404);
    assert.equal(detailQueries.length, 2);
    assert.ok(detailQueries.every(({ where, include }) => (
      where.OR
      && include.courses.where.trainers.some.trainerId === trainer.id
      && include.cohorts.where.trainers.some.trainerId === trainer.id
    )));
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});
