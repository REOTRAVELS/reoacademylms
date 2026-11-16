import test from 'node:test';
import assert from 'node:assert/strict';
import {
  announcementAudienceFilter,
  MAX_ATTENDANCE_STUDENTS,
  normalizeAttendanceRecords,
  normalizeStudentIds,
  parseAttendanceDate,
  parseListOptions,
  parseOptionalId,
  restrictProgrammeAudienceToCohorts,
} from '../src/utils/notificationPolicies.js';

const now = new Date('2026-11-09T12:00:00Z');

test('pagination limits are bounded and cursor is optional', () => {
  assert.deepEqual(parseListOptions({}), { take: 50 });
  assert.deepEqual(parseListOptions({ limit: '100', cursor: 'cm123' }), {
    take: 100,
    cursor: { id: 'cm123' },
    skip: 1,
  });
  assert.equal(parseListOptions({ limit: '101' }), null);
  assert.equal(parseListOptions({ limit: ['10'] }), null);
  assert.equal(parseListOptions({ cursor: ' cm123' }), null);
});

test('optional audience ids accept only bounded scalar identifiers', () => {
  assert.equal(parseOptionalId(undefined), null);
  assert.equal(parseOptionalId(''), null);
  assert.equal(parseOptionalId('cohort-1'), 'cohort-1');
  assert.equal(parseOptionalId(' cohort-1'), undefined);
  assert.equal(parseOptionalId(['cohort-1']), undefined);
});

test('announcement recipient filters match the selected audience', () => {
  assert.deepEqual(announcementAudienceFilter({ courseId: 'course-1' }), {
    cohort: { courses: { some: { courseId: 'course-1', course: { status: 'PUBLISHED' } } } },
  });
  assert.deepEqual(announcementAudienceFilter({ cohortId: 'cohort-1' }), { cohortId: 'cohort-1' });
  assert.deepEqual(announcementAudienceFilter({ programmeId: 'programme-1' }), {
    cohort: { programmeId: 'programme-1' },
  });
  assert.equal(announcementAudienceFilter({}), null);
  assert.deepEqual(restrictProgrammeAudienceToCohorts(
    announcementAudienceFilter({ programmeId: 'programme-1' }),
    ['cohort-1'],
  ), {
    cohort: { programmeId: 'programme-1', id: { in: ['cohort-1'] } },
  });
});

test('attendance dates require valid date-only or ISO values and cannot be future dates', () => {
  assert.equal(parseAttendanceDate('2026-11-09', now).toISOString(), '2026-11-09T00:00:00.000Z');
  assert.equal(parseAttendanceDate('2026-11-08T23:30:00-01:00', now).toISOString(), '2026-11-09T00:00:00.000Z');
  assert.equal(parseAttendanceDate('2026-02-30', now), null);
  assert.equal(parseAttendanceDate('2026-02-30T12:00:00Z', now), null);
  assert.equal(parseAttendanceDate('2026-11-10', now), null);
  assert.equal(parseAttendanceDate('11/09/2026', now), null);
});

test('attendance student lists are validated, deduplicated and capped', () => {
  assert.deepEqual(normalizeStudentIds(['student-1', 'student-1', 'student-2']), ['student-1', 'student-2']);
  assert.equal(normalizeStudentIds([]), null);
  assert.equal(normalizeStudentIds(['student-1', 2]), null);
  assert.equal(normalizeStudentIds(Array.from({ length: MAX_ATTENDANCE_STUDENTS + 1 }, (_, index) => `student-${index}`)), null);
});

test('attendance supports per-student status and preserves the legacy batch format', () => {
  assert.deepEqual(normalizeAttendanceRecords([
    { studentId: 'student-1', present: true },
    { studentId: 'student-2', present: false },
  ]), [
    { studentId: 'student-1', present: true },
    { studentId: 'student-2', present: false },
  ]);
  assert.deepEqual(normalizeAttendanceRecords(undefined, ['student-1', 'student-2'], false), [
    { studentId: 'student-1', present: false },
    { studentId: 'student-2', present: false },
  ]);
  assert.equal(normalizeAttendanceRecords([{ studentId: 'student-1', present: 'yes' }]), null);
  assert.equal(normalizeAttendanceRecords([{ studentId: 'student-1', present: true }, { studentId: 'student-1', present: false }]), null);
  assert.equal(normalizeAttendanceRecords([null]), null);
});
