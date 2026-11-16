import { memo } from 'react';
import { VideoTrack, isTrackReference } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { MicOff, Pin, PinOff } from 'lucide-react';
import useParticipantState from './useParticipantState.js';
import { avatarTone, displayName, initialsOf, isHostParticipant } from './participantMeta.js';

function ParticipantTile({
  trackRef, handRaised, pinned, onTogglePin, variant = 'grid', style,
}) {
  const { participant } = trackRef;
  const state = useParticipantState(participant);
  const isScreen = trackRef.source === Track.Source.ScreenShare;
  const name = displayName(participant);
  const isLocal = participant.isLocal;
  const host = isHostParticipant(participant);
  const hasVideo = isTrackReference(trackRef) && !trackRef.publication.isMuted
    && (isScreen || state.camOn);
  const speaking = state.speaking && !isScreen;

  return (
    <div
      className={`rt-tile rt-tile--${variant}${speaking ? ' is-speaking' : ''}${isScreen ? ' is-screen' : ''}`}
      style={style}
      data-participant={participant.identity}
    >
      {hasVideo ? (
        <VideoTrack trackRef={trackRef} className={`rt-video${isLocal && !isScreen ? ' is-mirrored' : ''}`} />
      ) : (
        <div className="rt-avatar-wrap">
          <span
            className="rt-avatar"
            style={{ '--tone': avatarTone(participant.identity) }}
            aria-hidden="true"
          >
            {initialsOf(name)}
          </span>
        </div>
      )}

      {handRaised && !isScreen && (
        <span className="rt-hand" title={`${name} raised a hand`} role="img" aria-label={`${name} raised a hand`}>
          <span aria-hidden="true">✋🏽</span>
        </span>
      )}

      {onTogglePin && (
        <button
          type="button"
          className="rt-pin"
          onClick={onTogglePin}
          aria-label={pinned ? `Unpin ${name}` : `Pin ${name}`}
          aria-pressed={pinned}
        >
          {pinned ? <PinOff size={15} /> : <Pin size={15} />}
        </button>
      )}

      <div className="rt-label">
        {!isScreen && !state.micOn && (
          <span className="rt-label-icon is-muted" title="Microphone off">
            <MicOff size={13} strokeWidth={2.4} aria-label="Microphone off" />
          </span>
        )}
        <span className="rt-name">
          {isScreen ? `${isLocal ? 'Your' : `${name}’s`} screen` : isLocal ? `${name} (You)` : name}
        </span>
        {host && !isScreen && <span className="rt-badge">Host</span>}
      </div>
    </div>
  );
}

export default memo(ParticipantTile);
