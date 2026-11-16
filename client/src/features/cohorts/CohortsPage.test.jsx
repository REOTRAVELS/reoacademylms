// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { cohortsAPI, intakesAPI, programmesAPI } = vi.hoisted(() => ({
  cohortsAPI: { list: vi.fn(), update: vi.fn() },
  intakesAPI: { list: vi.fn() },
  programmesAPI: { list: vi.fn() },
}));

vi.mock('../../services/api', () => ({ cohortsAPI, intakesAPI, programmesAPI }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { role: 'SUPER_ADMIN' } }) }));

import CohortsPage from './CohortsPage';

const cohort = {
  id: 'legacy-cohort',
  name: 'Historic group',
  programmeId: 'programme-1',
  programme: { id: 'programme-1', title: 'Travel Operations', status: 'ACTIVE' },
  intakeProgramOfferingId: null,
  intakeProgramOffering: null,
  status: 'ACTIVE',
  _count: { enrolments: 4 },
};

const offering = {
  id: 'offering-1',
  programmeId: 'programme-1',
  status: 'ACTIVE',
  programme: { id: 'programme-1', title: 'Travel Operations', status: 'ACTIVE' },
  intake: { id: 'intake-1', gateNumber: 1, season: 'WINTER', year: 2027, status: 'ACTIVE' },
};

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  cohortsAPI.list.mockResolvedValue({ data: { data: [cohort] } });
  cohortsAPI.update.mockResolvedValue({ data: { success: true } });
  programmesAPI.list.mockResolvedValue({ data: { data: [cohort.programme] } });
  intakesAPI.list.mockResolvedValue({
    data: { data: [{ id: 'intake-1', gateNumber: 1, season: 'WINTER', year: 2027, status: 'ACTIVE', programOfferings: [offering] }] },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CohortsPage offering scoping', () => {
  it('lets an administrator explicitly associate a legacy teaching group with an offering', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<MemoryRouter><CohortsPage /></MemoryRouter>);

    const select = await screen.findByRole('combobox', { name: /Learning access offering for Historic group/i });
    fireEvent.change(select, { target: { value: offering.id } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(cohortsAPI.update).toHaveBeenCalledWith(
      cohort.id,
      { intakeProgramOfferingId: offering.id },
    ));
    expect(await screen.findByText(/Existing enrolments and academic records were preserved/i)).toBeTruthy();
  });
});
