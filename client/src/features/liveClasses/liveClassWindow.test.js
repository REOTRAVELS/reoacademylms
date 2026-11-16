import { describe, expect, it } from 'vitest';
import { canJoin, joinState, opensAt, untilLabel } from './liveClassWindow.js';

const start = new Date('2027-03-01T10:00:00Z');
const cls = { status: 'SCHEDULED', startsAt: start.toISOString(), durationMins: 60 };
const at = (mins) => start.getTime() + mins * 60_000;

describe('join window', () => {
  it('opens exactly 40 minutes before the start', () => {
    expect(joinState(cls, at(-41))).toBe('soon');
    expect(joinState(cls, at(-40))).toBe('open');
    expect(opensAt(cls).getTime()).toBe(at(-40));
  });
  it('closes when the scheduled time ends', () => {
    expect(joinState(cls, at(59))).toBe('open');
    expect(joinState(cls, at(60))).toBe('over');
  });
  it('lets anyone into a live class and keeps ended or cancelled out', () => {
    expect(canJoin({ ...cls, status: 'LIVE' }, at(500))).toBe(true);
    expect(canJoin({ ...cls, status: 'ENDED' }, at(0))).toBe(false);
    expect(canJoin({ ...cls, status: 'CANCELLED' }, at(0))).toBe(false);
  });
  it('formats the countdown', () => {
    expect(untilLabel(at(0), at(-25))).toBe('25 min');
    expect(untilLabel(at(0), at(-150))).toBe('2h 30m');
  });
});
