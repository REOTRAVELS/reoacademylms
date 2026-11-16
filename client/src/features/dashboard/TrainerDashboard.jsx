import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, BookOpen, ClipboardCheck, UsersRound, Video } from 'lucide-react';
import { dashboardAPI } from '../../services/api';
import { statusClass, statusLabel } from '../../components/common/navConfig';
import DashboardLoadError from './DashboardLoadError';

export default function TrainerDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError('');
    dashboardAPI.trainer()
      .then(({ data: response }) => setData(response.data))
      .catch((requestError) => setError(requestError.response?.data?.message || 'Could not load your teaching overview.'))
      .finally(() => setLoading(false));
  }, [retryKey]);

  if (loading) return <div className="card loading-card">Preparing your teaching workspace…</div>;
  if (error) {
    return <div className="page-stack"><DashboardLoadError message={error} onRetry={() => setRetryKey((key) => key + 1)} /></div>;
  }
  const courses = data?.courses || [];
  const cohorts = data?.cohorts || [];
  const metrics = data?.metrics || {};
  const upcomingLiveClasses = data?.upcomingLiveClasses || [];

  return (
    <div className="page-stack">
      <section className="welcome-banner trainer-banner">
        <div className="welcome-content">
          <span className="eyebrow eyebrow-light">Trainer workspace</span>
          <h1>Make learning take off.</h1>
          <p>Your courses, cohorts and teaching tools are all in one place.</p>
          <Link className="welcome-link" to="/courses">Open my courses <ArrowUpRight size={16} /></Link>
        </div>
        <div className="welcome-art" aria-hidden="true"><BookOpen size={58} strokeWidth={1} /></div>
      </section>
      <section className="stat-grid trainer-stat-grid">
        <article className="stat-card"><span className="stat-icon stat-icon-teal"><BookOpen size={20} /></span><span className="stat-copy"><span className="stat-label">Assigned courses</span><strong className="stat-value">{courses.length}</strong><span className="stat-note">Your active learning paths</span></span></article>
        <article className="stat-card"><span className="stat-icon stat-icon-violet"><UsersRound size={20} /></span><span className="stat-copy"><span className="stat-label">Assigned cohorts</span><strong className="stat-value">{cohorts.length}</strong><span className="stat-note">Learner groups you support</span></span></article>
        <article className="stat-card"><span className="stat-icon stat-icon-gold"><BookOpen size={20} /></span><span className="stat-copy"><span className="stat-label">Learners</span><strong className="stat-value">{metrics.learnerCount ?? 0}</strong><span className="stat-note">Across assigned cohorts</span></span></article>
        <article className="stat-card"><span className="stat-icon stat-icon-teal"><BookOpen size={20} /></span><span className="stat-copy"><span className="stat-label">Lesson completions</span><strong className="stat-value">{metrics.completedLessons ?? 0}</strong><span className="stat-note">Across assigned courses</span></span></article>
        <Link className="stat-card stat-card-link" to="/assessments"><span className="stat-icon stat-icon-gold"><ClipboardCheck size={20} /></span><span className="stat-copy"><span className="stat-label">Assessment attempts</span><strong className="stat-value">{metrics.assessmentAttempts ?? 0}</strong><span className="stat-note">Review submissions and results</span></span><ArrowUpRight className="stat-arrow" size={17} /></Link>
        <Link className="stat-card stat-card-link" to="/live-classes"><span className="stat-icon stat-icon-coral"><Video size={20} /></span><span className="stat-copy"><span className="stat-label">Upcoming classes</span><strong className="stat-value">{metrics.upcomingLiveClassCount ?? 0}</strong><span className="stat-note">Scheduled sessions</span></span><ArrowUpRight className="stat-arrow" size={17} /></Link>
      </section>

      <section className="card dashboard-panel">
        <div className="card-heading"><div><span className="eyebrow">Your teaching</span><h2>Assigned courses</h2></div><Link className="text-link" to="/courses">View all <ArrowUpRight size={15} /></Link></div>
        {courses.length ? <div className="trainer-course-list">{courses.map((course, index) => (
          <Link className="trainer-course-row" to={`/courses/${course.id}`} key={course.id}>
            <span className={`trainer-course-icon trainer-course-icon-${index % 3}`}><BookOpen size={18} /></span>
            <span><strong>{course.title}</strong><small>{course.description || 'Open your learning materials and manage course content.'}</small></span>
            <span className={statusClass(course.status)}>{statusLabel(course.status)}</span>
            <ArrowUpRight size={17} />
          </Link>
        ))}</div> : <div className="empty-state"><h3>No courses assigned yet</h3><p>When an administrator assigns you to a course, it will appear here.</p></div>}
      </section>

      <section className="card dashboard-panel">
        <div className="card-heading"><div><span className="eyebrow">Learner groups</span><h2>My cohorts</h2></div></div>
        {cohorts.length ? <div className="cohort-card-grid">{cohorts.map((cohort) => (
          <article className="trainer-cohort-card" key={cohort.id}>
            <span className="quick-action-icon quick-action-violet"><UsersRound size={18} /></span>
            <span className="eyebrow">{cohort.programme?.title || 'Programme'}</span>
            <h3>{cohort.name}</h3>
            <small>{cohort._count?.enrolments ?? 0} enrolled learners</small>
            <span className={statusClass(cohort.status)}>{statusLabel(cohort.status)}</span>
          </article>
        ))}</div> : <div className="empty-state"><h3>No cohorts assigned</h3><p>Assigned learner groups will appear here.</p></div>}
      </section>
      <section className="card dashboard-panel">
        <div className="card-heading"><div><span className="eyebrow">On the timetable</span><h2>Upcoming live classes</h2></div><Link className="text-link" to="/live-classes">View timetable <ArrowUpRight size={15} /></Link></div>
        {upcomingLiveClasses.length ? <div className="activity-list">{upcomingLiveClasses.map((liveClass) => (
          <Link className="activity-row" to="/live-classes" key={liveClass.id}>
            <span className="activity-dot" />
            <span className="activity-description"><strong>{liveClass.title}</strong><small>{liveClass.course.title} · {liveClass.cohort.name}</small></span>
            <time>{new Date(liveClass.startsAt).toLocaleString()}</time>
          </Link>
        ))}</div> : <div className="empty-state"><h3>No upcoming classes</h3><p>Scheduled sessions for your assigned courses and cohorts will appear here.</p></div>}
      </section>
    </div>
  );
}
