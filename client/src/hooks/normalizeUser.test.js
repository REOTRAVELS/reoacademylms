import { describe, expect, it } from 'vitest';
import { normalizeUser, normalizeUserResponse } from './normalizeUser.js';

describe('normalizeUser', () => {
  it('normalizes the login response role string', () => {
    expect(normalizeUser({ id: '1', role: 'SUPER_ADMIN' })).toEqual({
      id: '1',
      role: { name: 'SUPER_ADMIN' },
    });
  });

  it('normalizes the user inside the API response envelope', () => {
    expect(normalizeUserResponse({
      success: true,
      data: { id: '2', role: 'TRAINER' },
    })).toEqual({
      id: '2',
      role: { name: 'TRAINER' },
    });
  });

  it('preserves the current-user role object', () => {
    const role = { name: 'STUDENT' };
    expect(normalizeUser({ id: '2', role }).role).toBe(role);
  });

  it('returns null when no authenticated user is available', () => {
    expect(normalizeUser(null)).toBeNull();
  });

  it('returns null for invalid user payloads', () => {
    expect(normalizeUser('not-a-user')).toBeNull();
    expect(normalizeUser([])).toBeNull();
    expect(normalizeUserResponse({ data: 'bad-payload' })).toBeNull();
  });
});
