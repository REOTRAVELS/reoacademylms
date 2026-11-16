import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../src/utils/password.js';
import { ensureNamedRecord, ensureSeedUser, seed } from '../prisma/seed.js';

const account = {
  email: 'student@reotravel.academy',
  password: 'unit-test-seed-password',
  firstName: 'Kofi',
  lastName: 'Learner',
  roleId: 'student-role',
  status: 'ACTIVE',
};

test('seed creates a configured account with a valid password hash', async () => {
  let created;
  const userModel = {
    findUnique: async () => null,
    create: async ({ data }) => {
      created = { id: 'student-id', ...data };
      return created;
    },
  };

  const user = await ensureSeedUser(userModel, account);

  assert.equal(user.email, account.email);
  assert.equal(user.roleId, account.roleId);
  assert.equal(user.status, account.status);
  assert.notEqual(created.passwordHash, account.password);
  assert.equal(await verifyPassword(account.password, created.passwordHash), true);
});

test('seed preserves a matching password and unrelated existing profile fields', async () => {
  const existing = {
    id: 'student-id',
    email: account.email,
    firstName: account.firstName,
    lastName: account.lastName,
    roleId: account.roleId,
    status: account.status,
    passwordHash: await hashPassword(account.password),
    phone: '+233000000000',
  };
  let updateCalled = false;
  const userModel = {
    findUnique: async () => existing,
    update: async () => {
      updateCalled = true;
      throw new Error('An unchanged account should not be updated');
    },
  };

  const result = await ensureSeedUser(userModel, account);

  assert.equal(result, existing);
  assert.equal(result.phone, '+233000000000');
  assert.equal(updateCalled, false);
});

test('seed updates a changed configured password without replacing unrelated fields', async () => {
  const previousPassword = 'previous-unit-test-password';
  const existing = {
    id: 'student-id',
    email: account.email,
    firstName: account.firstName,
    lastName: account.lastName,
    roleId: account.roleId,
    status: account.status,
    passwordHash: await hashPassword(previousPassword),
    phone: '+233000000000',
  };
  let updateData;
  const userModel = {
    findUnique: async () => existing,
    update: async ({ data }) => {
      updateData = data;
      return { ...existing, ...data };
    },
  };

  const result = await ensureSeedUser(userModel, account);

  assert.equal(await verifyPassword(account.password, result.passwordHash), true);
  assert.equal(updateData.phone, undefined);
  assert.equal(result.phone, existing.phone);
});

test('seed validates all configured passwords before opening a transaction', async () => {
  let transactionOpened = false;

  await assert.rejects(
    seed({
      $transaction: async () => {
        transactionOpened = true;
      },
    }, {}),
    /SEED_ADMIN_PASSWORD/,
  );
  assert.equal(transactionOpened, false);
});

test('seed never writes development accounts or fixtures in production', async () => {
  let transactionOpened = false;

  await assert.rejects(
    seed({
      $transaction: async () => {
        transactionOpened = true;
      },
    }, { NODE_ENV: 'production' }),
    /cannot be run when NODE_ENV is production/,
  );
  assert.equal(transactionOpened, false);
});

test('seed fixture lookup preserves an existing record without updating it', async () => {
  const existing = { id: 'existing-fixture', title: 'Edited sample content' };
  let createCalled = false;
  const model = {
    findFirst: async () => existing,
    create: async () => {
      createCalled = true;
      throw new Error('Existing fixture should not be recreated');
    },
  };

  assert.equal(await ensureNamedRecord(model, {
    where: { title: 'Module 1: Basics' },
    data: { title: 'Module 1: Basics' },
  }), existing);
  assert.equal(createCalled, false);
});
