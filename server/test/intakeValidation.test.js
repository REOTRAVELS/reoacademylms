import test from 'node:test';
import assert from 'node:assert/strict';
import { validateIntake, validateOfferingAcademicPeriod } from '../src/validators/intake.js';

test('intake validation checks GATE metadata without requiring academic dates', () => {
  const result = validateIntake({
    gateNumber: 1,
    season: 'WINTER',
    year: 2027,
    timezone: 'UTC',
  });
  assert.equal(result.error, undefined);
  assert.equal('academicStartDate' in result.data, false);
  assert.equal('academicEndDate' in result.data, false);
});

test('each program academic period must match its intake GATE and timezone', () => {
  const intake = { season: 'WINTER', year: 2027, timezone: 'America/New_York' };
  const winter = validateOfferingAcademicPeriod({
    academicStartDate: '2027-01-15T09:30',
    academicEndDate: '2027-03-31',
  }, intake);
  assert.equal(winter.error, undefined);
  assert.equal(winter.data.academicStartDate.toISOString(), '2027-01-15T14:30:00.000Z');

  const outsidePeriod = validateOfferingAcademicPeriod({
    academicStartDate: '2027-04-15T09:30',
    academicEndDate: '2027-05-01',
  }, intake);
  assert.match(outsidePeriod.error, /outside the selected GATE period/i);

  const badEnd = validateOfferingAcademicPeriod({
    academicStartDate: '2027-01-15T09:30',
    academicEndDate: '2027-01-15',
  }, intake);
  assert.match(badEnd.error, /must be after/i);
});

test('program start rejects daylight-saving gaps and overlaps', () => {
  const intake = { season: 'WINTER', year: 2027, timezone: 'America/New_York' };
  const nonexistent = validateOfferingAcademicPeriod({
    academicStartDate: '2027-03-14T02:30',
    academicEndDate: '2027-03-31',
  }, intake);
  assert.match(nonexistent.error, /valid local date and time/i);

  const ambiguous = validateOfferingAcademicPeriod({
    academicStartDate: '2027-11-07T01:30',
    academicEndDate: '2027-12-31',
  }, { ...intake, season: 'FALL' });
  assert.match(ambiguous.error, /ambiguous/i);
});

test('program start rejects normalized invalid dates and times', () => {
  const intake = { season: 'WINTER', year: 2027, timezone: 'UTC' };
  for (const academicStartDate of [
    '2027-02-30T09:30',
    '2027-01-15T24:00',
    '2027-01-15T09:60',
  ]) {
    const result = validateOfferingAcademicPeriod({
      academicStartDate,
      academicEndDate: '2027-03-31',
    }, intake);
    assert.match(result.error, /valid local date and time/i, academicStartDate);
  }
});
