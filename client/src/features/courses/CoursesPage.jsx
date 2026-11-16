import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, BookOpen, GraduationCap, Plus, Search, Trash2, Wrench } from 'lucide-react';
import { coursesAPI, programmesAPI, usersAPI } from '../../services/api';
import { useAuth } from '../../hooks/useAuth';
import { statusClass, statusLabel } from '../../components/common/navConfig';
import { Button } from '../../components/common/Button';
import { Input, Select, Textarea } from '../../components/forms/Input';
import { useNavigate } from 'react-router-dom';

const initialForm = { title: '', description: '', programmeId: '', status: 'DRAFT', trainerIds: [] };

export default function CoursesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const role = typeof user?.role === 'string' ? user.role : user?.role?.name;
  const canCreate = role === 'SUPER_ADMIN' || role === 'TRAINER';
  const isAdmin = role === 'SUPER_ADMIN';
  const [courses, setCourses] = useState([]);
  const [programmes, setProgrammes] = useState([]);
  const [trainers, setTrainers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyCourseId, setBusyCourseId] = useState('');

  const loadCourses = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await coursesAPI.list();
      setCourses(data.data || []);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not load courses.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCourses();
    programmesAPI.list()
      .then(({ data }) => setProgrammes(data.data || []))
      .catch((requestError) => setError(requestError.response?.data?.message || 'Could not load programmes.'));
    if (isAdmin) {
      usersAPI.list({ role: 'TRAINER', status: 'ACTIVE', pageSize: 50 })
        .then(({ data }) => setTrainers(data.data.items || []))
        .catch((requestError) => setError(requestError.response?.data?.message || 'Could not load trainers.'));
    }
  }, [isAdmin, loadCourses]);

  const toggleTrainer = (trainerId) => {
    setForm((current) => ({
      ...current,
      trainerIds: current.trainerIds.includes(trainerId)
        ? current.trainerIds.filter((id) => id !== trainerId)
        : [...current.trainerIds, trainerId],
    }));
  };

  const createCourse = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { data } = await coursesAPI.create({
        ...form,
        programmeId: form.programmeId || null,
        trainerIds: isAdmin ? form.trainerIds : [],
        status: 'DRAFT',
      });
      setForm(initialForm);
      setShowForm(false);
      setNotice('Course created. Open it to add modules and lessons.');
      await loadCourses();
      if (data.data?.id) navigate(`/courses/${data.data.id}/builder`);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not create the course.');
    } finally {
      setSaving(false);
    }
  };

  const deleteCourse = async (course) => {
    if (!window.confirm(`Permanently delete "${course.title}" and its learning content? This cannot be undone.`)) return;
    setBusyCourseId(course.id);
    setError('');
    setNotice('');
    try {
      await coursesAPI.delete(course.id);
      setNotice('Course deleted.');
      await loadCourses();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not delete this course.');
    } finally {
      setBusyCourseId('');
    }
  };

  const filteredCourses = courses.filter((course) => {
    const query = search.trim().toLowerCase();
    return !query || `${course.title} ${course.description || ''} ${course.programme?.title || ''}`.toLowerCase().includes(query);
  });

  return (
    <div className="page-stack">
      <section className="page-heading">
        <div>
          <span className="eyebrow">{role === 'STUDENT' ? 'Your learning' : 'Learning catalogue'}</span>
          <h1>{role === 'STUDENT' ? 'My courses' : 'Courses'}</h1>
          <p>{role === 'STUDENT' ? 'Pick up where you left off and explore your course materials.' : 'Build engaging learning paths, organize lessons, and support every learner.'}</p>
        </div>
        {canCreate && <Button onClick={() => setShowForm((open) => !open)}><Plus size={16} /> {showForm ? 'Close form' : 'Create course'}</Button>}
      </section>

      {notice && <div className="notice notice-success">{notice}</div>}
      {error && <div className="notice notice-error" role="alert">{error}</div>}

      {showForm && <section className="card course-create-card">
        <div className="card-heading"><div><span className="eyebrow">Start a learning path</span><h2>Course details</h2></div></div>
        <form className="course-create-form" onSubmit={createCourse}>
          <Input label="Course title" value={form.title} onChange={(title) => setForm((current) => ({ ...current, title }))} required placeholder="e.g. Travel Operations Essentials" />
          <Textarea label="Course description" value={form.description} onChange={(description) => setForm((current) => ({ ...current, description }))} placeholder="What will learners be able to do after completing this course?" />
          <div className="course-create-row">
            <Select label="Program" value={form.programmeId} onChange={(programmeId) => setForm((current) => ({ ...current, programmeId }))} options={programmes.map((programme) => ({ value: programme.id, label: programme.title }))} required />
          </div>
          {isAdmin && <fieldset className="trainer-picker">
            <legend>Assign trainers <span>(optional)</span></legend>
            {trainers.length ? <div className="trainer-picker-list">{trainers.map((trainer) => (
              <label className="trainer-option" key={trainer.id}>
                <input type="checkbox" checked={form.trainerIds.includes(trainer.id)} onChange={() => toggleTrainer(trainer.id)} />
                <span className="person-avatar person-avatar-violet">{`${trainer.firstName?.[0] || ''}${trainer.lastName?.[0] || ''}`.toUpperCase()}</span>
                <span><strong>{trainer.firstName} {trainer.lastName}</strong><small>{trainer.email}</small></span>
              </label>
            ))}</div> : <p className="muted small">Invite an active trainer before assigning one to a course.</p>}
          </fieldset>}
          <div className="lesson-form-actions"><Button type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create course'}</Button><Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button></div>
        </form>
      </section>}

      <section className="catalog-toolbar">
        <div className="catalog-count"><strong>{filteredCourses.length}</strong><span>course{filteredCourses.length === 1 ? '' : 's'}{role === 'STUDENT' ? ' in your learning path' : ' in the catalogue'}</span></div>
        <label className="search-field"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search courses" /></label>
      </section>

      {loading ? <div className="card loading-card">Gathering your courses…</div> : filteredCourses.length ? (
        <section className="course-grid">
          {filteredCourses.map((course, index) => (
            <article className={`course-card course-card-${index % 4}`} key={course.id}>
              <Link className="course-card-link" to={`/courses/${course.id}`}>
                <div className="course-card-art"><span className="course-art-number">{String(index + 1).padStart(2, '0')}</span><span className="course-art-icon"><BookOpen size={25} /></span><span className={statusClass(course.status)}>{statusLabel(course.status)}</span></div>
                <div className="course-card-content">
                  <span className="eyebrow">{course.programme?.title || 'REO Academy'}</span>
                  <h2>{course.title}</h2>
                  <p>{course.description || 'Explore the lessons and activities in this course.'}</p>
                  <div className="course-card-footer"><span><GraduationCap size={15} /> {course._count?.modules || 0} modules</span><span className="course-open">Open course <ArrowUpRight size={16} /></span></div>
                </div>
              </Link>
              {canCreate && <div className="course-admin-actions">
                <Link className="btn btn-ghost btn-sm" to={`/courses/${course.id}/builder`}><Wrench size={14} /> Open builder</Link>
                {isAdmin && <Button variant="ghost" size="sm" className="action-danger" disabled={busyCourseId === course.id} onClick={() => deleteCourse(course)}><Trash2 size={14} /> Delete</Button>}
              </div>}
            </article>
          ))}
        </section>
      ) : <div className="card empty-state"><BookOpen size={25} /><h3>{search ? 'No matching courses' : 'Your next learning adventure starts here'}</h3><p>{search ? 'Try another search term.' : role === 'STUDENT' ? 'Courses assigned to your cohort will appear here.' : 'Create a course, add its modules, and start building your learning experience.'}</p></div>}
    </div>
  );
}
