import { useEffect, useRef, useState } from 'react';
import { CalendarPlus, Loader2, Zap } from 'lucide-react';
import { cohortsAPI } from '../../services/api';

const DURATIONS = [30, 45, 60, 90, 120];
const pad = (n) => String(n).padStart(2, '0');
export const localDateTime = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;

// A cohort only offers the courses assigned to it, which is also what the server validates.
function useCohortCourses() {
  const cache = useRef(new Map());
  const [state, setState] = useState({ loading: false, courses: [], error: '' });
  const load = async (cohortId) => {
    if (!cohortId) { setState({ loading: false, courses: [], error: '' }); return; }
    if (cache.current.has(cohortId)) { setState({ loading: false, courses: cache.current.get(cohortId), error: '' }); return; }
    setState({ loading: true, courses: [], error: '' });
    try {
      const { data } = await cohortsAPI.get(cohortId);
      const courses = (data.data.courses || []).map((entry) => entry.course).filter(Boolean);
      cache.current.set(cohortId, courses);
      setState({ loading: false, courses, error: '' });
    } catch (error) {
      setState({ loading: false, courses: [], error: error.response?.data?.message || 'Could not load this cohort’s courses.' });
    }
  };
  return [state, load];
}

function DurationChips({ value, onChange }) {
  return (
    <div className="lc-chips" role="radiogroup" aria-label="Duration">
      {DURATIONS.map((minutes) => (
        <button
          key={minutes}
          type="button"
          role="radio"
          aria-checked={Number(value) === minutes}
          className={`lc-chip${Number(value) === minutes ? ' is-on' : ''}`}
          onClick={() => onChange(String(minutes))}
        >
          {minutes < 60 ? `${minutes} min` : `${minutes / 60} h`}
        </button>
      ))}
      <label className="lc-chip-custom">
        <span className="sr-only">Custom duration in minutes</span>
        <input
          type="number" min="15" max="480" step="5" inputMode="numeric" value={value}
          onChange={(e) => onChange(e.target.value)} aria-label="Custom duration in minutes"
        />
        <em>min</em>
      </label>
    </div>
  );
}

const Field = ({ label, hint, children }) => (
  <label className="lc-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
);

export function ScheduleForm({ cohorts, saving, onSubmit }) {
  const [form, setForm] = useState({
    title: '', cohortId: '', courseId: '', startsAt: '', durationMins: '60', description: '',
  });
  const [{ loading, courses, error }, loadCourses] = useCohortCourses();
  const set = (patch) => setForm((c) => ({ ...c, ...patch }));

  useEffect(() => {
    if (courses.length === 1) set({ courseId: courses[0].id });
  }, [courses]);

  const submit = async (event) => {
    event.preventDefault();
    const ok = await onSubmit({
      title: form.title.trim(),
      courseId: form.courseId,
      cohortId: form.cohortId,
      description: form.description,
      durationMins: Number(form.durationMins),
      startsAt: new Date(form.startsAt).toISOString(),
    });
    if (ok) setForm({ title: '', cohortId: '', courseId: '', startsAt: '', durationMins: '60', description: '' });
  };

  return (
    <form className="lc-form" onSubmit={submit}>
      <Field label="Class title">
        <input className="lc-input" value={form.title} maxLength={120} required placeholder="e.g. Amadeus booking practice" onChange={(e) => set({ title: e.target.value })} />
      </Field>
      <div className="lc-row">
        <Field label="Cohort">
          <select
            className="lc-input" value={form.cohortId} required
            onChange={(e) => { set({ cohortId: e.target.value, courseId: '' }); loadCourses(e.target.value); }}
          >
            <option value="">Choose a cohort</option>
            {cohorts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Course" hint={error || (form.cohortId && !loading && courses.length === 0 ? 'No courses are assigned to this cohort.' : '')}>
          <select className="lc-input" value={form.courseId} required disabled={!form.cohortId || loading} onChange={(e) => set({ courseId: e.target.value })}>
            <option value="">{loading ? 'Loading…' : form.cohortId ? 'Choose a course' : 'Choose a cohort first'}</option>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Starts" hint="Students can join 40 minutes before the start time.">
        <input className="lc-input" type="datetime-local" value={form.startsAt} min={localDateTime(new Date())} required onChange={(e) => set({ startsAt: e.target.value })} />
      </Field>
      <Field label="Duration"><DurationChips value={form.durationMins} onChange={(durationMins) => set({ durationMins })} /></Field>
      <Field label="Notes for students (optional)">
        <textarea className="lc-input lc-textarea" rows={2} value={form.description} maxLength={2000} onChange={(e) => set({ description: e.target.value })} />
      </Field>
      <button type="submit" className="lc-btn lc-btn--primary" disabled={saving}>
        {saving ? <><Loader2 size={16} className="lc-spin" /> Scheduling…</> : <><CalendarPlus size={16} /> Schedule class</>}
      </button>
    </form>
  );
}

export function InstantForm({ cohorts, saving, onSubmit }) {
  const [form, setForm] = useState({ title: '', cohortId: '', courseId: '', durationMins: '60', description: '' });
  const [{ loading, courses }, loadCourses] = useCohortCourses();
  const [more, setMore] = useState(false);
  const set = (patch) => setForm((c) => ({ ...c, ...patch }));

  const submit = (event) => {
    event.preventDefault();
    onSubmit({
      title: form.title.trim() || `Instant class · ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`,
      courseId: form.courseId || undefined,
      cohortId: form.cohortId || undefined,
      description: form.description,
      durationMins: Number(form.durationMins),
    });
  };

  return (
    <form className="lc-form" onSubmit={submit}>
      <p className="lc-lede">Starts right now. You only need a title to launch; a course and cohort are optional.</p>
      <Field label="Title (optional)">
        <input className="lc-input" value={form.title} maxLength={120} placeholder="Instant class" onChange={(e) => set({ title: e.target.value })} />
      </Field>
      <Field label="Duration"><DurationChips value={form.durationMins} onChange={(durationMins) => set({ durationMins })} /></Field>
      <button type="button" className="lc-linkbtn" aria-expanded={more} onClick={() => setMore((v) => !v)}>
        {more ? 'Hide audience options' : 'Choose who can join'}
      </button>
      {more && (
        <div className="lc-more">
          <div className="lc-row">
            <Field label="Cohort (optional)">
              <select className="lc-input" value={form.cohortId} onChange={(e) => { set({ cohortId: e.target.value, courseId: '' }); loadCourses(e.target.value); }}>
                <option value="">None</option>
                {cohorts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Course (optional)">
              <select className="lc-input" value={form.courseId} disabled={!form.cohortId || loading} onChange={(e) => set({ courseId: e.target.value })}>
                <option value="">{form.cohortId ? 'None' : 'Pick a cohort first'}</option>
                {courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </Field>
          </div>
          <small className="lc-hint">
            {form.cohortId
              ? 'Students in this cohort will see the class and can join.'
              : 'With no cohort, only trainers and admins can join.'}
          </small>
        </div>
      )}
      <button type="submit" className="lc-btn lc-btn--live" disabled={saving}>
        {saving ? <><Loader2 size={16} className="lc-spin" /> Starting…</> : <><Zap size={16} /> Start now</>}
      </button>
    </form>
  );
}
