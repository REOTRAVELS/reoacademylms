import { describe, expect, it } from 'vitest';
import { validateIntakePeriod } from './intakeValidation';

describe('validateIntakePeriod', () => {
  it('accepts each academy GATE month range', () => {
    const intakes = [
      { season: 'WINTER', year: 2027, admissionStartDate: '2027-01-01', admissionEndDate: '2027-01-14', academicStartDate: '2027-01-15', academicEndDate: '2027-03-31' },
      { season: 'SPRING', year: 2027, admissionStartDate: '2027-04-01', admissionEndDate: '2027-04-05', academicStartDate: '2027-04-06', academicEndDate: '2027-06-30' },
      { season: 'SUMMER', year: 2027, admissionStartDate: '2027-07-01', admissionEndDate: '2027-07-05', academicStartDate: '2027-07-06', academicEndDate: '2027-09-30' },
      { season: 'FALL', year: 2027, admissionStartDate: '2027-10-01', admissionEndDate: '2027-10-05', academicStartDate: '2027-10-06', academicEndDate: '2027-12-31' },
    ];

    for (const intake of intakes) {
      expect(validateIntakePeriod(intake)).toBe('');
    }
  });

  it('rejects admission or academic dates outside the selected GATE year and months', () => {
    const error = validateIntakePeriod({
      season: 'WINTER',
      year: 2027,
      admissionStartDate: '2026-12-31',
      admissionEndDate: '2027-01-14',
      academicStartDate: '2027-01-15',
      academicEndDate: '2027-03-31',
    });

    expect(error).toMatch(/admission start must fall within/i);
  });

  it('accepts a local academic start datetime and rejects incomplete values', () => {
    const intake = {
      season: 'WINTER',
      year: 2027,
      admissionStartDate: '2027-01-01',
      admissionEndDate: '2027-01-14',
      academicStartDate: '2027-01-15T09:30',
      academicEndDate: '2027-03-31',
    };
    expect(validateIntakePeriod(intake)).toBe('');
    expect(validateIntakePeriod({ ...intake, academicStartDate: '' })).toMatch(/academic start must be a valid date and time/i);
  });
});
