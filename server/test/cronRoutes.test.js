import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidCronAuthorization } from '../src/routes/cronRoutes.js';

test('cron authorization requires the exact configured bearer secret', () => {
  assert.equal(isValidCronAuthorization('Bearer long-random-secret', 'long-random-secret'), true);
  assert.equal(isValidCronAuthorization('Bearer wrong-secret', 'long-random-secret'), false);
  assert.equal(isValidCronAuthorization('', 'long-random-secret'), false);
  assert.equal(isValidCronAuthorization('Bearer long-random-secret', ''), false);
});
