import { useEffect, useState } from 'react';
import { liveClassesAPI } from '../../services/api';
import { Button } from '../../components/common/Button';

const localInputTime = (date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
};

export default function LiveClassReport({ liveClass }) {
  const [report, setReport] = useState(null);
  const [attendanceCursor, setAttendanceCursor] = useState(null);
  const [interactionCursor, setInteractionCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const load = async (cursors = {}, append = false) => {
    setLoading(true);
    setError('');
    try {
      const { data } = await liveClassesAPI.report(liveClass.id, cursors);
      setReport((current) => append && current ? {
        ...data.data,
        participants: {
          ...data.data.participants,
          attendance: [...current.participants.attendance, ...data.data.participants.attendance],
        },
        interactions: {
          ...data.data.interactions,
          items: [...current.interactions.items, ...data.data.interactions.items],
        },
      } : data.data);
      setAttendanceCursor(data.data.participants.nextCursor);
      setInteractionCursor(data.data.interactions.nextCursor);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not load the session report.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [liveClass.id]);

  const verify = async (presenceId) => {
    try {
      await liveClassesAPI.verifyPresence(liveClass.id, presenceId, note);
      setNote('');
      await load({ attendanceCursor, interactionCursor });
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not verify attendance.');
    }
  };

  const correct = async (event, presence) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await liveClassesAPI.correctPresence(liveClass.id, presence.id, {
        joinedAt: new Date(form.get('joinedAt')).toISOString(),
        leftAt: new Date(form.get('leftAt')).toISOString(),
        note: form.get('note'),
      });
      await load({ attendanceCursor, interactionCursor });
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not correct attendance.');
    }
  };

  if (loading && !report) return <p>Loading class report…</p>;
  if (error && !report) return <div className="notice notice-error" role="alert">{error}</div>;
  if (!report) return null;

  return (
    <section className="live-class-report">
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      <header className="classroom-report-heading">
        <div>
          <h2>Session report</h2>
          <p>
            {[report.liveClass.course?.title, report.liveClass.cohort?.name].filter(Boolean).join(' · ')
              || 'Staff-only class'}
          </p>
        </div>
        <span className="badge">{report.liveClass.status}</span>
      </header>
      <div className="classroom-report-stats">
        <div><strong>{report.participants.registered}</strong><span>Registered</span></div>
        <div><strong>{report.participants.attended}</strong><span>Attended</span></div>
        {Object.entries(report.engagement).map(([type, count]) => <div key={type}><strong>{count}</strong><span>{type.replaceAll('_', ' ').toLowerCase()}</span></div>)}
      </div>
      <h3>Attendance intervals</h3>
      <div className="table-responsive"><table className="data-table">
        <thead><tr><th>Participant</th><th>Joined</th><th>Left</th><th>Duration</th><th>Classification</th><th>Verification</th><th>Trainer actions</th></tr></thead>
        <tbody>{report.participants.attendance.map((presence) => <tr key={presence.id}>
          <td>{presence.user.firstName} {presence.user.lastName}</td>
          <td>{new Date(presence.joinedAt).toLocaleString()}</td>
          <td>{presence.leftAt ? new Date(presence.leftAt).toLocaleString() : 'Still connected'}</td>
          <td>{Math.floor(presence.durationSeconds / 60)} min</td>
          <td>{presence.classification}</td>
          <td>{presence.verifiedAt ? `Verified by ${presence.verifiedBy?.firstName || 'trainer'}` : 'Unverified'}</td>
          <td>{!presence.verifiedAt && <div className="classroom-report-actions">
            <label className="sr-only" htmlFor={`verify-${presence.id}`}>Verification note</label>
            <input id={`verify-${presence.id}`} className="input" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Verification note" maxLength={500} />
            <Button size="sm" disabled={note.trim().length < 3} onClick={() => verify(presence.id)}>Verify</Button>
          </div>}
            <details><summary>Correct interval</summary><form onSubmit={(event) => correct(event, presence)}>
              <label>Joined<input className="input" name="joinedAt" type="datetime-local" defaultValue={localInputTime(new Date(presence.joinedAt))} required /></label>
              <label>Left<input className="input" name="leftAt" type="datetime-local" defaultValue={localInputTime(new Date(presence.leftAt || report.liveClass.endedAt || new Date()))} required /></label>
              <label>Reason<input className="input" name="note" minLength={3} maxLength={500} required /></label>
              <Button size="sm" type="submit">Save correction</Button>
            </form></details>
          </td>
        </tr>)}</tbody>
      </table></div>
      <h3>Classroom interactions</h3>
      <div className="classroom-report-interactions">{report.interactions.items.map((item) => <article key={item.id}>
        <strong>{item.type.replaceAll('_', ' ')} · {item.sender.firstName} {item.sender.lastName}</strong>
        <span>{new Date(item.createdAt).toLocaleString()}</span>
        <p>{item.payload.text || item.payload.prompt || item.payload.title || item.payload.response || item.payload.choiceIds?.join(', ')}</p>
        <small>Status: {item.status}</small>
      </article>)}</div>
      {(attendanceCursor || interactionCursor) && <Button variant="secondary" disabled={loading} onClick={() => load({
        ...(attendanceCursor ? { attendanceCursor } : {}),
        ...(interactionCursor ? { interactionCursor } : {}),
      }, true)}>{loading ? 'Loading…' : 'Load more report data'}</Button>}
    </section>
  );
}
