import test from 'node:test';
import assert from 'node:assert/strict';
import { validateIntake } from '../src/validators/intake.js';

test('academy GATEs use the institution season months', () => {
  const intakes = [
    { gateNumber: 1, season: 'WINTER', academicStartDate: '2027-01-15', academicEndDate: '2027-03-31' },
    { gateNumber: 2, season: 'SPRING', academicStartDate: '2027-04-06', academicEndDate: '2027-06-30' },
    { gateNumber: 3, season: 'SUMMER', academicStartDate: '2027-07-06', academicEndDate: '2027-09-30' },
    { gateNumber: 4, season: 'FALL', academicStartDate: '2027-10-06', academicEndDate: '2027-12-31' },
  ];

  for (const intake of intakes) {
    const result = validateIntake({ ...intake, year: 2027 });
    assert.equal(result.error, undefined);
  }

  const outsidePeriod = validateIntake({
    ...intakes[0],
    year: 2027,
    academicStartDate: '2026-12-31',
  });
  assert.match(outsidePeriod.error, /outside the selected GATE period/i);
});

test('academic start accepts timezone-local values and rejects daylight-saving gaps and overlaps', () => {
  const easternWinter = validateIntake({
    gateNumber: 1,
    season: 'WINTER',
    year: 2027,
    academicStartDate: '2027-01-15T09:30',
    academicEndDate: '2027-03-31',
    timezone: 'America/New_York',
  });
  assert.equal(easternWinter.error, undefined);
  assert.equal(easternWinter.data.academicStartDate.toISOString(), '2027-01-15T14:30:00.000Z');

  const nonexistent = validateIntake({
    gateNumber: 1,
    season: 'WINTER',
    year: 2027,
    academicStartDate: '2027-03-14T02:30',
    academicEndDate: '2027-03-31',
    timezone: 'America/New_York',
  });
  assert.match(nonexistent.error, /valid local date and time/i);

  const ambiguous = validateIntake({
    gateNumber: 4,
    season: 'FALL',
    year: 2027,
    academicStartDate: '2027-11-07T01:30',
    academicEndDate: '2027-12-31',
    timezone: 'America/New_York',
  });
  assert.match(ambiguous.error, /ambiguous/i);
});

test('academic start rejects normalized invalid dates and times in timestamp input', () => {
  const base = {
    gateNumber: 1,
    season: 'WINTER',
    year: 2027,
    academicEndDate: '2027-03-31',
    timezone: 'UTC',
  };
  for (const academicStartDate of [
    '2027-02-30T09:30:00Z',
    '2027-01-15T24:00:00Z',
    '2027-01-15T09:30:60Z',
    '2027-01-15T09:30:00+12:99',
  ]) {
    const result = validateIntake({ ...base, academicStartDate });
    assert.match(result.error, /valid local date and time/i, academicStartDate);
  }
});
