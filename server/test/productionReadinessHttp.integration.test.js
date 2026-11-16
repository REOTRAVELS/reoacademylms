import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ||= 'production-readiness-http-integration-secret';
process.env.DATABASE_URL ||= 'postgresql://placeholder:placeholder@localhost:5432/test';

const [{ default: app }, { default: prisma }] = await Promise.all([
  import('../src/app.js'),
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

const startServer = async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return server;
};

const closeServer = (server) => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
});

test('health endpoint separates liveness from database readiness', async () => {
  const restoreQuery = stubMethod(prisma, '$queryRaw', async () => [{ '?column?': 1 }]);
  const originalConsoleError = console.error;
  console.error = () => {};
  let server;

  try {
    server = await startServer();
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/health`;

    const liveResponse = await fetch(baseUrl);
    assert.equal(liveResponse.status, 200);
    assert.equal((await liveResponse.json()).message, 'OK');

    const readyResponse = await fetch(`${baseUrl}/ready`);
    assert.equal(readyResponse.status, 200);
    assert.equal((await readyResponse.json()).message, 'Ready');

    prisma.$queryRaw = async () => { throw new Error('Database unavailable'); };
    const unavailableResponse = await fetch(`${baseUrl}/ready`);
    assert.equal(unavailableResponse.status, 503);
    assert.equal((await unavailableResponse.json()).message, 'Service unavailable');

    const invalidRegistration = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName: 3 }),
    });
    assert.equal(invalidRegistration.status, 400);
    const validationBody = await invalidRegistration.json();
    assert.equal(validationBody.message, 'Validation failed');
    assert.ok(validationBody.errors.some(({ path }) => path === 'body.firstName'));
  } finally {
    if (server?.listening) await closeServer(server);
    restoreQuery();
    console.error = originalConsoleError;
  }
});
