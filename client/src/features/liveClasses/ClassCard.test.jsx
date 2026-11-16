// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { liveClassesAPI } = vi.hoisted(() => ({
  liveClassesAPI: {
    listRecordings: vi.fn(),
    recordingPlayback: vi.fn(),
    report: vi.fn(),
  },
}));

vi.mock('../../services/api', () => ({ liveClassesAPI }));

import ClassCard from './ClassCard';

const liveClass = {
  id: 'class-1',
  title: 'Travel Operations',
  status: 'ENDED',
  startsAt: '2027-01-15T10:00:00.000Z',
  durationMins: 60,
  course: { title: 'Travel Operations' },
  cohort: { name: 'GATE 01 Winter 2027' },
};

const recording = {
  id: 'recording-1',
  status: 'COMPLETE',
  startedAt: '2027-01-15T10:05:00.000Z',
};

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  liveClassesAPI.listRecordings.mockResolvedValue({ data: { data: [recording] } });
  liveClassesAPI.recordingPlayback.mockResolvedValue({
    data: { data: { playbackUrl: 'https://storage.example.test/signed-download' } },
  });
});

afterEach(cleanup);

describe('ClassCard recordings', () => {
  it('renders the session report for staff-only classes without course or cohort relations', async () => {
    const staffOnlyClass = { ...liveClass, course: null, cohort: null };
    liveClassesAPI.report.mockResolvedValue({
      data: {
        data: {
          liveClass: staffOnlyClass,
          participants: {
            registered: 0, attended: 0, attendance: [], nextCursor: null,
          },
          interactions: { items: [], nextCursor: null },
          engagement: {},
        },
      },
    });

    render(
      <ClassCard
        liveClass={staffOnlyClass}
        now={new Date('2027-01-16T10:00:00.000Z')}
        canManage
        busy={false}
        onJoin={vi.fn()}
        onStart={vi.fn()}
        onCancel={vi.fn()}
        onReschedule={vi.fn()}
        onExport={vi.fn()}
        onError={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Session report/i }));

    expect(await screen.findByText('Staff-only class')).toBeTruthy();
  });

  it('requests a signed attachment and downloads the recording to this device', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(
      <ClassCard
        liveClass={liveClass}
        now={new Date('2027-01-16T10:00:00.000Z')}
        canManage
        busy={false}
        onJoin={vi.fn()}
        onStart={vi.fn()}
        onCancel={vi.fn()}
        onReschedule={vi.fn()}
        onExport={vi.fn()}
        onError={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Recordings/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Download to this device/i }));

    await waitFor(() => expect(liveClassesAPI.recordingPlayback).toHaveBeenCalledWith('recording-1', true));
    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
  });

  it('requires confirmation before deleting a past class and its history', async () => {
    const onDelete = vi.fn();
    render(
      <ClassCard
        liveClass={liveClass}
        now={new Date('2027-01-16T10:00:00.000Z')}
        canManage
        busy={false}
        onJoin={vi.fn()}
        onStart={vi.fn()}
        onCancel={vi.fn()}
        onReschedule={vi.fn()}
        onDelete={onDelete}
        onExport={vi.fn()}
        onError={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Delete class/i }));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Delete permanently/i }));

    expect(onDelete).toHaveBeenCalledWith(liveClass);
  });
});
