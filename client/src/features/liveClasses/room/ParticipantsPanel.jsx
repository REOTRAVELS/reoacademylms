import { useMemo } from 'react';
import { useParticipants } from '@livekit/components-react';
import {
  Mic, MicOff, Video, VideoOff, X, UserCheck, UserX,
} from 'lucide-react';
import useParticipantState from './useParticipantState.js';
import {
  avatarTone, displayName, initialsOf, isHostParticipant,
} from './participantMeta.js';

function Row({ participant, handRaised, viewerIsHost, onLowerHand, onSetSpeaking }) {
  const state = useParticipantState(participant);
  const name = displayName(participant);
  const host = isHostParticipant(participant);
  const canGrant = viewerIsHost && !participant.isLocal && !host;

  return (
    <li className="rt-person">
      <span className="rt-avatar rt-avatar--sm" style={{ '--tone': avatarTone(participant.identity) }} aria-hidden="true">
        {initialsOf(name)}
      </span>
      <div className="rt-person-main">
        <strong>{name}{participant.isLocal ? ' (You)' : ''}</strong>
        {host && <span className="rt-badge">Host</span>}
      </div>
      <div className="rt-person-status">
        {handRaised && (
          <span className="rt-status is-hand" role="img" aria-label="Hand raised">✋🏽</span>
        )}
        <span className={`rt-status${state.micOn ? '' : ' is-off'}`} role="img" aria-label={state.micOn ? 'Microphone on' : 'Microphone off'}>
          {state.micOn ? <Mic size={15} /> : <MicOff size={15} />}
        </span>
        <span className={`rt-status${state.camOn ? '' : ' is-off'}`} role="img" aria-label={state.camOn ? 'Camera on' : 'Camera off'}>
          {state.camOn ? <Video size={15} /> : <VideoOff size={15} />}
        </span>
      </div>
      {(canGrant || (viewerIsHost && handRaised && !participant.isLocal)) && (
        <div className="rt-person-actions">
          {handRaised && !participant.isLocal && (
            <button type="button" onClick={() => onLowerHand(participant.identity)}>Lower hand</button>
          )}
          {canGrant && (
            <button
              type="button"
              onClick={() => onSetSpeaking(participant.identity, !state.canPublish)}
              aria-label={state.canPublish ? `Stop ${name} from speaking` : `Let ${name} speak and share`}
            >
              {state.canPublish ? <><UserX size={14} /> Revoke speaking</> : <><UserCheck size={14} /> Allow to speak</>}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export default function ParticipantsPanel({
  hands, viewerIsHost, onClose, onLowerHand, onSetSpeaking,
}) {
  const participants = useParticipants();
  const sorted = useMemo(() => [...participants].sort((a, b) => {
    const ha = hands.has(a.identity) ? 0 : 1;
    const hb = hands.has(b.identity) ? 0 : 1;
    if (ha !== hb) return ha - hb;
    const ra = isHostParticipant(a) ? 0 : a.isLocal ? 1 : 2;
    const rb = isHostParticipant(b) ? 0 : b.isLocal ? 1 : 2;
    return ra - rb || displayName(a).localeCompare(displayName(b));
  }), [participants, hands]);

  return (
    <section className="rt-panel-body" aria-label="Participants">
      <header className="rt-panel-head">
        <h2>People <span className="rt-count">{participants.length}</span></h2>
        <button type="button" className="rt-icon-btn" onClick={onClose} aria-label="Close participants"><X size={18} /></button>
      </header>
      {hands.size > 0 && (
        <p className="rt-panel-note"><span className="rt-hand-emoji rt-hand-emoji--small" aria-hidden="true">✋🏽</span> {hands.size} {hands.size === 1 ? 'hand' : 'hands'} raised</p>
      )}
      <ul className="rt-people">
        {sorted.map((p) => (
          <Row
            key={p.identity}
            participant={p}
            handRaised={hands.has(p.identity)}
            viewerIsHost={viewerIsHost}
            onLowerHand={onLowerHand}
            onSetSpeaking={onSetSpeaking}
          />
        ))}
      </ul>
    </section>
  );
}
