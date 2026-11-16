// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { applicationsAPI, register } = vi.hoisted(() => ({
  applicationsAPI: { offerings: vi.fn() },
  register: vi.fn(),
}));

vi.mock('../../services/api', () => ({ applicationsAPI }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ register }) }));

import RegisterPage from './RegisterPage';

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

afterEach(cleanup);

describe('RegisterPage', () => {
  it('shows an API error instead of claiming there are no open offerings', async () => {
    applicationsAPI.offerings.mockRejectedValue({
      response: { data: { message: 'API route not found.' } },
    });
    render(<MemoryRouter><RegisterPage /></MemoryRouter>);

    expect(await screen.findByText('API route not found.')).toBeTruthy();
    expect(screen.queryByText(/There are no open Program offerings right now/i)).toBeNull();
  });

  it('shows the empty state when the API successfully returns no offerings', async () => {
    applicationsAPI.offerings.mockResolvedValue({ data: { data: [] } });
    render(<MemoryRouter><RegisterPage /></MemoryRouter>);

    expect(await screen.findByText(/There are no open Program offerings right now/i)).toBeTruthy();
  });
});
