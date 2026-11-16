import { useParticipants } from '@livekit/components-react';
import { Check, Copy, X } from 'lucide-react';
import { useState } from 'react';
import { displayName, formatElapsed, isHostParticipant } from './participantMeta.js';

const when = (value) => new Date(value).toLocaleString([], {
  weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
});

export default function InfoPanel({ liveClass, elapsedMs, onClose }) {
  const participants = useParticipants();
  const [copied, setCopied] = useState(false);
  const hosts = participants.filter(isHostParticipant).map(displayName);
  const endsAt = new Date(new Date(liveClass.startsAt).getTime() + liveClass.durationMins * 60_000);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/live-classes/${liveClass.id}/room`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked */ }
  };

  const rows = [
    ['Class', liveClass.title],
    liveClass.course && ['Course', liveClass.course.title],
    liveClass.cohort && ['Cohort', liveClass.cohort.name],
    ['Host', hosts.length ? hosts.join(', ') : 'Not in the room yet'],
    ['Scheduled', `${when(liveClass.startsAt)} – ${endsAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`],
    ['Length', `${liveClass.durationMins} minutes`],
    ['Time in class', formatElapsed(elapsedMs)],
  ].filter(Boolean);

  return (
    <section className="rt-panel-body" aria-label="Meeting information">
      <header className="rt-panel-head">
        <h2>Meeting information</h2>
        <button type="button" className="rt-icon-btn" onClick={onClose} aria-label="Close meeting information"><X size={18} /></button>
      </header>
      <dl className="rt-info">
        {rows.map(([term, value]) => (
          <div key={term}><dt>{term}</dt><dd>{value}</dd></div>
        ))}
      </dl>
      {liveClass.description && <p className="rt-info-desc">{liveClass.description}</p>}
      <button type="button" className="rt-wide-btn" onClick={copyLink}>
        {copied ? <><Check size={16} /> Link copied</> : <><Copy size={16} /> Copy class link</>}
      </button>
      <small className="rt-panel-note">Only people assigned to this class can open the link.</small>
    </section>
  );
}
