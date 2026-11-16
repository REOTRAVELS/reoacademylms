import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.JWT_SECRET ||= 'user-settings-http-integration-secret';
process.env.DATABASE_URL ||= 'postgresql://placeholder:placeholder@localhost:5432/test';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'reoacademy-profile-'));

const [{ default: app }, { default: prisma }, { signToken }, { hashPassword, verifyPassword }, { env }] = await Promise.all([
  import('../src/app.js'),
  import('../src/config/database.js'),
  import('../src/utils/jwt.js'),
  import('../src/utils/password.js'),
  import('../src/config/env.js'),
]);

const user = {
  id: 'user-1',
  status: 'ACTIVE',
  firstName: 'Alex',
  lastName: 'Learner',
  email: 'alex@example.test',
  phone: null,
  bio: null,
  avatarUrl: null,
  passwordHash: await hashPassword('Current-password-1'),
  role: { name: 'STUDENT' },
};

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

test('profile settings keep role read-only, allow own picture updates, and change passwords securely', async () => {
  const restores = [];
  let updateData;
  let server;

  restores.push(stubMethod(prisma.user, 'findUnique', async () => user));
  restores.push(stubMethod(prisma.user, 'update', async ({ data }) => {
    updateData = data;
    Object.assign(user, data);
    return user;
  }));
  restores.push(stubMethod(prisma.auditLog, 'create', async () => ({})));

  try {
    server = await startServer();
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/users/${user.id}`;
    const headers = { Cookie: `reoa_session=${signToken({ sub: user.id })}` };

    const profileResponse = await fetch(baseUrl, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName: 'Alexandra', lastName: 'Learner', role: 'SUPER_ADMIN' }),
    });
    assert.equal(profileResponse.status, 200);
    assert.equal(updateData.firstName, 'Alexandra');
    assert.equal('role' in updateData, false);

    const imageBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
    const avatarForm = new FormData();
    avatarForm.append('file', new Blob([imageBytes], { type: 'image/png' }), 'profile.png');
    const avatarResponse = await fetch(`${baseUrl}/avatar`, {
      method: 'POST',
      headers,
      body: avatarForm,
    });
    assert.equal(avatarResponse.status, 200);
    const avatarResult = await avatarResponse.json();
    assert.match(avatarResult.data.avatarUrl, new RegExp(`/users/${user.id}/avatar\\?v=`));
    const savedImage = path.resolve(env.uploadDir, user.avatarUrl);
    assert.equal(fs.existsSync(savedImage), true, `${savedImage}; stored name: ${user.avatarUrl}; upload directory: ${env.uploadDir}`);

    const ownAvatarResponse = await fetch(`${baseUrl}/avatar`, { headers });
    assert.equal(ownAvatarResponse.status, 200);
    assert.equal(ownAvatarResponse.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await ownAvatarResponse.arrayBuffer()), imageBytes);

    const passwordResponse = await fetch(`${baseUrl}/password`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'wrong-password', newPassword: 'Another-password-2' }),
    });
    assert.equal(passwordResponse.status, 400);

    const changedPasswordResponse = await fetch(`${baseUrl}/password`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'Current-password-1', newPassword: 'Another-password-2' }),
    });
    assert.equal(changedPasswordResponse.status, 200);
    assert.equal(updateData.resetToken, null);
    assert.equal(updateData.resetTokenExpiresAt, null);
    assert.equal(await verifyPassword('Another-password-2', user.passwordHash), true);

    const forbiddenAvatarResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/users/other-user/avatar`, {
      method: 'POST',
      headers,
      body: avatarForm,
    });
    assert.equal(forbiddenAvatarResponse.status, 403);

    const forbiddenPasswordResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/users/other-user/password`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'Current-password-1', newPassword: 'Another-password-3' }),
    });
    assert.equal(forbiddenPasswordResponse.status, 403);
  } finally {
    if (server?.listening) await closeServer(server);
    restores.reverse().forEach((restore) => restore());
    fs.rmSync(env.uploadDir, { recursive: true, force: true });
  }
});
