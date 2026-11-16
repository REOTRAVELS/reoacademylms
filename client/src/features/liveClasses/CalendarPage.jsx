import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { liveClassesAPI } from '../../services/api';
import { Button } from '../../components/common/Button';

const viewOptions = ['DAY', 'WEEK', 'MONTH', 'AGENDA'];
const dateKey = (date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const addDays = (date, count) => {
  const result = new Date(date);
  result.setDate(result.getDate() + count);
  return result;
};
const formatTime = (date) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);

function getRange(date, view) {
  const start = startOfDay(date);
  if (view === 'DAY') return { start, end: addDays(start, 1) };
  if (view === 'WEEK') {
    start.setDate(start.getDate() - start.getDay());
    return { start, end: addDays(start, 7) };
  }
  if (view === 'AGENDA') return { start, end: addDays(start, 30) };
  start.setDate(1);
  const firstDay = new Date(start);
  firstDay.setDate(firstDay.getDate() - firstDay.getDay());
  return { start: firstDay, end: addDays(firstDay, 42) };
}

const isJoinable = (liveClass) => {
  if (!liveClass?.startsAt) return false;
  if (liveClass.status === 'CANCELLED' || liveClass.status === 'ENDED') return false;
  if (liveClass.status === 'LIVE') return true;
  const start = new Date(liveClass.startsAt).getTime();
  const classEnd = start + Number(liveClass.durationMins || 60) * 60_000;
  const now = Date.now();
  return now >= start - 40 * 60_000 && now < classEnd;
};

function EventItem({ liveClass, onExport }) {
  const startsAt = new Date(liveClass.startsAt);
  const details = [
    liveClass.course?.title || (liveClass.cohort?.name ? 'General class' : 'Staff-only class'),
    liveClass.cohort?.name,
  ].filter(Boolean).join(' · ');
  return (
    <article className="calendar-event">
      <span className={`badge badge-${liveClass.status.toLowerCase()}`}>{liveClass.status}</span>
      <strong>{liveClass.title}</strong>
      <span>{formatTime(startsAt)} · {liveClass.durationMins} min</span>
      <small>{details}</small>
      <div className="calendar-event-actions">
        {isJoinable(liveClass) && <Link className="btn btn-sm btn-primary" to={`/live-classes/${liveClass.id}/room`}>Join class</Link>}
        <Button size="sm" variant="secondary" onClick={() => onExport(liveClass)}>Export .ics</Button>
      </div>
    </article>
  );
}

export default function CalendarPage() {
  const [classes, setClasses] = useState([]);
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));
  const [view, setView] = useState('WEEK');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadCalendar = useCallback(async () => {
    setError('');
    try {
      const { data } = await liveClassesAPI.list();
      setClasses(data.data);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not load your class timetable.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCalendar();
  }, [loadCalendar]);

  const range = useMemo(() => getRange(selectedDate, view), [selectedDate, view]);
  const visibleClasses = useMemo(() => classes
    .filter(({ startsAt }) => {
      const start = new Date(startsAt);
      return start >= range.start && start < range.end;
    })
    .sort((left, right) => new Date(left.startsAt) - new Date(right.startsAt)), [classes, range]);

  const exportCalendar = async (liveClass) => {
    try {
      const { data } = await liveClassesAPI.exportCalendar(liveClass.id);
      const url = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `live-class-${liveClass.id}.ics`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not export this calendar event.');
    }
  };

  const moveRange = (direction) => {
    const next = new Date(selectedDate);
    if (view === 'DAY') next.setDate(next.getDate() + direction);
    else if (view === 'WEEK') next.setDate(next.getDate() + direction * 7);
    else if (view === 'AGENDA') next.setDate(next.getDate() + direction * 30);
    else next.setMonth(next.getMonth() + direction);
    setSelectedDate(next);
  };

  const heading = new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric',
    ...(view === 'DAY' ? { day: 'numeric' } : {}),
  }).format(selectedDate);
  const monthDays = view === 'MONTH'
    ? Array.from({ length: 42 }, (_, index) => addDays(range.start, index))
    : [];
  const classesForDay = (day) => classes.filter((liveClass) => dateKey(new Date(liveClass.startsAt)) === dateKey(day));

  return (
    <div className="page-container calendar-page">
      <header className="page-header">
        <div><span className="eyebrow">Academic timetable</span><h1>Calendar</h1><p>Your scheduled live classes, filtered to your courses and cohorts.</p></div>
        <Link className="btn btn-secondary" to="/live-classes">Manage live classes</Link>
      </header>
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      <section className="card calendar-toolbar" aria-label="Calendar controls">
        <div className="calendar-navigation">
          <Button variant="secondary" onClick={() => moveRange(-1)} aria-label="Previous period">‹</Button>
          <Button variant="secondary" onClick={() => setSelectedDate(startOfDay(new Date()))}>Today</Button>
          <Button variant="secondary" onClick={() => moveRange(1)} aria-label="Next period">›</Button>
          <h2>{heading}</h2>
        </div>
        <div className="calendar-view-switch" role="group" aria-label="Calendar view">
          {viewOptions.map((option) => (
            <Button
              key={option}
              size="sm"
              variant={view === option ? 'primary' : 'secondary'}
              aria-pressed={view === option}
              onClick={() => setView(option)}
            >{option[0] + option.slice(1).toLowerCase()}</Button>
          ))}
        </div>
      </section>
      {loading ? <p>Loading calendar…</p> : view === 'MONTH'
        ? <section className="calendar-month-grid" aria-label="Monthly calendar">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <strong className="calendar-weekday" key={day}>{day}</strong>)}
            {monthDays.map((day) => (
              <button
                type="button"
                className={`calendar-month-day${day.getMonth() === selectedDate.getMonth() ? '' : ' outside-month'}`}
                key={dateKey(day)}
                onClick={() => { setSelectedDate(day); setView('DAY'); }}
              >
                <span>{day.getDate()}</span>
                {classesForDay(day).slice(0, 2).map((liveClass) => <small key={liveClass.id}>{liveClass.title}</small>)}
                {classesForDay(day).length > 2 && <small>+{classesForDay(day).length - 2} more</small>}
              </button>
            ))}
          </section>
        : visibleClasses.length === 0
          ? <section className="card empty-state"><h2>No scheduled classes in this period</h2><p>Classes for your courses and cohort will appear here.</p></section>
          : <section className={`calendar-events${view === 'DAY' ? ' single-day' : ''}`} aria-label={`${view.toLowerCase()} calendar events`}>
            {visibleClasses.map((liveClass) => (
              <EventItem key={liveClass.id} liveClass={liveClass} onExport={exportCalendar} />
            ))}
          </section>}
    </div>
  );
}
