import { useConnectionQualityIndicator, useLocalParticipant } from '@livekit/components-react';
import { Clock, Radio, SignalHigh, SignalLow, SignalMedium, Users, WifiOff } from 'lucide-react';
import { formatElapsed } from './participantMeta.js';

const QUALITY = {
  excellent: { Icon: SignalHigh, label: 'Excellent connection', tone: 'good' },
  good: { Icon: SignalMedium, label: 'Good connection', tone: 'good' },
  poor: { Icon: SignalLow, label: 'Weak connection', tone: 'warn' },
  lost: { Icon: WifiOff, label: 'Connection lost', tone: 'bad' },
  unknown: { Icon: SignalMedium, label: 'Checking connection', tone: 'idle' },
};

export default function MeetingHeader({
  title, elapsedMs, participantCount, recording, onOpenPeople,
}) {
  const { localParticipant } = useLocalParticipant();
  const { quality } = useConnectionQualityIndicator({ participant: localParticipant });
  const q = QUALITY[quality] || QUALITY.unknown;
  return (
    <header className="rt-header">
      <div className="rt-brand">
        <span className="rt-mark" aria-hidden="true">R</span>
        <span className="rt-brand-name">REO Travel Academy</span>
      </div>
      <span className="rt-divider" aria-hidden="true" />
      <h1 className="rt-title" title={title}>{title}</h1>
      <div className="rt-header-meta">
        {recording && (
          <span className="rt-chip is-rec" role="status"><Radio size={13} /> Recording</span>
        )}
        <span className="rt-chip" title="Time in class"><Clock size={13} /> {formatElapsed(elapsedMs)}</span>
        <span className={`rt-chip rt-quality is-${q.tone}`} title={q.label} role="img" aria-label={q.label}>
          <q.Icon size={15} />
        </span>
        <button type="button" className="rt-chip rt-chip-btn" onClick={onOpenPeople} aria-label={`${participantCount} participants. Open participant list`}>
          <Users size={14} /> {participantCount}
        </button>
      </div>
    </header>
  );
}
