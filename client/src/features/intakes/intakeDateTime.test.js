import { describe, expect, it } from 'vitest';
import { formatIntakeDate, toDateTimeLocal } from './intakeDateTime';

describe('Intake date-time display', () => {
  it('formats the academic start as a local datetime in the Intake timezone', () => {
    expect(toDateTimeLocal('2027-01-15T14:30:00.000Z', 'America/New_York'))
      .toBe('2027-01-15T09:30');
  });

  it('keeps date-only Intake fields on their calendar day', () => {
    expect(formatIntakeDate('2027-01-15T00:00:00.000Z')).not.toBe('Date unavailable');
  });
});
