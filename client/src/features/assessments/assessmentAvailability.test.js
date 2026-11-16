import { describe, expect, it } from 'vitest';
import { getAssessmentAvailability } from './assessmentAvailability';

const now = new Date('2026-11-11T12:00:00.000Z');

describe('getAssessmentAvailability', () => {
  it('allows assessments at both availability boundaries', () => {
    expect(getAssessmentAvailability({
      availableFrom: now.toISOString(),
      availableTo: now.toISOString(),
    }, now).available).toBe(true);
  });

  it('identifies assessments that have not opened', () => {
    expect(getAssessmentAvailability({
      availableFrom: '2026-11-11T12:00:01.000Z',
      availableTo: null,
    }, now)).toEqual({
      available: false,
      message: `Opens ${new Date('2026-11-11T12:00:01.000Z').toLocaleString()}`,
    });
  });

  it('identifies assessments whose availability window has closed', () => {
    expect(getAssessmentAvailability({
      availableFrom: null,
      availableTo: '2026-11-11T11:59:59.999Z',
    }, now)).toEqual({
      available: false,
      message: 'Availability window closed',
    });
  });
});
