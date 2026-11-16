// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { liveClassesAPI, cohortsAPI } = vi.hoisted(() => ({
  liveClassesAPI: { list: vi.fn() },
  cohortsAPI: { list: vi.fn() },
}));

vi.mock('../../services/api', () => ({ liveClassesAPI, cohortsAPI }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { role: 'STUDENT' } }) }));

import LiveClassesPage from './LiveClassesPage';

describe('LiveClassesPage', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    liveClassesAPI.list.mockResolvedValue({ data: { data: [] } });
  });

  afterEach(cleanup);

  it('renders the empty schedule instead of leaving a blank page', async () => {
    render(<MemoryRouter><LiveClassesPage /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Live classes' })).toBeTruthy();
    expect(await screen.findByText('No classes scheduled')).toBeTruthy();
    expect(cohortsAPI.list).not.toHaveBeenCalled();
  });
});
