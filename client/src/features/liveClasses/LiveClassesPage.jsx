import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CalendarPlus, CheckCircle2, ChevronDown, Video, X, Zap } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { cohortsAPI, liveClassesAPI } from '../../services/api';
import ClassCard from './ClassCard.jsx';
import { InstantForm, ScheduleForm } from './ScheduleForms.jsx';
import { joinState } from './liveClassWindow.js';
import './liveClasses.css';

const messageOf = (error, fallback) => error?.response?.data?.message || fallback;

function Section({ title, count, children }) {
  return (
    <section className="lc-section" aria-label={title}>
      <h2>{title}{count != null && <span>{count}</span>}</h2>
      <div className="lc-list">{children}</div>
    </section>
  );
}

export default function LiveClassesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const role = typeof user?.role === 'string' ? user.role : user?.role?.name;
  const canManage = role === 'SUPER_ADMIN' || role === 'TRAINER';
  const isAdmin = role === 'SUPER_ADMIN';

  const [classes, setClasses] = useState([]);
  const [cohorts, setCohorts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(location.state?.notice || '');
  const [tab, setTab] = useState('schedule');
  const [composerOpen, setComposerOpen] = useState(false);
  const [showAllPast, setShowAllPast] = useState(false);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      const { data } = await liveClassesAPI.list();
      setClasses(data.data);
      setError('');
    } catch (requestError) {
      setError(messageOf(requestError, 'Could not load live classes.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!canManage) return;
    cohortsAPI.list().then(({ data }) => setCohorts(data.data))
      .catch((requestError) => setError(messageOf(requestError, 'Could not load cohorts.')));
  }, [canManage]);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    if (location.state?.notice) navigate(location.pathname, { replace: true, state: null });
  }, [location, navigate]);

  const groups = useMemo(() => {
    const live = []; const upcoming = []; const past = [];
    classes.forEach((c) => {
      const state = joinState(c, now);
      if (c.status === 'LIVE') live.push(c);
      else if (c.status === 'SCHEDULED' && state !== 'over') upcoming.push(c);
      else past.push(c);
    });
    const byStart = (a, b) => new Date(a.startsAt) - new Date(b.startsAt);
    return { live: live.sort(byStart), upcoming: upcoming.sort(byStart), past: past.sort((a, b) => byStart(b, a)) };
  }, [classes, now]);

  const enter = (liveClass) => navigate(`/live-classes/${liveClass.id}/room`);

  const guarded = async (fn, failure) => {
    setError(''); setNotice('');
    try { return await fn(); } catch (requestError) {
      setError(messageOf(requestError, failure));
      return false;
    }
  };

  const schedule = async (payload) => {
    setSaving(true);
    const done = await guarded(async () => {
      await liveClassesAPI.create(payload);
      setNotice('Live class scheduled.');
      await load();
      return true;
    }, 'Could not schedule this class.');
    setSaving(false);
    return done;
  };

  const startInstant = async (payload) => {
    setSaving(true);
    const created = await guarded(async () => (await liveClassesAPI.createEmergency(payload)).data.data, 'Could not start this class.');
    setSaving(false);
    if (created) enter(created);
  };

  const start = async (liveClass) => {
    setBusy(true);
    const ok = await guarded(async () => { await liveClassesAPI.start(liveClass.id); return true; }, 'Could not start this class.');
    setBusy(false);
    if (ok) enter(liveClass);
  };

  const cancel = (liveClass) => guarded(async () => {
    await liveClassesAPI.cancel(liveClass.id);
    setNotice('Class cancelled. Its record and attendance history are kept.');
    await load();
    return true;
  }, 'Could not cancel this class.');

  const deletePast = async (liveClass) => {
    setBusy(true);
    const deleted = await guarded(async () => {
      await liveClassesAPI.delete(liveClass.id);
      setNotice('Past class, attendance, reports, and recordings deleted.');
      await load();
      return true;
    }, 'Could not delete this past class.');
    setBusy(false);
    return deleted;
  };

  const reschedule = async (liveClass, payload) => {
    setBusy(true);
    const done = await guarded(async () => {
      await liveClassesAPI.reschedule(liveClass.id, payload);
      setNotice('Class rescheduled.');
      await load();
      return true;
    }, 'Could not reschedule this class.');
    setBusy(false);
    return done;
  };

  const exportCalendar = (liveClass) => guarded(async () => {
    const { data } = await liveClassesAPI.exportCalendar(liveClass.id);
    const url = URL.createObjectURL(data);
    const link = document.createElement('a');
    link.href = url;
    link.download = `live-class-${liveClass.id}.ics`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return true;
  }, 'Could not export this calendar event.');

  const card = (liveClass) => (
    <ClassCard
      key={liveClass.id}
      liveClass={liveClass}
      now={now}
      canManage={canManage}
      busy={busy}
      onJoin={enter}
      onStart={start}
      onCancel={cancel}
      onReschedule={reschedule}
      onDelete={deletePast}
      onExport={exportCalendar}
      onError={setError}
    />
  );

  const visiblePast = showAllPast ? groups.past : groups.past.slice(0, 4);

  return (
    <div className="page-container lc-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Learning together</span>
          <h1>Live classes</h1>
          <p>{canManage ? 'Host a class for your cohort or schedule one ahead of time.' : 'Join your scheduled sessions. Rooms open 40 minutes before the start time.'}</p>
        </div>
        {canManage && (
          <button type="button" className="lc-btn lc-btn--primary lc-compose-toggle" aria-expanded={composerOpen} onClick={() => setComposerOpen((v) => !v)}>
            {composerOpen ? <><X size={16} /> Close</> : <><CalendarPlus size={16} /> New class</>}
          </button>
        )}
      </header>

      <div className="lc-alerts" aria-live="polite">
        {error && <div className="lc-alert is-error" role="alert"><span>{error}</span><button type="button" aria-label="Dismiss" onClick={() => setError('')}><X size={15} /></button></div>}
        {notice && <div className="lc-alert is-ok" role="status"><CheckCircle2 size={16} /><span>{notice}</span><button type="button" aria-label="Dismiss" onClick={() => setNotice('')}><X size={15} /></button></div>}
      </div>

      <div className={`lc-layout${canManage ? ' has-aside' : ''}`}>
        <div className="lc-main">
          {loading ? (
            <div className="lc-skeletons" aria-busy="true" aria-label="Loading live classes">
              <div className="lc-skel" /><div className="lc-skel" /><div className="lc-skel" />
            </div>
          ) : (
            <>
              {groups.live.length > 0 && <Section title="Live now" count={groups.live.length}>{groups.live.map(card)}</Section>}
              <Section title="Upcoming" count={groups.upcoming.length}>
                {groups.upcoming.length ? groups.upcoming.map(card) : (
                  <div className="lc-empty">
                    <Video size={26} strokeWidth={1.6} />
                    <strong>{groups.live.length ? 'Nothing else scheduled' : 'No classes scheduled'}</strong>
                    <p>{canManage ? 'Schedule a class for a cohort, or start an instant one.' : 'When a class is scheduled for your cohort, it will appear here.'}</p>
                  </div>
                )}
              </Section>
              {groups.past.length > 0 && (
                <Section title="Past classes" count={groups.past.length}>
                  {visiblePast.map(card)}
                  {groups.past.length > 4 && (
                    <button type="button" className="lc-more-btn" onClick={() => setShowAllPast((v) => !v)}>
                      {showAllPast ? 'Show fewer' : `Show all ${groups.past.length}`} <ChevronDown size={15} className={showAllPast ? 'is-flipped' : ''} />
                    </button>
                  )}
                </Section>
              )}
            </>
          )}
        </div>

        {canManage && (
          <aside className={`lc-aside${composerOpen ? ' is-open' : ''}`} aria-label="Create a class">
            <div className="lc-composer">
              {isAdmin ? (
                <div className="lc-tabs" role="tablist" aria-label="Class type">
                  <button type="button" role="tab" aria-selected={tab === 'schedule'} className={tab === 'schedule' ? 'is-on' : ''} onClick={() => setTab('schedule')}><CalendarPlus size={15} /> Schedule</button>
                  <button type="button" role="tab" aria-selected={tab === 'instant'} className={tab === 'instant' ? 'is-on' : ''} onClick={() => setTab('instant')}><Zap size={15} /> Instant class</button>
                </div>
              ) : <h2 className="lc-composer-title">Schedule a live class</h2>}
              {(!isAdmin || tab === 'schedule')
                ? <ScheduleForm cohorts={cohorts} saving={saving} onSubmit={schedule} />
                : <InstantForm cohorts={cohorts} saving={saving} onSubmit={startInstant} />}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
