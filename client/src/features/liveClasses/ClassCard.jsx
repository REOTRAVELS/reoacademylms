import { useState } from 'react';
import {
  BookOpen, CalendarClock, CalendarDays, Download, FileText, Film, Play, Radio, Timer, Trash2, Users,
} from 'lucide-react';
import { joinState, opensAt, untilLabel } from './liveClassWindow.js';
import { localDateTime } from './ScheduleForms.jsx';
import LiveClassReport from './LiveClassReport.jsx';
import { liveClassesAPI } from '../../services/api';

const fmtDate = (v) => new Date(v).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
const fmtTime = (v) => new Date(v).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export default function ClassCard({
  liveClass, now, canManage, busy, onJoin, onStart, onCancel, onReschedule, onDelete, onExport, onError,
}) {
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [rescheduling, setRescheduling] = useState(null);
  const [report, setReport] = useState(false);
  const [recordings, setRecordings] = useState(null);
  const [playing, setPlaying] = useState(null);
  const [downloading, setDownloading] = useState('');

  const state = joinState(liveClass, now);
  const live = liveClass.status === 'LIVE';
  const ended = liveClass.status === 'ENDED';
  const cancelled = liveClass.status === 'CANCELLED';
  const scheduled = liveClass.status === 'SCHEDULED';
  const past = state === 'over' && !live;
  const audience = [liveClass.course?.title, liveClass.cohort?.name].filter(Boolean);

  const statusChip = live
    ? { text: 'Live now', tone: 'live' }
    : cancelled ? { text: 'Cancelled', tone: 'off' }
      : ended || state === 'over' ? { text: 'Ended', tone: 'off' }
        : state === 'open' ? { text: 'Open to join', tone: 'open' }
          : { text: `Opens in ${untilLabel(opensAt(liveClass), now)}`, tone: 'soon' };

  const loadRecordings = async () => {
    if (recordings) { setRecordings(null); return; }
    try {
      const { data } = await liveClassesAPI.listRecordings(liveClass.id);
      setRecordings(data.data);
    } catch (error) { onError(error.response?.data?.message || 'Could not load recordings.'); }
  };
  const play = async (id) => {
    try {
      const { data } = await liveClassesAPI.recordingPlayback(id);
      setPlaying({ id, url: data.data.playbackUrl });
    } catch (error) { onError(error.response?.data?.message || 'Could not play this recording.'); }
  };
  const download = async (id) => {
    setDownloading(id);
    try {
      const { data } = await liveClassesAPI.recordingPlayback(id, true);
      const link = document.createElement('a');
      link.href = data.data.playbackUrl;
      link.download = 'REO-Academy-class-recording.mp4';
      link.rel = 'noreferrer';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      onError(error.response?.data?.message || 'Could not download this recording.');
    } finally {
      setDownloading('');
    }
  };

  return (
    <article className={`lc-card is-${statusChip.tone}`}>
      <div className="lc-card-main">
        <div className="lc-card-top">
          <span className={`lc-status is-${statusChip.tone}`}>
            {live && <i className="lc-dot" aria-hidden="true" />}{statusChip.text}
          </span>
          {!audience.length && <span className="lc-tag">Staff only</span>}
        </div>
        <h3>{liveClass.title}</h3>
        <ul className="lc-meta">
          {audience.length > 0 && (
            <li><BookOpen size={15} />{liveClass.course?.title}{liveClass.course && liveClass.cohort ? '' : ''}</li>
          )}
          {liveClass.cohort && <li><Users size={15} />{liveClass.cohort.name}</li>}
          <li><CalendarDays size={15} />{fmtDate(liveClass.startsAt)}, {fmtTime(liveClass.startsAt)}</li>
          <li><Timer size={15} />{liveClass.durationMins} min</li>
        </ul>
        {liveClass.description && <p className="lc-desc">{liveClass.description}</p>}
        {scheduled && state === 'soon' && (
          <p className="lc-hint"><CalendarClock size={14} /> You can join from {fmtTime(opensAt(liveClass))}, 40 minutes before it starts.</p>
        )}
      </div>

      <div className="lc-card-actions">
        {(live || state === 'open') && (
          <button type="button" className="lc-btn lc-btn--primary" onClick={() => onJoin(liveClass)}>
            <Play size={16} /> {live ? 'Join now' : 'Join class'}
          </button>
        )}
        {canManage && scheduled && state !== 'over' && (
          <button type="button" className="lc-btn lc-btn--live" disabled={busy} onClick={() => onStart(liveClass)}>
            <Radio size={16} /> Start class
          </button>
        )}
      </div>

      <div className="lc-card-tools">
        {canManage && scheduled && state !== 'over' && (
          <>
            <button type="button" className="lc-tool" onClick={() => setRescheduling({ startsAt: localDateTime(new Date(liveClass.startsAt)), durationMins: String(liveClass.durationMins) })}>Reschedule</button>
            {confirmingCancel ? (
              <span className="lc-confirm" role="group" aria-label="Confirm cancel">
                Cancel this class?
                <button type="button" className="lc-tool is-danger" onClick={() => { setConfirmingCancel(false); onCancel(liveClass); }}>Yes, cancel</button>
                <button type="button" className="lc-tool" onClick={() => setConfirmingCancel(false)}>Keep</button>
              </span>
            ) : <button type="button" className="lc-tool is-danger" onClick={() => setConfirmingCancel(true)}>Cancel</button>}
          </>
        )}
        {!live && !cancelled && <button type="button" className="lc-tool" onClick={() => onExport(liveClass)}>Add to calendar</button>}
        {canManage && ended && (
          <>
            <button type="button" className="lc-tool" aria-expanded={report} onClick={() => setReport((v) => !v)}><FileText size={14} /> Session report</button>
            <button type="button" className="lc-tool" aria-expanded={Boolean(recordings)} onClick={loadRecordings}><Film size={14} /> Recordings</button>
          </>
        )}
        {canManage && past && (
          confirmingDelete ? (
            <span className="lc-confirm" role="group" aria-label="Confirm delete past class">
              Delete this class, its attendance, reports, and recordings permanently?
              <button type="button" className="lc-tool is-danger" disabled={busy} onClick={() => { setConfirmingDelete(false); onDelete(liveClass); }}>Delete permanently</button>
              <button type="button" className="lc-tool" disabled={busy} onClick={() => setConfirmingDelete(false)}>Keep</button>
            </span>
          ) : (
            <button type="button" className="lc-tool is-danger" disabled={busy} onClick={() => setConfirmingDelete(true)}>
              <Trash2 size={14} /> Delete class
            </button>
          )
        )}
      </div>

      {rescheduling && (
        <form
          className="lc-inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const done = await onReschedule(liveClass, {
              startsAt: new Date(rescheduling.startsAt).toISOString(),
              durationMins: Number(rescheduling.durationMins),
            });
            if (done) setRescheduling(null);
          }}
        >
          <label className="lc-field"><span>New start</span>
            <input className="lc-input" type="datetime-local" required min={localDateTime(new Date())} value={rescheduling.startsAt} onChange={(e) => setRescheduling((c) => ({ ...c, startsAt: e.target.value }))} />
          </label>
          <label className="lc-field"><span>Minutes</span>
            <input className="lc-input" type="number" min="15" max="480" step="5" required value={rescheduling.durationMins} onChange={(e) => setRescheduling((c) => ({ ...c, durationMins: e.target.value }))} />
          </label>
          <button type="submit" className="lc-btn lc-btn--primary" disabled={busy}>Save new time</button>
          <button type="button" className="lc-btn" onClick={() => setRescheduling(null)}>Keep current time</button>
        </form>
      )}

      {report && <div className="lc-expand"><LiveClassReport liveClass={liveClass} /></div>}
      {recordings && (
        <div className="lc-expand">
          {recordings.length === 0 ? <p className="lc-hint">No recordings are available for this class.</p> : recordings.map((r) => (
            <div className="lc-recording" key={r.id}>
              <span>{r.status === 'STOPPED' && !r.endedAt ? 'Processing' : r.status.charAt(0) + r.status.slice(1).toLowerCase()} · {r.startedAt ? new Date(r.startedAt).toLocaleString() : 'Not started'}</span>
              {r.status === 'COMPLETE' && (
                <>
                  <button type="button" className="lc-btn" onClick={() => play(r.id)}>Play recording</button>
                  <button
                    type="button"
                    className="lc-btn"
                    disabled={downloading === r.id}
                    onClick={() => download(r.id)}
                  >
                    <Download size={15} /> {downloading === r.id ? 'Preparing download…' : 'Download to this device'}
                  </button>
                </>
              )}
              {playing?.id === r.id && <video controls className="lc-video" src={playing.url} />}
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
