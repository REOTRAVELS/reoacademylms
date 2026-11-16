// @vitest-environment jsdom

import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
  cleanup, fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import { ScreenSharePresets } from 'livekit-client';

const mocks = vi.hoisted(() => {
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: { getDisplayMedia: vi.fn() },
  });
  return { setScreenShareEnabled: vi.fn() };
});

vi.mock('@livekit/components-react', () => ({
  useLocalParticipant: () => ({
    localParticipant: { setScreenShareEnabled: mocks.setScreenShareEnabled },
    isMicrophoneEnabled: true,
    isCameraEnabled: true,
    isScreenShareEnabled: false,
  }),
  useLocalParticipantPermissions: () => ({ canPublish: true }),
}));

import MeetingToolbar from './MeetingToolbar.jsx';

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

afterEach(cleanup);

describe('MeetingToolbar screen sharing', () => {
  it('requests browser tab audio and prioritizes smooth motion when sharing', () => {
    const notify = vi.fn();
    render(
      <MeetingToolbar
        panel={null}
        onPanel={vi.fn()}
        handRaised={false}
        onToggleHand={vi.fn()}
        onReaction={vi.fn()}
        unread={0}
        moreItems={[]}
        onLeave={vi.fn()}
        notify={notify}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Present your screen' }));

    expect(mocks.setScreenShareEnabled).toHaveBeenCalledWith(true, {
      audio: true,
      systemAudio: 'include',
      contentHint: 'motion',
      resolution: ScreenSharePresets.h720fps30.resolution,
    }, {
      screenShareEncoding: ScreenSharePresets.h720fps30.encoding,
      degradationPreference: 'maintain-framerate',
    });
    expect(notify).not.toHaveBeenCalled();
  });

  it('shows an actionable message when the browser blocks screen sharing', async () => {
    const notify = vi.fn();
    mocks.setScreenShareEnabled.mockRejectedValueOnce(
      new DOMException('Permission denied', 'NotAllowedError'),
    );
    render(
      <MeetingToolbar
        panel={null}
        onPanel={vi.fn()}
        handRaised={false}
        onToggleHand={vi.fn()}
        onReaction={vi.fn()}
        unread={0}
        moreItems={[]}
        onLeave={vi.fn()}
        notify={notify}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Present your screen' }));

    await waitFor(() => {
      expect(notify).toHaveBeenCalledWith(
        'Screen sharing was blocked or cancelled. Choose a screen or browser tab in the browser prompt and allow sharing.',
        'error',
      );
    });
  });
});
