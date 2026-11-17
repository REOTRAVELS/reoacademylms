// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('shows the server reference when registration fails', async () => {
    applicationsAPI.offerings.mockResolvedValue({
      data: {
        data: [{
          id: 'offering-1',
          programme: { title: 'Travel Management' },
          intake: { gateNumber: 1, season: 'WINTER', year: 2027 },
        }],
      },
    });
    register.mockRejectedValue({
      response: {
        status: 500,
        data: { message: 'Internal server error', requestId: 'request-123' },
      },
    });
    render(<MemoryRouter><RegisterPage /></MemoryRouter>);

    fireEvent.change(await screen.findByLabelText(/First name/), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText(/Last name/), { target: { value: 'Learner' } });
    fireEvent.change(screen.getByLabelText(/Email address/), { target: { value: 'ada@example.test' } });
    fireEvent.change(screen.getByLabelText(/Program and Intake/), { target: { value: 'offering-1' } });
    fireEvent.change(screen.getByLabelText(/Password/), { target: { value: 'secure-password' } });
    fireEvent.change(screen.getByLabelText(/Confirm password/), { target: { value: 'secure-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(screen.getByText('Internal server error (Reference: request-123)')).toBeTruthy();
    });
  });

  it('explains when registration could not reach the server', async () => {
    applicationsAPI.offerings.mockResolvedValue({
      data: {
        data: [{
          id: 'offering-1',
          programme: { title: 'Travel Management' },
          intake: { gateNumber: 1, season: 'WINTER', year: 2027 },
        }],
      },
    });
    register.mockRejectedValue(new Error('Network Error'));
    render(<MemoryRouter><RegisterPage /></MemoryRouter>);

    fireEvent.change(await screen.findByLabelText(/First name/), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText(/Last name/), { target: { value: 'Learner' } });
    fireEvent.change(screen.getByLabelText(/Email address/), { target: { value: 'ada@example.test' } });
    fireEvent.change(screen.getByLabelText(/Program and Intake/), { target: { value: 'offering-1' } });
    fireEvent.change(screen.getByLabelText(/Password/), { target: { value: 'secure-password' } });
    fireEvent.change(screen.getByLabelText(/Confirm password/), { target: { value: 'secure-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(screen.getByText('Could not reach the server. Check your connection and try again.')).toBeTruthy();
    });
  });
});
