// @vitest-environment jsdom

import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
  cleanup, render, screen, waitFor,
} from '@testing-library/react';

const mocks = vi.hoisted(() => {
  const cameraTrack = { stop: vi.fn() };
  const microphoneTrack = { stop: vi.fn() };
  const cameraStream = { getTracks: () => [cameraTrack] };
  const microphoneStream = { getTracks: () => [microphoneTrack] };
  const mediaDevices = {
    enumerateDevices: vi.fn().mockResolvedValue([
      { kind: 'audioinput', deviceId: 'microphone-1', label: 'Microphone' },
      { kind: 'videoinput', deviceId: 'camera-1', label: 'Camera' },
    ]),
    getUserMedia: vi.fn((constraints) => Promise.resolve(
      constraints.audio ? microphoneStream : cameraStream,
    )),
  };
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: mediaDevices,
  });
  return {
    mediaDevices,
    cameraStream,
    microphoneStream,
    contexts: [],
  };
});

import PreJoinLobby from './PreJoinLobby.jsx';

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.contexts.length = 0;
  Object.defineProperty(window, 'AudioContext', {
    configurable: true,
    value: vi.fn(function createAudioContext() {
      const analyser = {
        fftSize: 0,
        frequencyBinCount: 128,
        getByteTimeDomainData: (data) => data.fill(150),
      };
      const context = {
        state: 'suspended',
        resume: vi.fn(async () => { context.state = 'running'; }),
        createAnalyser: vi.fn(() => analyser),
        createMediaStreamSource: vi.fn(() => ({ connect: vi.fn() })),
        close: vi.fn().mockResolvedValue(),
      };
      mocks.contexts.push(context);
      return context;
    }),
  });
  Object.defineProperty(window, 'requestAnimationFrame', {
    configurable: true,
    value: vi.fn(() => 1),
  });
  Object.defineProperty(window, 'cancelAnimationFrame', {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
    configurable: true,
    get() { return this._srcObject; },
    set(value) { this._srcObject = value; },
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: vi.fn().mockResolvedValue(),
  });
});

afterEach(cleanup);

describe('PreJoinLobby media preview', () => {
  it('starts the camera preview and resumes the microphone level meter', async () => {
    render(
      <PreJoinLobby
        liveClass={{ title: 'Test class', status: 'LIVE' }}
        user={{ id: 'user-1', firstName: 'Test', lastName: 'User' }}
        canPublish
        joining={false}
        error=""
        onJoin={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
      expect(mocks.contexts.some((context) => context.resume.mock.calls.length > 0)).toBe(true);
    });

    expect(screen.getByRole('img', { name: 'Microphone level' }).firstChild.style.transform)
      .not.toBe('scaleX(0)');
  });
});
