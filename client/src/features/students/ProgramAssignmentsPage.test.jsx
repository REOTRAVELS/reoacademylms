// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { programEnrollmentsAPI } = vi.hoisted(() => ({
  programEnrollmentsAPI: {
    legacyStudents: vi.fn(),
    assignableOfferings: vi.fn(),
    assignmentHistory: vi.fn(),
    assignLegacyStudent: vi.fn(),
  },
}));

vi.mock('../../services/api', () => ({ programEnrollmentsAPI }));

import ProgramAssignmentsPage from './ProgramAssignmentsPage';

const student = {
  id: 'legacy-student',
  firstName: 'Ada',
  lastName: 'Learner',
  email: 'ada@example.test',
  enrolments: [{ cohortId: 'old-cohort', cohort: { name: 'Historic cohort' } }],
};

const offering = {
  id: 'offering-1',
  programme: { id: 'programme-1', title: 'Travel Operations' },
  intake: { id: 'intake-1', gateNumber: 1, season: 'WINTER', year: 2027 },
};

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  programEnrollmentsAPI.legacyStudents.mockResolvedValue({
    data: { data: { items: [student], nextCursor: null } },
  });
  afterEach(cleanup);
  programEnrollmentsAPI.assignableOfferings.mockResolvedValue({
    data: { data: [offering] },
  });
  programEnrollmentsAPI.assignmentHistory.mockResolvedValue({
    data: { data: { items: [], nextCursor: null } },
  });
  programEnrollmentsAPI.assignLegacyStudent.mockResolvedValue({ data: { success: true } });
});

describe('ProgramAssignmentsPage', () => {
  it('shows Program and Intake for confirmation and sends only the selected offering id', async () => {
    render(<ProgramAssignmentsPage />);

    const select = await screen.findByRole('combobox', { name: /Program Offering for Ada Learner/i });
    fireEvent.change(select, { target: { value: offering.id } });
    fireEvent.click(screen.getByRole('button', { name: /Review assignment/i }));

    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByText('Travel Operations')).toBeTruthy();
    expect(screen.getByText('GATE 01 WINTER 2027')).toBeTruthy();
    expect(programEnrollmentsAPI.assignLegacyStudent).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Confirm assignment/i }));
    await waitFor(() => expect(programEnrollmentsAPI.assignLegacyStudent).toHaveBeenCalledWith(
      student.id,
      { programOfferingId: offering.id },
    ));
    expect(await screen.findByRole('status')).toBeTruthy();
  });

  it('keeps assignment disabled until a valid offering is selected without showing obsolete Cohort history', async () => {
    render(<ProgramAssignmentsPage />);
    await screen.findByRole('combobox', { name: /Program Offering for Ada Learner/i });

    expect(screen.getByRole('button', { name: /Review assignment/i }).disabled).toBe(true);
    expect(screen.queryByText(/Cohort/i)).toBeNull();
    expect(screen.queryByText(/academic history/i)).toBeNull();
  });
});
