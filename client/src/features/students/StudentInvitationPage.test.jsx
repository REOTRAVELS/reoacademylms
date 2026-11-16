// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { authAPI } = vi.hoisted(() => ({
  authAPI: { sendStudentApplicationLink: vi.fn() },
}));

vi.mock('../../services/api', () => ({ authAPI }));

import StudentInvitationPage from './StudentInvitationPage';

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

afterEach(cleanup);

describe('StudentInvitationPage', () => {
  it('emails the application link without creating a student account', async () => {
    authAPI.sendStudentApplicationLink.mockResolvedValue({ data: { success: true } });
    render(<MemoryRouter><StudentInvitationPage /></MemoryRouter>);

    fireEvent.change(screen.getByRole('textbox', { name: /Applicant email/i }), {
      target: { value: 'applicant@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Email application link/i }));

    await waitFor(() => expect(authAPI.sendStudentApplicationLink).toHaveBeenCalledWith({
      email: 'applicant@example.test',
    }));
    expect((await screen.findByRole('status')).textContent).toMatch(/application link emailed/i);
  });

  it('shows SMTP delivery errors so the administrator can use the copyable link', async () => {
    authAPI.sendStudentApplicationLink.mockRejectedValue({
      response: { data: { message: 'Email delivery is not configured.' } },
    });
    render(<MemoryRouter><StudentInvitationPage /></MemoryRouter>);

    fireEvent.change(screen.getByRole('textbox', { name: /Applicant email/i }), {
      target: { value: 'applicant@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Email application link/i }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/Email delivery is not configured/i);
    expect(screen.getByRole('textbox', { name: /Student application link/i })).toBeTruthy();
  });
});
