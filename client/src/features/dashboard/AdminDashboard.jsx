import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, BookOpen, CalendarRange, ClipboardCheck, Clock3, GraduationCap, UsersRound, Video } from 'lucide-react';
import { assessmentsAPI, dashboardAPI, intakesAPI } from '../../services/api';
import { statusClass, statusLabel } from '../../components/common/navConfig';
import DashboardLoadError from './DashboardLoadError';
import { formatIntakeDate, formatIntakeStart } from '../intakes/intakeDateTime';

export default function AdminDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [intakes, setIntakes] = useState([]);
  const [releasingAttempt, setReleasingAttempt] = useState(null);
  const [releaseError, setReleaseError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    Promise.all([dashboardAPI.admin(), intakesAPI.list()])
      .then(([dashboardResponse, intakeResponse]) => {
        setData(dashboardResponse.data.data);
        setIntakes(intakeResponse.data.data || []);
      })
      .catch((err) => {
        setError(err.response?.data?.message || 'Could not load academy overview.');
      })
      .finally(() => setLoading(false));
  }, [retryKey]);

  if (loading) {
    return <div className="card loading-card">Preparing your academy overview…</div>;
  }
  if (error) {
    return <div className="page-stack"><DashboardLoadError message={error} onRetry={() => setRetryKey((key) => key + 1)} /></div>;
  }

  const s = data?.stats || {};
  const releaseAttemptResult = async (attemptId) => {
    setReleaseError('');
    setReleasingAttempt(attemptId);
    try {
      await assessmentsAPI.releaseAttemptResults(attemptId);
      setRetryKey((key) => key + 1);
    } catch (requestError) {
      setReleaseError(requestError.response?.data?.message || 'Could not release the examination result.');
    } finally {
      setReleasingAttempt(null);
    }
  };
  const statCards = [
    { label: 'Students', value: s.totalStudents ?? 0, note: `${s.activeStudents ?? 0} active · ${s.totalEnrolments ?? 0} Intake enrolments`, icon: GraduationCap, tone: 'gold' },
    { label: 'Awaiting review', value: s.pendingRegistrations ?? 0, note: 'Student applications', icon: Clock3, tone: 'coral', href: '/students' },
    { label: 'Tutors', value: s.totalTrainers ?? 0, note: 'Tutor accounts', icon: UsersRound, tone: 'violet', href: '/trainers' },
    { label: 'Programs', value: s.activeProgrammes ?? 0, note: 'Active academy Programs', icon: BookOpen, tone: 'teal', href: '/programmes' },
    { label: 'Courses', value: s.totalCourses ?? 0, note: `${s.publishedCourses ?? 0} published · ${s.draftCourses ?? 0} drafts`, icon: BookOpen, tone: 'teal', href: '/courses' },
    { label: 'Assessments', value: s.publishedAssessments ?? 0, note: 'Published assessments', icon: Clock3, tone: 'violet', href: '/assessments' },
    { label: 'Examinations', value: s.publishedExaminations ?? 0, note: `${s.examinationAttempts ?? 0} recorded attempts`, icon: ClipboardCheck, tone: 'coral', href: '/assessments' },
    { label: 'Upcoming classes', value: s.upcomingLiveClasses ?? 0, note: 'Scheduled sessions', icon: Video, tone: 'coral', href: '/live-classes' },
    { label: 'Intakes', value: intakes.length, note: '2027 academic calendar', icon: CalendarRange, tone: 'gold', href: '/intakes' },
  ];

  return (
    <div className="page-stack">
      <section className="welcome-banner">
        <div className="welcome-content">
          <span className="eyebrow eyebrow-light">Academy operations</span>
          <h1>Your academy, at a glance.</h1>
          <p>Keep people, programmes, and learning on the right course.</p>
          <Link className="welcome-link" to="/students">Review student applications <ArrowUpRight size={16} /></Link>
        </div>
        <div className="welcome-art" aria-hidden="true"><span>REO</span><GraduationCap size={64} strokeWidth={1} /></div>
      </section>

      <section className="stat-grid">
        {statCards.map(({ label, value, note, icon: Icon, tone, href }) => {
          const content = <><span className={`stat-icon stat-icon-${tone}`}><Icon size={20} /></span><span className="stat-copy"><span className="stat-label">{label}</span><strong className="stat-value">{value}</strong><span className="stat-note">{note}</span></span></>;
          return href
            ? <Link className="stat-card stat-card-link" key={label} to={href}>{content}<ArrowUpRight className="stat-arrow" size={17} /></Link>
            : <article className="stat-card" key={label}>{content}</article>;
        })}
      </section>

      <section className="card dashboard-panel">
        <div className="card-heading">
          <div><span className="eyebrow">2027 academic calendar</span><h2>Program Offerings by Intake</h2></div>
          <Link className="text-link" to="/intakes">Manage Intakes <ArrowUpRight size={15} /></Link>
        </div>
        {intakes.length ? (
          <div className="activity-list">
            {[...intakes].sort((a, b) => a.gateNumber - b.gateNumber).map((intake) => {
              const gate = `GATE ${String(intake.gateNumber).padStart(2, '0')}`;
              const offeringCount = intake.programOfferings?.length || 0;
              const applicationCount = (intake.programOfferings || []).reduce(
                (total, offering) => total + (offering._count?.applications || 0),
                0,
              );
              return (
                <div className="activity-row" key={intake.id}>
                  <span className="activity-dot" />
                  <span className="activity-description">
                    <strong>{gate} — {intake.season} {intake.year}</strong>
                    <small>{offeringCount} Programs · {formatIntakeStart(intake.academicStartDate, intake.timezone)} to {formatIntakeDate(intake.academicEndDate)} · {applicationCount} applications</small>
                  </span>
                  <span className={statusClass(intake.status)}>{statusLabel(intake.status)}</span>
                  <Link className="btn btn-ghost btn-sm" to={`/intakes/${intake.id}`}>Manage</Link>
                </div>
              );
            })}
          </div>
        ) : <div className="empty-state"><h3>No Intakes configured</h3><p>Create the 2027 Intake calendar to begin admissions planning.</p></div>}
      </section>

      <div className="dashboard-grid">
        <section className="card dashboard-panel">
          <div className="card-heading">
            <div><span className="eyebrow">New to REO</span><h2>Recent registrations</h2></div>
            <Link className="text-link" to="/students">View all <ArrowUpRight size={15} /></Link>
          </div>
          {data?.recentRegistrations?.length ? (
            <div className="registration-list">
              {data.recentRegistrations.map((student) => (
                <Link className="registration-row" to={`/students/${student.id}`} key={student.id}>
                  <span className="person-avatar">{`${student.firstName?.[0] || ''}${student.lastName?.[0] || ''}`.toUpperCase()}</span>
                  <span className="registration-copy"><strong>{student.firstName} {student.lastName}</strong><small>{student.email}</small></span>
                  <span className={statusClass(student.status)}>{statusLabel(student.status)}</span>
                </Link>
              ))}
            </div>
          ) : <div className="empty-state"><h3>No new registrations</h3><p>New student applications will appear here.</p></div>}
        </section>

        <section className="card dashboard-panel">
          <div className="card-heading">
            <div><span className="eyebrow">Keep learning on track</span><h2>Quick actions</h2></div>
          </div>
          <div className="quick-action-list">
            <Link className="quick-action" to="/students"><span className="quick-action-icon"><GraduationCap size={19} /></span><span><strong>Manage students</strong><small>Approve applications and update access</small></span><ArrowUpRight size={17} /></Link>
            <Link className="quick-action" to="/trainers"><span className="quick-action-icon quick-action-violet"><UsersRound size={19} /></span><span><strong>Invite a Tutor</strong><small>Grow your teaching team</small></span><ArrowUpRight size={17} /></Link>
            <Link className="quick-action" to="/courses"><span className="quick-action-icon quick-action-teal"><BookOpen size={19} /></span><span><strong>Explore courses</strong><small>Build and organize learning</small></span><ArrowUpRight size={17} /></Link>
            <Link className="quick-action" to="/settings"><span className="quick-action-icon quick-action-coral"><Clock3 size={19} /></span><span><strong>Account settings</strong><small>Update your profile and contact details</small></span><ArrowUpRight size={17} /></Link>
          </div>
        </section>
      </div>

      <section className="card dashboard-panel">
        <div className="card-heading">
          <div><span className="eyebrow">Examination records</span><h2>Recent examination attempts</h2></div>
          <Link className="text-link" to="/assessments">Review all <ArrowUpRight size={15} /></Link>
        </div>
        {releaseError && <p className="form-error" role="alert">{releaseError}</p>}
        {data?.recentExaminationAttempts?.length ? (
          <div className="activity-list">
            {data.recentExaminationAttempts.map((attempt) => (
              <div className="activity-row" key={attempt.id}>
                <span className="activity-dot" />
                <span className="activity-description">
                  <strong>{attempt.assessment.title}</strong>
                  <small>{attempt.student.firstName} {attempt.student.lastName} · {attempt.assessment.programOffering ? `GATE ${String(attempt.assessment.programOffering.intake.gateNumber).padStart(2, '0')} ${attempt.assessment.programOffering.intake.season} ${attempt.assessment.programOffering.intake.year} · ${attempt.assessment.programOffering.programme.title} · ` : ''}{new Date(attempt.startedAt).toLocaleString()}</small>
                </span>
                <span className={statusClass(attempt.status)}>{attempt.submittedAt ? (attempt.assessment.resultsReleased || attempt.resultsReleasedAt ? 'Result released' : 'Result held') : statusLabel(attempt.status)}</span>
                <span>{attempt.score ?? '—'} / {attempt.maxScore ?? '—'}</span>
                {attempt.submittedAt && attempt.status === 'GRADED'
                  && !attempt.assessment.resultsReleased
                  && !attempt.resultsReleasedAt
                  && <button className="btn btn-ghost btn-sm" type="button" disabled={releasingAttempt === attempt.id} onClick={() => releaseAttemptResult(attempt.id)}>{releasingAttempt === attempt.id ? 'Releasing…' : 'Release result'}</button>}
              </div>
            ))}
          </div>
        ) : <div className="empty-state"><h3>No examination attempts yet</h3><p>Submitted examination attempts will be recorded here.</p></div>}
      </section>

      <section className="card dashboard-panel">
        <div className="card-heading">
          <div><span className="eyebrow">Accountability</span><h2>Latest academy activity</h2></div>
        </div>
        {data?.recentAudit?.length ? (
          <div className="activity-list">
            {data.recentAudit.map((item) => (
              <div className="activity-row" key={item.id}>
                <span className="activity-dot" />
                <span className="activity-description"><strong>{item.action.replaceAll('_', ' ').toLowerCase()}</strong><small>{item.actor}{item.entity ? ` · ${item.entity}` : ''}</small></span>
                <time>{new Date(item.createdAt).toLocaleString()}</time>
              </div>
            ))}
          </div>
        ) : <div className="empty-state"><h3>No activity yet</h3><p>Academy actions will be recorded here.</p></div>}
      </section>
    </div>
  );
}
