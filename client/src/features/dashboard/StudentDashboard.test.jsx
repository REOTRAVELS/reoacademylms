// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const { dashboardAPI, progressAPI, refreshUser } = vi.hoisted(() => ({
  dashboardAPI: { student: vi.fn() },
  progressAPI: { mine: vi.fn() },
  refreshUser: vi.fn(),
}));

vi.mock('../../services/api', () => ({ dashboardAPI, progressAPI }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ refreshUser }) }));

import StudentDashboard from './StudentDashboard.jsx';

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  dashboardAPI.student.mockResolvedValue({
    data: {
      data: {
        enrolments: [{
          cohort: {
            name: 'Spring Intake',
            courses: [{ course: { id: 'course-1', title: 'Travel Operations', description: 'Plan trips.' } }],
          },
        }],
        attempts: [],
        notifications: [],
        upcomingAssessments: [],
        upcomingLiveClasses: [],
        accessState: 'ELIGIBLE',
      },
    },
  });
  progressAPI.mine.mockResolvedValue({
    data: {
      data: [{
        lessonId: 'lesson-1',
        completed: false,
        lesson: {
          id: 'lesson-1',
          title: 'Route basics',
          module: { course: { id: 'course-1' } },
        },
      }],
    },
  });
});

afterEach(cleanup);

describe('StudentDashboard', () => {
  it('links continuing learners directly back to the last lesson they opened', async () => {
    render(<MemoryRouter><StudentDashboard /></MemoryRouter>);

    const resumeLink = await screen.findByRole('link', { name: /Continue at Route basics/ });
    expect(resumeLink.getAttribute('href')).toBe('/courses/course-1?lesson=lesson-1');
    expect(screen.getByText('Continue at Route basics')).toBeTruthy();
  });

  it('shows examination results as pending until they are released', async () => {
    dashboardAPI.student.mockResolvedValue({
      data: {
        data: {
          enrolments: [],
          attempts: [{
            id: 'exam-attempt-1',
            startedAt: new Date().toISOString(),
            score: null,
            maxScore: null,
            resultsPending: true,
            status: 'GRADED',
            assessment: { title: 'Final examination' },
          }],
          notifications: [],
          upcomingAssessments: [],
          upcomingLiveClasses: [],
          accessState: 'ELIGIBLE',
        },
      },
    });

    render(<MemoryRouter><StudentDashboard /></MemoryRouter>);

    expect(await screen.findByText('Result pending release')).toBeTruthy();
    expect(screen.queryByText('9/10')).toBeNull();
  });

  it('shows a pre-Intake countdown without requesting academic progress', async () => {
    const start = new Date(Date.now() + 60 * 60 * 1000);
    dashboardAPI.student.mockResolvedValue({
      data: {
        data: {
          accessState: 'WAITING_FOR_INTAKE',
          serverNow: new Date().toISOString(),
          intake: {
            academicStartDate: start.toISOString(),
            timezone: 'UTC',
            programmeTitle: 'Travel Operations',
            gateNumber: 1,
            season: 'WINTER',
            year: 2027,
          },
        },
      },
    });

    render(<MemoryRouter><StudentDashboard /></MemoryRouter>);

    expect(await screen.findByText('Your learning journey begins soon.')).toBeTruthy();
    expect(screen.getByText('Travel Operations')).toBeTruthy();
    expect(screen.getByText(/Starts in/)).toBeTruthy();
    expect(progressAPI.mine).not.toHaveBeenCalled();
  });

  it('revalidates with the server when the countdown reaches zero', async () => {
    vi.useFakeTimers();
    const serverNow = new Date(Date.now());
    dashboardAPI.student
      .mockResolvedValueOnce({
        data: {
          data: {
            accessState: 'WAITING_FOR_INTAKE',
            serverNow: serverNow.toISOString(),
            intake: {
              academicStartDate: new Date(serverNow.getTime() + 2_000).toISOString(),
              timezone: 'UTC',
              programmeTitle: 'Travel Operations',
              gateNumber: 1,
              season: 'WINTER',
              year: 2027,
            },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: {
            accessState: 'ELIGIBLE',
            enrolments: [{
              cohort: {
                name: 'Spring Intake',
                courses: [{ course: { id: 'course-1', title: 'Travel Operations', description: 'Plan trips.' } }],
              },
            }],
            attempts: [],
            notifications: [],
            upcomingAssessments: [],
            upcomingLiveClasses: [],
          },
        },
      });

    render(<MemoryRouter><StudentDashboard /></MemoryRouter>);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText('Your learning journey begins soon.')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
      await Promise.resolve();
    });

    expect(screen.getByText('Every new skill takes you further.')).toBeTruthy();
    expect(dashboardAPI.student).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('does not render NaN countdown values when the server timestamp is invalid', async () => {
    dashboardAPI.student.mockResolvedValue({
      data: {
        data: {
          accessState: 'WAITING_FOR_INTAKE',
          serverNow: 'invalid',
          intake: {
            academicStartDate: 'invalid',
            timezone: 'UTC',
            programmeTitle: 'Travel Operations',
            gateNumber: 1,
            season: 'WINTER',
            year: 2027,
          },
        },
      },
    });

    render(<MemoryRouter><StudentDashboard /></MemoryRouter>);

    expect(await screen.findByText('Start time unavailable')).toBeTruthy();
    expect(screen.queryByText(/NaN/)).toBeNull();
    expect(progressAPI.mine).not.toHaveBeenCalled();
  });
});
