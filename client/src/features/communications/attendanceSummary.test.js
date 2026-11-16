import { describe, expect, it } from 'vitest';
import { getAttendanceSummary } from './attendanceSummary.js';

describe('attendance summary', () => {
  const enrolments = [{ studentId: 'one' }, { studentId: 'two' }, { studentId: 'three' }];

  it('treats unset learners as present and counts explicit absences', () => {
    expect(getAttendanceSummary(enrolments, { two: false })).toEqual({
      total: 3,
      present: 2,
      absent: 1,
    });
  });

  it('supports empty rosters', () => {
    expect(getAttendanceSummary([], {})).toEqual({ total: 0, present: 0, absent: 0 });
  });
});
