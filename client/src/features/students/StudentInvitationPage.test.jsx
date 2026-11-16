// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { authAPI } = vi.hoisted(() => ({
  authAPI: { createInvitation: vi.fn() },
}));

vi.mock('../../services/api', () => ({ authAPI }));

import StudentInvitationPage from './StudentInvitationPage';

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

afterEach(cleanup);

describe('StudentInvitationPage', () => {
  it('creates a student invitation and shows the secure link', async () => {
    authAPI.createInvitation.mockResolvedValue({
      data: {
        data: {
          invitationUrl: 'https://academy.example.test/accept-invite/student-token',
          emailSent: true,
        },
      },
    });
    render(<MemoryRouter><StudentInvitationPage /></MemoryRouter>);

    fireEvent.change(await screen.findByRole('textbox', { name: /Student email/i }), {
      target: { value: 'student@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Create invitation/i }));

    await waitFor(() => expect(authAPI.createInvitation).toHaveBeenCalledWith({
      email: 'student@example.test',
      role: 'STUDENT',
    }));
    expect((await screen.findByRole('status')).textContent).toMatch(/invitation emailed/i);
    expect(screen.getByRole('textbox', { name: /Student invitation link/i }).value)
      .toBe('https://academy.example.test/accept-invite/student-token');
  });

  it('shows API errors when a student invitation cannot be created', async () => {
    authAPI.createInvitation.mockRejectedValue({
      response: { data: { message: 'An account already exists for this email address.' } },
    });
    render(<MemoryRouter><StudentInvitationPage /></MemoryRouter>);

    fireEvent.change(await screen.findByRole('textbox', { name: /Student email/i }), {
      target: { value: 'student@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Create invitation/i }));

    await waitFor(() => expect(authAPI.createInvitation).toHaveBeenCalledWith({
      email: 'student@example.test',
      role: 'STUDENT',
    }));
    expect((await screen.findByRole('alert')).textContent)
      .toMatch(/account already exists/i);
  });
});
