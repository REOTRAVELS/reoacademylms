import { describe, expect, it } from 'vitest';
import { navItems } from './navConfig';

describe('role navigation', () => {
  it('uses Intake navigation instead of exposing Cohorts in the sidebar', () => {
    const adminItems = navItems('SUPER_ADMIN');
    const trainerItems = navItems('TRAINER');

    expect(adminItems.some(({ label }) => label === 'Cohorts')).toBe(false);
    expect(trainerItems.some(({ label }) => label === 'Cohorts')).toBe(false);
    expect(adminItems.some(({ label, href }) => label === 'Intakes' && href === '/intakes')).toBe(true);
  });
});
