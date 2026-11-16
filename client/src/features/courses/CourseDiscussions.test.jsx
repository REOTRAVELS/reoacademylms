// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CourseDiscussions from './CourseDiscussions.jsx';
import { courseDiscussionsAPI } from '../../services/api';

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'student-1' } }),
}));

vi.mock('../../services/api', () => ({
  courseDiscussionsAPI: {
    list: vi.fn(),
    create: vi.fn(),
    replies: vi.fn(),
    reply: vi.fn(),
    updatePost: vi.fn(),
    removePost: vi.fn(),
    report: vi.fn(),
    moderate: vi.fn(),
    reports: vi.fn(),
    reviewReport: vi.fn(),
    moderationHistory: vi.fn(),
  },
}));

const offering = {
  id: 'offering-1',
  intake: { gateNumber: 1, season: 'WINTER', year: 2027 },
};

const topic = {
  id: 'topic-1',
  type: 'TOPIC',
  title: 'How do we plan accessible routes?',
  body: 'I would appreciate advice on checking accessibility.',
  authorId: 'student-2',
  author: { id: 'student-2', firstName: 'Ari', lastName: 'Learner', role: { name: 'STUDENT' } },
  createdAt: '2026-11-14T10:00:00.000Z',
  replyCount: 1,
  isPinned: false,
  isLocked: false,
  isResolved: false,
  isAnnouncement: false,
};

const listResponse = (items = [topic], canModerate = false) => ({
  data: {
    data: {
      items,
      nextCursor: null,
      offerings: [offering],
      permissions: { canModerate, canCreateAnnouncement: canModerate },
    },
  },
});

const renderDiscussions = (role = 'STUDENT') => render(
  <CourseDiscussions courseId="course-1" courseTitle="Travel Operations" role={role} />,
);

beforeEach(() => {
  vi.clearAllMocks();
  courseDiscussionsAPI.list.mockResolvedValue(listResponse());
  courseDiscussionsAPI.replies.mockResolvedValue({ data: { data: { items: [], nextCursor: null } } });
  courseDiscussionsAPI.create.mockResolvedValue({ data: { data: topic } });
  courseDiscussionsAPI.reply.mockResolvedValue({ data: { data: {} } });
  courseDiscussionsAPI.updatePost.mockResolvedValue({ data: { data: {} } });
  courseDiscussionsAPI.removePost.mockResolvedValue({ data: { data: {} } });
  courseDiscussionsAPI.report.mockResolvedValue({ data: { data: {} } });
  courseDiscussionsAPI.moderate.mockResolvedValue({ data: { data: {} } });
  courseDiscussionsAPI.reports.mockResolvedValue({ data: { data: { items: [] } } });
  courseDiscussionsAPI.reviewReport.mockResolvedValue({ data: { data: {} } });
  courseDiscussionsAPI.moderationHistory.mockResolvedValue({ data: { data: { items: [] } } });
});

afterEach(cleanup);

describe('CourseDiscussions', () => {
  it('lists, searches, creates topics, and replies using the selected offering', async () => {
    renderDiscussions();
    expect(await screen.findByRole('heading', { name: 'How do we plan accessible routes?' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Accessible itinerary tips' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'What should I check before recommending a route?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post topic' }));

    await waitFor(() => expect(courseDiscussionsAPI.create).toHaveBeenCalledWith('course-1', expect.objectContaining({
      title: 'Accessible itinerary tips',
      programOfferingId: 'offering-1',
    })));

    fireEvent.click(screen.getByRole('button', { name: /1 replies/ }));
    await waitFor(() => expect(courseDiscussionsAPI.replies).toHaveBeenCalledWith('topic-1', { limit: 10 }));
    fireEvent.change(screen.getByLabelText('Write a reply'), { target: { value: 'Check the route details with the provider.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    await waitFor(() => expect(courseDiscussionsAPI.reply).toHaveBeenCalledWith('topic-1', {
      body: 'Check the route details with the provider.',
    }));

    fireEvent.change(screen.getByLabelText('Search discussions'), { target: { value: 'accessibility' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(courseDiscussionsAPI.list).toHaveBeenLastCalledWith('course-1', expect.objectContaining({
      search: 'accessibility',
      programOfferingId: 'offering-1',
    })));
  });

  it('lets students report another author’s post and keeps the report visible as submitted', async () => {
    renderDiscussions();
    await screen.findByRole('heading', { name: 'How do we plan accessible routes?' });

    fireEvent.click(screen.getByRole('button', { name: 'Report How do we plan accessible routes?' }));
    fireEvent.change(screen.getByLabelText('Additional context (optional)'), {
      target: { value: 'This contains unrelated advertising.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));

    await waitFor(() => expect(courseDiscussionsAPI.report).toHaveBeenCalledWith('topic-1', expect.objectContaining({
      reason: 'SPAM',
      details: 'This contains unrelated advertising.',
    })));
    expect(await screen.findByText('Reported')).toBeTruthy();
  });

  it('gives assigned Tutors announcement and moderation tools with an auditable history view', async () => {
    courseDiscussionsAPI.list.mockResolvedValue(listResponse([topic], true));
    courseDiscussionsAPI.moderationHistory.mockResolvedValue({
      data: {
        data: {
          items: [{
            id: 'moderation-1',
            action: 'REMOVE',
            reason: 'Contains private information.',
            createdAt: '2026-11-14T11:00:00.000Z',
            actor: { id: 'tutor-1', firstName: 'Tara', lastName: 'Tutor', role: { name: 'TRAINER' } },
            post: { id: 'topic-removed', type: 'TOPIC', title: 'Removed topic', body: 'Private content', deletedAt: '2026-11-14T11:00:00.000Z' },
          }],
        },
      },
    });
    renderDiscussions('TRAINER');
    await screen.findByRole('heading', { name: 'How do we plan accessible routes?' });
    expect(screen.getByLabelText('Post as a Tutor announcement')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Pin discussion' }));
    await waitFor(() => expect(courseDiscussionsAPI.moderate).toHaveBeenCalledWith('topic-1', { action: 'PIN' }));

    fireEvent.click(screen.getByRole('button', { name: 'Moderation history' }));
    await waitFor(() => expect(courseDiscussionsAPI.moderationHistory).toHaveBeenCalledWith({
      courseId: 'course-1',
      programOfferingId: 'offering-1',
    }));
    expect(await screen.findByRole('heading', { name: 'Moderation history' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restore removed content' }));
    fireEvent.change(screen.getByLabelText('Reason for restoration'), {
      target: { value: 'The post was reviewed and is safe.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Restore content' }));
    await waitFor(() => expect(courseDiscussionsAPI.moderate).toHaveBeenLastCalledWith('topic-removed', {
      action: 'RESTORE',
      reason: 'The post was reviewed and is safe.',
    }));
  });
});
