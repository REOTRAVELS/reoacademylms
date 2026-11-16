import { describe, expect, it } from 'vitest';
import { formatRemainingTime, getRemainingSeconds } from './attemptTime.js';

describe('assessment attempt timer', () => {
  it('calculates remaining time from the server-recorded attempt start', () => {
    expect(getRemainingSeconds(
      { startedAt: '2026-11-09T12:00:00.000Z' },
      30,
      new Date('2026-11-09T12:01:05.000Z').getTime(),
    )).toBe(1735);
  });

  it('returns zero after the time limit and null for untimed assessments', () => {
    const attempt = { startedAt: '2026-11-09T12:00:00.000Z' };
    const now = new Date('2026-11-09T12:31:00.000Z').getTime();
    expect(getRemainingSeconds(attempt, 30, now)).toBe(0);
    expect(getRemainingSeconds(attempt, null, now)).toBeNull();
  });

  it('formats remaining time as minutes and seconds', () => {
    expect(formatRemainingTime(1735)).toBe('28:55');
  });
});
