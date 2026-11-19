import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, GraduationCap, Plus, Trash2, UsersRound } from 'lucide-react';
import { cohortsAPI, coursesAPI, usersAPI } from '../../services/api';
import { statusClass, statusLabel } from '../../components/common/navConfig';
import { Button } from '../../components/common/Button';
import { Select } from '../../components/forms/Input';
import { useAuth } from '../../hooks/useAuth';

export default function CohortDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const role = typeof user?.role === 'string' ? user.role : user?.role?.name;
  const isAdmin = role === 'SUPER_ADMIN';
  const [cohort, setCohort] = useState(null);
  const [students, setStudents] = useState([]);
  const [trainers, setTrainers] = useState([]);
  const [courses, setCourses] = useState([]);
  const [studentId, setStudentId] = useState('');
  const [trainerId, setTrainerId] = useState('');
  const [courseId, setCourseId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadCohort = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await cohortsAPI.get(id);
      setCohort(data.data);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not load this cohort.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadCohort();
    if (!isAdmin) return;
    usersAPI.list({ role: 'STUDENT', status: 'ACTIVE', pageSize: 50 })
      .then(({ data }) => setStudents(data.data.items || []))
      .catch((requestError) => setError(requestError.response?.data?.message || 'Could not load students.'));
    usersAPI.list({ role: 'TRAINER', status: 'ACTIVE', pageSize: 50 })
      .then(({ data }) => setTrainers(data.data.items || []))
      .catch((requestError) => setError(requestError.response?.data?.message || 'Could not load trainers.'));
    coursesAPI.list()
      .then(({ data }) => setCourses(data.data || []))
      .catch((requestError) => setError(requestError.response?.data?.message || 'Could not load courses.'));
  }, [id, isAdmin, loadCohort]);

  const applyAction = async (action, message) => {
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(message);
      await loadCohort();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not complete the cohort update.');
    }
  };

  if (loading) return <div className="card loading-card">Opening cohort…</div>;
  if (!cohort) return <div className="page-stack"><div className="notice notice-error">{error || 'Cohort not found.'}</div><Link className="btn btn-secondary" to="/cohorts"><ArrowLeft size={16} /> Back to cohorts</Link></div>;

  const enrolledIds = new Set(cohort.enrolments.map((entry) => entry.studentId));
  const assignedTrainerIds = new Set(cohort.trainers.map((entry) => entry.trainerId));
  const assignedCourseIds = new Set(cohort.courses.map((entry) => entry.courseId));

  return (
    <div className="page-stack">
      <Link className="back-link" to="/cohorts"><ArrowLeft size={16} /> All cohorts</Link>
      <section className="cohort-hero">
        <div><span className="eyebrow eyebrow-light">{cohort.programme?.title || 'Programme'}</span><h1>{cohort.name}</h1><p>{cohort.intakeProgramOffering?.intake ? `GATE ${String(cohort.intakeProgramOffering.intake.gateNumber).padStart(2, '0')} · ${cohort.intakeProgramOffering.intake.season} ${cohort.intakeProgramOffering.intake.year}` : 'Programme learning cohort'}</p></div>
        <span className={statusClass(cohort.status)}>{statusLabel(cohort.status)}</span>
      </section>
      {notice && <div className="notice notice-success">{notice}</div>}
      {error && <div className="notice notice-error" role="alert">{error}</div>}

      <div className="cohort-metrics">
        <div className="stat-card"><span className="stat-icon stat-icon-gold"><GraduationCap size={19} /></span><span className="stat-copy"><span className="stat-label">Enrolled learners</span><strong className="stat-value">{cohort.enrolments.length}</strong></span></div>
        <div className="stat-card"><span className="stat-icon stat-icon-violet"><UsersRound size={19} /></span><span className="stat-copy"><span className="stat-label">Assigned trainers</span><strong className="stat-value">{cohort.trainers.length}</strong></span></div>
        <div className="stat-card"><span className="stat-icon stat-icon-teal"><BookOpen size={19} /></span><span className="stat-copy"><span className="stat-label">Courses</span><strong className="stat-value">{cohort.courses.length}</strong></span></div>
      </div>

      <div className="cohort-detail-grid">
        <section className="card cohort-section">
          <div className="card-heading"><div><span className="eyebrow">Learning group</span><h2>Students</h2></div></div>
          {isAdmin && <form className="inline-create-form" onSubmit={(event) => {
            event.preventDefault();
            if (!studentId) return;
            applyAction(() => cohortsAPI.enrolStudent(id, studentId), 'Student enrolled in this cohort.');
            setStudentId('');
          }}>
            <Select aria-label="Select student" value={studentId} onChange={setStudentId} options={students.filter((student) => !enrolledIds.has(student.id)).map((student) => ({ value: student.id, label: `${student.firstName} ${student.lastName} · ${student.email}` }))} />
            <Button type="submit" disabled={!studentId}><Plus size={15} /> Enrol</Button>
          </form>}
          <div className="cohort-member-list">
            {cohort.enrolments.map((enrolment) => <div className="cohort-member" key={enrolment.id}>
              <span className="person-avatar">{`${enrolment.student.firstName?.[0] || ''}${enrolment.student.lastName?.[0] || ''}`.toUpperCase()}</span>
              <span><strong>{enrolment.student.firstName} {enrolment.student.lastName}</strong><small>{enrolment.student.email}</small></span>
              {isAdmin && <button className="icon-button action-danger" onClick={() => {
                if (window.confirm(`Remove ${enrolment.student.firstName} from this cohort?`)) applyAction(() => cohortsAPI.removeEnrolment(id, enrolment.id), 'Student removed from cohort.');
              }} aria-label="Remove student"><Trash2 size={15} /></button>}
            </div>)}
            {!cohort.enrolments.length && <div className="empty-state"><p>No students enrolled yet.</p></div>}
          </div>
        </section>

        <div className="cohort-side-stack">
          <section className="card cohort-section">
            <div className="card-heading"><div><span className="eyebrow">Teaching team</span><h2>Trainers</h2></div></div>
            {isAdmin && <form className="inline-create-form" onSubmit={(event) => {
              event.preventDefault();
              if (!trainerId) return;
              applyAction(() => cohortsAPI.assignTrainer(id, trainerId), 'Trainer assigned to this cohort.');
              setTrainerId('');
            }}>
              <Select aria-label="Select trainer" value={trainerId} onChange={setTrainerId} options={trainers.filter((trainer) => !assignedTrainerIds.has(trainer.id)).map((trainer) => ({ value: trainer.id, label: `${trainer.firstName} ${trainer.lastName}` }))} />
              <Button type="submit" disabled={!trainerId}><Plus size={15} /> Assign</Button>
            </form>}
            {cohort.trainers.map((entry) => <div className="cohort-member" key={entry.id}><span className="person-avatar person-avatar-violet">{`${entry.trainer.firstName?.[0] || ''}${entry.trainer.lastName?.[0] || ''}`.toUpperCase()}</span><span><strong>{entry.trainer.firstName} {entry.trainer.lastName}</strong><small>{entry.trainer.email}</small></span>{isAdmin && <button className="icon-button action-danger" onClick={() => {
              if (window.confirm(`Unassign ${entry.trainer.firstName} from this cohort?`)) applyAction(() => cohortsAPI.removeTrainer(id, entry.id), 'Trainer unassigned from this cohort.');
            }} aria-label="Unassign trainer"><Trash2 size={15} /></button>}</div>)}
            {!cohort.trainers.length && <p className="muted small">No trainers assigned.</p>}
          </section>

          <section className="card cohort-section">
            <div className="card-heading"><div><span className="eyebrow">Curriculum</span><h2>Courses</h2></div></div>
            {isAdmin && <form className="inline-create-form" onSubmit={(event) => {
              event.preventDefault();
              if (!courseId) return;
              applyAction(() => cohortsAPI.assignCourse(id, courseId), 'Course added to this cohort.');
              setCourseId('');
            }}>
              <Select aria-label="Select course" value={courseId} onChange={setCourseId} options={courses.filter((course) => !assignedCourseIds.has(course.id)).map((course) => ({ value: course.id, label: course.title }))} />
              <Button type="submit" disabled={!courseId}><Plus size={15} /> Add</Button>
            </form>}
            {cohort.courses.map((entry) => <div className="cohort-course" key={entry.id}><span className="quick-action-icon quick-action-teal"><BookOpen size={17} /></span><span><strong>{entry.course.title}</strong><small className={statusClass(entry.course.status)}>{statusLabel(entry.course.status)}</small></span>{isAdmin && <button className="icon-button action-danger" onClick={() => {
              if (window.confirm(`Remove "${entry.course.title}" from this cohort?`)) applyAction(() => cohortsAPI.removeCourse(id, entry.id), 'Course removed from this cohort.');
            }} aria-label="Remove course from cohort"><Trash2 size={15} /></button>}</div>)}
            {!cohort.courses.length && <p className="muted small">No courses assigned yet.</p>}
          </section>
        </div>
      </div>
    </div>
  );
}
