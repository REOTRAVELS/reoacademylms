import { useEffect, useRef, useState } from 'react';
import { useLocalParticipant, useLocalParticipantPermissions } from '@livekit/components-react';
import { ScreenSharePresets } from 'livekit-client';
import {
  MessageSquare, Mic, MicOff, MonitorUp, MoreHorizontal, PhoneOff, Smile, Users, Video, VideoOff, MonitorX,
} from 'lucide-react';
import ToolButton from './ToolButton.jsx';
import ReactionPicker from './ReactionPicker.jsx';
import MoreMenu from './MoreMenu.jsx';
import { friendlyMediaError } from './mediaErrors.js';

const canShareScreen = typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function';
const LOCKED = 'The host controls who can speak. Raise your hand to ask.';

export default function MeetingToolbar({
  panel, onPanel, handRaised, onToggleHand, onReaction, unread, moreItems, onLeave, notify,
}) {
  const {
    localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled,
  } = useLocalParticipant();
  const permissions = useLocalParticipantPermissions();
  const canPublish = permissions?.canPublish ?? false;
  const [reactOpen, setReactOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const reactRef = useRef(null);

  useEffect(() => {
    if (!reactOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setReactOpen(false); };
    const onDown = (e) => { if (!reactRef.current?.contains(e.target)) setReactOpen(false); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [reactOpen]);

  const run = async (key, device, action) => {
    if (busy) return;
    setBusy(key);
    try {
      await action();
    } catch (error) {
      if (key === 'share' && error?.name === 'NotAllowedError') {
        notify('Screen sharing was blocked or cancelled. Choose a screen or browser tab in the browser prompt and allow sharing.', 'error');
        return;
      }
      if (key === 'share' && /cancel|dismiss/i.test(error?.message || '')) return;
      notify(friendlyMediaError(error, device));
    } finally {
      setBusy('');
    }
  };

  const lockedProps = canPublish ? {} : { 'aria-disabled': true, className: 'is-locked' };
  const guard = (fn) => (canPublish ? fn : () => notify(LOCKED));
  const toggleScreenShare = () => (
    isScreenShareEnabled
      ? localParticipant.setScreenShareEnabled(false)
      : localParticipant.setScreenShareEnabled(
        true,
        {
          audio: true,
          systemAudio: 'include',
          contentHint: 'motion',
          resolution: ScreenSharePresets.h720fps30.resolution,
        },
        {
          screenShareEncoding: ScreenSharePresets.h720fps30.encoding,
          degradationPreference: 'maintain-framerate',
        },
      )
  );

  return (
    <footer className="rt-dock-wrap">
      <div className="rt-dock" role="toolbar" aria-label="Meeting controls">
        <div className="rt-group">
          <ToolButton
            label={isMicrophoneEnabled ? 'Turn off microphone' : 'Turn on microphone'}
            tip={canPublish ? (isMicrophoneEnabled ? 'Mute' : 'Unmute') : LOCKED}
            active={!isMicrophoneEnabled && canPublish}
            danger={!isMicrophoneEnabled && canPublish}
            {...lockedProps}
            onClick={guard(() => run('mic', 'microphone', () => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)))}
          >
            {isMicrophoneEnabled ? <Mic size={20} /> : <MicOff size={20} />}
          </ToolButton>
          <ToolButton
            label={isCameraEnabled ? 'Turn off camera' : 'Turn on camera'}
            tip={canPublish ? (isCameraEnabled ? 'Turn off camera' : 'Turn on camera') : LOCKED}
            active={!isCameraEnabled && canPublish}
            danger={!isCameraEnabled && canPublish}
            {...lockedProps}
            onClick={guard(() => run('cam', 'camera', () => localParticipant.setCameraEnabled(!isCameraEnabled)))}
          >
            {isCameraEnabled ? <Video size={20} /> : <VideoOff size={20} />}
          </ToolButton>
          {canShareScreen && (
            <ToolButton
              className={`rt-hide-sm${canPublish ? '' : ' is-locked'}`}
              label={isScreenShareEnabled ? 'Stop presenting' : 'Present your screen'}
              tip={canPublish
                ? (isScreenShareEnabled ? 'Stop presenting' : 'Choose a browser tab and enable Share tab audio to capture video sound.')
                : LOCKED}
              pressed={isScreenShareEnabled}
              active={isScreenShareEnabled}
              aria-disabled={canPublish ? undefined : true}
              onClick={guard(() => run('share', 'screen', toggleScreenShare))}
            >
              {isScreenShareEnabled ? <MonitorX size={20} /> : <MonitorUp size={20} />}
            </ToolButton>
          )}
        </div>

        <span className="rt-sep" aria-hidden="true" />

        <div className="rt-group">
          <ToolButton
            label={handRaised ? 'Lower your hand' : 'Raise your hand'}
            pressed={handRaised}
            active={handRaised}
            className="rt-hand-btn"
            onClick={onToggleHand}
          >
            <span className="rt-hand-emoji" aria-hidden="true">✋🏽</span>
          </ToolButton>
          <span className="rt-toolwrap rt-react-wrap" ref={reactRef}>
            <ToolButton
              label="Send a reaction"
              tip="Reactions"
              pressed={reactOpen}
              active={reactOpen}
              aria-haspopup="menu"
              aria-expanded={reactOpen}
              onClick={() => { setMoreOpen(false); setReactOpen((v) => !v); }}
            >
              <Smile size={20} />
            </ToolButton>
            {reactOpen && <ReactionPicker onPick={(emoji) => { onReaction(emoji); }} />}
          </span>
        </div>

        <span className="rt-sep" aria-hidden="true" />

        <div className="rt-group">
          <ToolButton
            label={panel === 'chat' ? 'Close chat' : 'Open chat'}
            tip="Chat"
            pressed={panel === 'chat'}
            active={panel === 'chat'}
            badge={panel !== 'chat' && unread > 0 ? (unread > 9 ? '9+' : unread) : null}
            onClick={() => onPanel('chat')}
          >
            <MessageSquare size={20} />
          </ToolButton>
          <ToolButton
            className="rt-hide-sm"
            label={panel === 'people' ? 'Close participants' : 'Open participants'}
            tip="People"
            pressed={panel === 'people'}
            active={panel === 'people'}
            onClick={() => onPanel('people')}
          >
            <Users size={20} />
          </ToolButton>
          <span className="rt-toolwrap rt-more-wrap">
            <ToolButton
              label="More options"
              tip="More"
              pressed={moreOpen}
              active={moreOpen}
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              data-more-trigger
              onClick={() => { setReactOpen(false); setMoreOpen((v) => !v); }}
            >
              <MoreHorizontal size={20} />
            </ToolButton>
            {moreOpen && <MoreMenu items={moreItems} onClose={() => setMoreOpen(false)} />}
          </span>
        </div>

        <span className="rt-sep" aria-hidden="true" />

        <ToolButton label="Leave class" tip="Leave class" danger className="rt-leave" onClick={onLeave}>
          <PhoneOff size={20} />
          <span className="rt-leave-text">Leave</span>
        </ToolButton>
      </div>
    </footer>
  );
}
