// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { notificationsAPI } = vi.hoisted(() => ({
  notificationsAPI: {
    listForReview: vi.fn(),
    classificationOptions: vi.fn(),
    classify: vi.fn(),
  },
}));

vi.mock('../../services/api', () => ({ notificationsAPI }));

import NotificationReviewPage from './NotificationReviewPage';

const notification = {
  id: 'old-notification',
  audienceStatus: 'UNCLASSIFIED',
  isGlobal: false,
  programmeId: null,
  programOfferingId: null,
  type: 'INFO',
  title: 'Welcome update',
  body: 'Historical content stays unchanged.',
  read: false,
  createdAt: '2026-10-01T10:00:00.000Z',
  user: { firstName: 'Sam', lastName: 'Student', email: 'sam@example.test' },
  classificationHistory: [],
};

const programme = { id: 'programme-1', title: 'Travel Operations' };
const offering = {
  id: 'offering-1',
  programmeId: programme.id,
  programme,
  intake: { gateNumber: 1, season: 'WINTER', year: 2027 },
};

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  notificationsAPI.listForReview.mockResolvedValue({
    data: { data: { items: [notification], nextCursor: null } },
  });
  afterEach(cleanup);
  notificationsAPI.classificationOptions.mockResolvedValue({
    data: { data: { programmes: [programme], offerings: [offering] } },
  });
  notificationsAPI.classify.mockResolvedValue({ data: { success: true } });
});

describe('NotificationReviewPage', () => {
  it('requires an explicit audience and sends global classification only after selection', async () => {
    render(<NotificationReviewPage />);
    const audience = await screen.findByRole('combobox', { name: /Audience classification for Welcome update/i });
    const save = screen.getByRole('button', { name: /Save classification/i });

    expect(audience.value).toBe('');
    expect(save.disabled).toBe(true);
    expect(screen.getByText(/hidden from students until an administrator explicitly classifies/i)).toBeTruthy();
    expect(screen.queryByText(/Choose Global only if the original message was meant for everyone/i)).toBeNull();

    fireEvent.change(audience, { target: { value: 'GLOBAL' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(notificationsAPI.classify).toHaveBeenCalledWith(
      notification.id,
      { audienceType: 'GLOBAL' },
    ));
  });

  it('requires an Offering selection and never submits a client-supplied Program id for it', async () => {
    render(<NotificationReviewPage />);
    const audience = await screen.findByRole('combobox', { name: /Audience classification for Welcome update/i });
    fireEvent.change(audience, { target: { value: 'OFFERING' } });

    const offeringSelect = await screen.findByRole('combobox', { name: /Program Offering for Welcome update/i });
    expect(offeringSelect.options[1].textContent).toContain('GATE 01 WINTER 2027');
    expect(screen.getByRole('button', { name: /Save classification/i }).disabled).toBe(true);
    fireEvent.change(offeringSelect, { target: { value: offering.id } });
    fireEvent.click(screen.getByRole('button', { name: /Save classification/i }));

    await waitFor(() => expect(notificationsAPI.classify).toHaveBeenCalledWith(
      notification.id,
      { audienceType: 'OFFERING', programOfferingId: offering.id },
    ));
  });
});
