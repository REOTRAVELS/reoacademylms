// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { authAPI, usersAPI } = vi.hoisted(() => ({
  authAPI: { createInvitation: vi.fn() },
  usersAPI: { list: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../services/api', () => ({ authAPI, usersAPI }));

import TrainersPage from './TrainersPage';

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  usersAPI.list.mockResolvedValue({ data: { data: { items: [] } } });
});

afterEach(cleanup);

describe('TrainersPage invitations', () => {
  it('allows invitation without loading role records first', async () => {
    authAPI.createInvitation.mockResolvedValue({
      data: {
        data: {
          invitationUrl: 'https://academy.example.test/accept-invite/trainer-token',
          emailSent: true,
        },
      },
    });
    render(<MemoryRouter><TrainersPage /></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: /Invite trainer/i }));
    fireEvent.change(await screen.findByRole('textbox', { name: /Trainer email/i }), {
      target: { value: 'trainer@example.test' },
    });
    const submit = screen.getByRole('button', { name: /Create invitation/i });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);

    await waitFor(() => expect(authAPI.createInvitation).toHaveBeenCalledWith({
      email: 'trainer@example.test',
      role: 'TRAINER',
    }));
    expect((await screen.findByText(/Invitation emailed to the trainer/i))).toBeTruthy();
  });

  it('shows invitation API errors', async () => {
    authAPI.createInvitation.mockRejectedValue({
      response: { data: { message: 'An account already exists for this email address.' } },
    });
    render(<MemoryRouter><TrainersPage /></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: /Invite trainer/i }));
    fireEvent.change(await screen.findByRole('textbox', { name: /Trainer email/i }), {
      target: { value: 'trainer@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Create invitation/i }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/account already exists/i);
  });
});
