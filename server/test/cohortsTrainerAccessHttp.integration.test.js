import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ||= 'cohort-trainer-access-integration-secret';
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

test('trainers can read assigned cohorts but cannot read unrelated cohorts or mutate cohort records', async () => {
  const trainer = { id: 'trainer-1', status: 'ACTIVE', role: { name: 'TRAINER' } };
  const student = { id: 'student-1', status: 'ACTIVE', role: { name: 'STUDENT' } };
  let listWhere;
  let detailWhere;
  let createCount = 0;
  const restores = [
    stubMethod(prisma.user, 'findUnique', async ({ where }) => (where.id === trainer.id ? trainer : student)),
    stubMethod(prisma.cohort, 'findMany', async ({ where }) => {
      listWhere = where;
      return [{ id: 'assigned-cohort' }];
    }),
    stubMethod(prisma.cohort, 'findFirst', async ({ where }) => {
      detailWhere = where;
      return where.id === 'assigned-cohort' ? { id: where.id, enrolments: [], trainers: [], courses: [] } : null;
    }),
    stubMethod(prisma.cohort, 'create', async () => {
      createCount += 1;
      throw new Error('Trainer must not create cohorts');
    }),
  ];
  let server;
  try {
    server = await startServer();
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/cohorts`;
    const trainerHeaders = { Cookie: `reoa_session=${signToken({ sub: trainer.id })}` };
    const listed = await fetch(`${baseUrl}?programmeId=programme-1`, { headers: trainerHeaders });
    assert.equal(listed.status, 200);
    assert.deepEqual((await listed.json()).data.map(({ id }) => id), ['assigned-cohort']);
    assert.equal(listWhere.programmeId, 'programme-1');
    assert.deepEqual(listWhere.OR, [
      { trainers: { some: { trainerId: trainer.id } } },
      { courses: { some: { course: { trainers: { some: { trainerId: trainer.id } } } } } },
    ]);

    const detail = await fetch(`${baseUrl}/assigned-cohort`, { headers: trainerHeaders });
    assert.equal(detail.status, 200);
    assert.deepEqual(detailWhere, {
      id: 'assigned-cohort',
      OR: [
        { trainers: { some: { trainerId: trainer.id } } },
        { courses: { some: { course: { trainers: { some: { trainerId: trainer.id } } } } } },
      ],
    });

    const unrelated = await fetch(`${baseUrl}/other-cohort`, { headers: trainerHeaders });
    assert.equal(unrelated.status, 404);
    assert.equal(detailWhere.id, 'other-cohort');

    const mutation = await fetch(baseUrl, {
      method: 'POST',
      headers: { ...trainerHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Unauthorized cohort' }),
    });
    assert.equal(mutation.status, 403);
    assert.equal(createCount, 0);

    const studentList = await fetch(baseUrl, {
      headers: { Cookie: `reoa_session=${signToken({ sub: student.id })}` },
    });
    assert.equal(studentList.status, 403);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
  }
});
