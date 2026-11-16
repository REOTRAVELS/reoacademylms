// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { authAPI } = vi.hoisted(() => ({
  authAPI: { acceptInvitation: vi.fn() },
}));

vi.mock('../../services/api', () => ({ authAPI }));

import AcceptInvitePage from './AcceptInvitePage';

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

afterEach(cleanup);

const acceptInvitation = async (role) => {
  authAPI.acceptInvitation.mockResolvedValue({ data: { data: { role } } });
  render(
    <MemoryRouter initialEntries={['/accept-invite/token']}>
      <Routes>
        <Route path="/accept-invite/:token" element={<AcceptInvitePage />} />
        <Route path="/pending" element={<p>Student application access</p>} />
        <Route path="/dashboard" element={<p>Academy dashboard</p>} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText(/New password/i), {
    target: { value: 'secure-password-123' },
  });
  fireEvent.change(screen.getByLabelText(/Confirm password/i), {
    target: { value: 'secure-password-123' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Activate account/i }));
  await waitFor(() => expect(authAPI.acceptInvitation).toHaveBeenCalledWith({
    token: 'token',
    password: 'secure-password-123',
    confirmPassword: 'secure-password-123',
  }));
};

describe('AcceptInvitePage', () => {
  it('sends invited students to their application page after accepting', async () => {
    await acceptInvitation('STUDENT');
    expect(await screen.findByText('Student application access')).toBeTruthy();
  });

  it('keeps trainers going to the dashboard after accepting', async () => {
    await acceptInvitation('TRAINER');
    expect(await screen.findByText('Academy dashboard')).toBeTruthy();
  });
});
