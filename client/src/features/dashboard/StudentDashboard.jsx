import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Bell, BookOpen, CalendarDays, CalendarClock, ClipboardCheck, GraduationCap, ShieldCheck, Sparkles, Video } from 'lucide-react';
import { dashboardAPI, progressAPI } from '../../services/api';
import { statusClass, statusLabel } from '../../components/common/navConfig';
import DashboardLoadError from './DashboardLoadError';
import { useAuth } from '../../hooks/useAuth';
import { formatIntakeStart } from '../intakes/intakeDateTime';

const formatCountdown = (milliseconds) => {
  if (!Number.isFinite(milliseconds)) return null;
  const totalSeconds = Math.ceil(Math.max(0, milliseconds) / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { days, hours, minutes, seconds };
};

export default function StudentDashboard() {
  const [data, setData] = useState(null);
  const [progress, setProgress] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [receivedAt, setReceivedAt] = useState(Date.now());
  const [clock, setClock] = useState(Date.now());
  const revalidatedAt = useRef(0);
  const firstLoad = useRef(true);
  const { refreshUser } = useAuth();

  useEffect(() => {
    let cancelled = false;
    if (firstLoad.current) setLoading(true);
    setError('');
    const load = async () => {
      try {
        const { data: response } = await dashboardAPI.student();
        if (cancelled) return;
        const dashboard = response.data;
        setData(dashboard);
        setReceivedAt(Date.now());
        setClock(Date.now());
        if (dashboard.accessState === 'WAITING_FOR_INTAKE') {
          setProgress([]);
          return;
        }
        const progressResponse = await progressAPI.mine();
        if (cancelled) return;
        setProgress(progressResponse.data.data || []);
        await refreshUser();
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError.response?.data?.message || 'Could not load your learning overview.');
        }
      } finally {
        if (!cancelled) {
          firstLoad.current = false;
          setLoading(false);
        }
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [retryKey, refreshUser]);

  useEffect(() => {
    if (data?.accessState !== 'WAITING_FOR_INTAKE') return undefined;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [data?.accessState]);

  const waitingForIntake = data?.accessState === 'WAITING_FOR_INTAKE';
  const startTime = waitingForIntake ? new Date(data.intake.academicStartDate).getTime() : 0;
  const serverTime = waitingForIntake ? new Date(data.serverNow).getTime() : 0;
  const remaining = waitingForIntake
    ? Number.isFinite(startTime) && Number.isFinite(serverTime)
      ? Math.max(0, startTime - serverTime - (clock - receivedAt))
      : Number.NaN
    : 0;

  useEffect(() => {
    if (!waitingForIntake || !Number.isFinite(remaining) || remaining > 0
      || Date.now() - revalidatedAt.current < 30_000) return;
    revalidatedAt.current = Date.now();
    setRetryKey((key) => key + 1);
    void refreshUser();
  }, [waitingForIntake, remaining, refreshUser]);

  useEffect(() => {
    if (!waitingForIntake) return undefined;
    const refreshWhenVisible = () => {
      if (document.visibilityState !== 'visible') return;
      revalidatedAt.current = Date.now();
      setRetryKey((key) => key + 1);
      void refreshUser();
    };
    const timer = window.setInterval(refreshWhenVisible, 60_000);
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [waitingForIntake, refreshUser]);

  if (loading) return <div className="card loading-card">Gathering your learning journey…</div>;
  if (error) {
    return <div className="page-stack"><DashboardLoadError message={error} onRetry={() => setRetryKey((key) => key + 1)} /></div>;
  }
  if (waitingForIntake) {
    const countdown = formatCountdown(remaining);
    return (
      <div className="page-stack intake-countdown-page">
        <section className="intake-waiting-hero">
          <div className="intake-waiting-copy">
            <div className="intake-waiting-brand">
              <img src="/reo.png" alt="" />
              <span>REO TRAVEL ACADEMY<small>LEARN · LEAD · EXCEL</small></span>
            </div>
            <span className="intake-waiting-pill"><Sparkles size={14} /> Your place is confirmed</span>
            <h1>Your learning journey begins soon.</h1>
            <p>You’re officially enrolled. Your learning space is being prepared, and your courses will unlock automatically when your Intake begins.</p>
            <div className="intake-waiting-program">
              <span className="intake-waiting-program-icon"><GraduationCap size={21} /></span>
              <span><small>YOUR PROGRAM</small><strong>{data.intake.programmeTitle}</strong><small>GATE {String(data.intake.gateNumber).padStart(2, '0')} · {data.intake.season} {data.intake.year}</small></span>
            </div>
            <div className="intake-waiting-assurance"><ShieldCheck size={16} /> Approved enrollment · secure access at your start time</div>
          </div>
          <div className="intake-countdown" role={countdown ? 'timer' : 'status'} aria-label={countdown ? 'Time until Intake starts' : 'Intake start time unavailable'}>
            <div className="intake-countdown-heading">
              <span className="intake-countdown-kicker"><CalendarClock size={15} /> THE COUNTDOWN IS ON</span>
              <strong>{countdown ? 'Class begins in' : 'Start time unavailable'}</strong>
            </div>
            {countdown ? <div className="intake-countdown-values">
              {[
                ['Days', countdown.days],
                ['Hours', countdown.hours],
                ['Minutes', countdown.minutes],
                ['Seconds', countdown.seconds],
              ].map(([label, value]) => (
                <span key={label}><strong>{String(value).padStart(2, '0')}</strong><small>{label}</small></span>
              ))}
            </div> : <p className="intake-countdown-error">The official start time could not be read. Access remains controlled by the academy server.</p>}
            <div className="intake-countdown-date">
              <CalendarDays size={17} />
              <span><strong>{formatIntakeStart(data.intake.academicStartDate, data.intake.timezone)}</strong><small>{data.intake.timezone}</small></span>
            </div>
          </div>
          <span className="intake-waiting-orbit intake-waiting-orbit-one" aria-hidden="true" />
          <span className="intake-waiting-orbit intake-waiting-orbit-two" aria-hidden="true" />
        </section>
        <section className="intake-waiting-next-steps" aria-label="What happens next">
          <article>
            <span className="intake-next-icon"><ShieldCheck size={19} /></span>
            <span><strong>You’re all set</strong><small>Your approved place in this program is secured.</small></span>
          </article>
          <article>
            <span className="intake-next-icon"><CalendarClock size={19} /></span>
            <span><strong>We’ll keep time</strong><small>This countdown updates live and checks your access at launch.</small></span>
          </article>
          <article>
            <span className="intake-next-icon"><GraduationCap size={19} /></span>
            <span><strong>Learning unlocks automatically</strong><small>Coursework stays protected until your official start time.</small></span>
          </article>
        </section>
      </div>
    );
  }
  const enrolments = data?.enrolments || [];
  const attempts = data?.attempts || [];
  const notifications = data?.notifications || [];
  const upcomingAssessments = data?.upcomingAssessments || [];
  const upcomingLiveClasses = data?.upcomingLiveClasses || [];
  const courses = enrolments.flatMap((enrolment) => (enrolment.cohort?.courses || []).map((entry) => ({
    ...entry.course,
    cohort: enrolment.cohort.name,
  })));
  const uniqueCourses = [...new Map(courses.map((course) => {
    const lastProgress = progress.find((item) => item.lesson?.module?.course?.id === course.id);
    return [course.id, {
      ...course,
      lastAccessedLesson: lastProgress?.lesson,
    }];
  })).values()];

  return (
    <div className="page-stack">
      <section className="welcome-banner student-banner">
        <div className="welcome-content">
          <span className="eyebrow eyebrow-light">Your learning journey</span>
          <h1>Every new skill takes you further.</h1>
          <p>Pick up a course, practice what you know, and keep moving forward.</p>
          <Link className="welcome-link" to="/courses">Continue learning <ArrowUpRight size={16} /></Link>
        </div>
        <div className="welcome-art" aria-hidden="true"><GraduationCap size={61} strokeWidth={1} /></div>
      </section>
      <section className="stat-grid student-stat-grid">
        <article className="stat-card"><span className="stat-icon stat-icon-teal"><BookOpen size={20} /></span><span className="stat-copy"><span className="stat-label">My courses</span><strong className="stat-value">{uniqueCourses.length}</strong><span className="stat-note">Across {enrolments.length} cohort{enrolments.length === 1 ? '' : 's'}</span></span></article>
        <article className="stat-card"><span className="stat-icon stat-icon-gold"><ClipboardCheck size={20} /></span><span className="stat-copy"><span className="stat-label">Lessons completed</span><strong className="stat-value">{progress.filter((item) => item.completed).length}</strong><span className="stat-note">{attempts.length} recent assessment{attempts.length === 1 ? '' : 's'}</span></span></article>
        <Link className="stat-card stat-card-link" to="/assessments"><span className="stat-icon stat-icon-coral"><Bell size={20} /></span><span className="stat-copy"><span className="stat-label">Unread updates</span><strong className="stat-value">{notifications.length}</strong><span className="stat-note">See your learning updates</span></span><ArrowUpRight className="stat-arrow" size={17} /></Link>
        <Link className="stat-card stat-card-link" to="/assessments"><span className="stat-icon stat-icon-violet"><ClipboardCheck size={20} /></span><span className="stat-copy"><span className="stat-label">Available assessments</span><strong className="stat-value">{upcomingAssessments.length}</strong><span className="stat-note">Ready to begin</span></span><ArrowUpRight className="stat-arrow" size={17} /></Link>
        <Link className="stat-card stat-card-link" to="/live-classes"><span className="stat-icon stat-icon-teal"><Video size={20} /></span><span className="stat-copy"><span className="stat-label">Upcoming classes</span><strong className="stat-value">{upcomingLiveClasses.length}</strong><span className="stat-note">For your enrolled cohorts</span></span><ArrowUpRight className="stat-arrow" size={17} /></Link>
      </section>

      <div className="dashboard-grid">
        <section className="card dashboard-panel">
          <div className="card-heading"><div><span className="eyebrow">Ready when you are</span><h2>Available assessments</h2></div><Link className="text-link" to="/assessments">View assessments <ArrowUpRight size={15} /></Link></div>
          {upcomingAssessments.length ? <div className="activity-list">{upcomingAssessments.map((assessment) => (
            <Link className="activity-row" to="/assessments" key={assessment.id}>
              <span className="activity-dot" />
              <span className="activity-description"><strong>{assessment.title}</strong><small>{assessment.course.title}</small></span>
              <span className="badge active">Available</span>
            </Link>
          ))}</div> : <div className="empty-state"><h3>No assessments available</h3><p>Assessments assigned to your enrolled courses will appear here.</p></div>}
        </section>
        <section className="card dashboard-panel">
          <div className="card-heading"><div><span className="eyebrow">On your timetable</span><h2>Upcoming live classes</h2></div><Link className="text-link" to="/live-classes">View classes <ArrowUpRight size={15} /></Link></div>
          {upcomingLiveClasses.length ? <div className="activity-list">{upcomingLiveClasses.map((liveClass) => (
            <Link className="activity-row" to="/live-classes" key={liveClass.id}>
              <span className="activity-dot" />
              <span className="activity-description"><strong>{liveClass.title}</strong><small>{liveClass.course.title} · {liveClass.cohort.name}</small></span>
              <time><CalendarDays size={13} /> {new Date(liveClass.startsAt).toLocaleString()}</time>
            </Link>
          ))}</div> : <div className="empty-state"><h3>No upcoming classes</h3><p>New sessions for your enrolled cohorts will appear here.</p></div>}
        </section>
      </div>

      <section className="card dashboard-panel">
        <div className="card-heading"><div><span className="eyebrow">Learning in motion</span><h2>Continue your courses</h2></div><Link className="text-link" to="/courses">All courses <ArrowUpRight size={15} /></Link></div>
        {uniqueCourses.length ? <div className="student-course-grid">{uniqueCourses.slice(0, 4).map((course, index) => (
          <Link
            className="student-course-card"
            to={`/courses/${course.id}${course.lastAccessedLesson ? `?lesson=${encodeURIComponent(course.lastAccessedLesson.id)}` : ''}`}
            key={course.id}
          >
            <span className={`student-course-symbol student-course-symbol-${index % 3}`}><BookOpen size={20} /></span>
            <span className="eyebrow">{course.cohort}</span>
            <strong>{course.title}</strong>
            <small>{course.lastAccessedLesson
              ? `Continue at ${course.lastAccessedLesson.title}`
              : course.description || 'Open your course to explore the learning materials.'}</small>
            <span className="student-course-link">{course.lastAccessedLesson ? 'Continue learning' : 'Open course'} <ArrowUpRight size={15} /></span>
          </Link>
        ))}</div> : <div className="empty-state"><h3>No courses yet</h3><p>Your enrolled cohort courses will appear here when they are assigned.</p></div>}
      </section>

      <section className="card dashboard-panel">
        <div className="card-heading"><div><span className="eyebrow">Recent activity</span><h2>Assessment results</h2></div></div>
        {attempts.length ? <div className="student-result-list">{attempts.map((attempt) => (
          <div className="student-result-row" key={attempt.id}>
            <span className="assessment-icon"><ClipboardCheck size={18} /></span>
            <span><strong>{attempt.assessment.title}</strong><small>{new Date(attempt.startedAt).toLocaleDateString()}</small></span>
            <span className="attempt-score">{attempt.resultsPending ? 'Result pending release' : attempt.score !== null ? `${attempt.score}/${attempt.maxScore}` : '—'}</span>
            <span className={statusClass(attempt.status)}>{statusLabel(attempt.status)}</span>
          </div>
        ))}</div> : <div className="empty-state"><h3>No assessment activity</h3><p>Completed attempts and results will appear here.</p></div>}
      </section>
    </div>
  );
}
