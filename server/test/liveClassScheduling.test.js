import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findLiveClassConflicts,
  formatLiveClassIcs,
  generateRecurringClassDates,
  getJoinTokenTtlSeconds,
  getLiveClassConflictSearchRange,
  LIVEKIT_JOIN_TOKEN_TTL_SECONDS,
} from '../src/utils/liveClassScheduling.js';

const start = new Date('2027-01-15T10:00:00.000Z');
const candidate = {
  cohortId: 'cohort-a',
  startsAt: start,
  durationMins: 60,
  trainerIds: ['trainer-a'],
  studentIds: ['student-a'],
};

test('LiveKit join tokens use a short expiry so revoked access cannot be replayed for the class duration', () => {
  assert.equal(getJoinTokenTtlSeconds(), 5 * 60);
  assert.equal(LIVEKIT_JOIN_TOKEN_TTL_SECONDS, 5 * 60);
});

test('live-class conflict detection catches cohort, trainer, and student overlaps', () => {
  const existing = [
    {
      id: 'cohort-conflict',
      title: 'Cohort class',
      cohortId: 'cohort-a',
      startsAt: start,
      durationMins: 60,
    },
    {
      id: 'trainer-conflict',
      title: 'Trainer class',
      cohortId: 'cohort-b',
      startsAt: start,
      durationMins: 60,
      course: { trainers: [{ trainerId: 'trainer-a' }] },
    },
    {
      id: 'student-conflict',
      title: 'Student class',
      cohortId: 'cohort-c',
      startsAt: start,
      durationMins: 60,
      cohort: { enrolments: [{ studentId: 'student-a' }] },
    },
  ];

  const conflicts = findLiveClassConflicts(candidate, existing);

  assert.deepEqual(conflicts.map(({ id }) => id), [
    'cohort-conflict',
    'trainer-conflict',
    'student-conflict',
  ]);
  assert.deepEqual(conflicts.map(({ reasons }) => reasons), [
    ['cohort'],
    ['trainer'],
    ['student'],
  ]);
});

test('conflict detection allows adjacent sessions and ignores cancelled or excluded classes', () => {
  const existing = [
    {
      id: 'adjacent',
      title: 'Adjacent class',
      cohortId: candidate.cohortId,
      startsAt: new Date(start.getTime() + 60 * 60_000),
      durationMins: 60,
    },
    {
      id: 'cancelled',
      title: 'Cancelled class',
      cohortId: candidate.cohortId,
      startsAt: start,
      durationMins: 60,
      status: 'CANCELLED',
    },
    {
      id: 'edited',
      title: 'Current class',
      cohortId: candidate.cohortId,
      startsAt: start,
      durationMins: 60,
    },
  ];

  assert.deepEqual(findLiveClassConflicts(candidate, existing, 'edited'), []);
});

test('conflict search range includes the maximum supported earlier class duration', () => {
  const range = getLiveClassConflictSearchRange(start, 60);
  assert.equal(range.gte.toISOString(), '2027-01-15T02:00:00.000Z');
  assert.equal(range.lt.toISOString(), '2027-01-15T11:00:00.000Z');
});

test('calendar export escapes event text and uses UTC times', () => {
  const calendar = formatLiveClassIcs({
    id: 'class-1',
    title: 'Operations, Part 1; intro',
    description: 'First line\nSecond line',
    startsAt: start,
    durationMins: 90,
    status: 'SCHEDULED',
  });

  assert.match(calendar, /SUMMARY:Operations\\, Part 1\\; intro/);
  assert.match(calendar, /DESCRIPTION:First line\\nSecond line/);
  assert.match(calendar, /DTSTART:20270115T100000Z/);
  assert.match(calendar, /DTEND:20270115T113000Z/);
  assert.match(calendar, /STATUS:CONFIRMED/);
  assert.ok(calendar.endsWith('\r\n'));
});

test('recurring cohort schedules generate ordinary class dates within the cohort window', () => {
  const dates = generateRecurringClassDates({
    schedule: 'Mon, Wed 09:00-10:30',
    startDate: new Date('2026-01-05T00:00:00.000Z'),
    endDate: new Date('2026-01-18T00:00:00.000Z'),
  });

  assert.deepEqual(dates.map((date) => date.toISOString()), [
    '2026-01-05T09:00:00.000Z',
    '2026-01-07T09:00:00.000Z',
    '2026-01-12T09:00:00.000Z',
    '2026-01-14T09:00:00.000Z',
  ]);
});
