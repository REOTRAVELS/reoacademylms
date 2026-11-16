import { useCallback, useEffect, useMemo, useState } from 'react';
import { Megaphone, UsersRound } from 'lucide-react';
import { coursesAPI, notificationsAPI, programmesAPI } from '../../services/api';
import { useAuth } from '../../hooks/useAuth';
import { Button } from '../../components/common/Button';
import { Input, Select, Textarea } from '../../components/forms/Input';
import { getAttendanceSummary } from './attendanceSummary.js';

const todayLocal = () => {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 10);
};

const initialAnnouncement = { title: '', body: '', audience: '', targetId: '' };
const maxAttendanceStudents = 200;
const pageSize = 50;

export default function CommunicationsPage() {
  const { user } = useAuth();
  const role = typeof user?.role === 'string' ? user.role : user?.role?.name;
  const canManage = role === 'SUPER_ADMIN' || role === 'TRAINER';
  const [announcements, setAnnouncements] = useState([]);
  const [announcementsHasMore, setAnnouncementsHasMore] = useState(false);
  const [announcementsLoadingMore, setAnnouncementsLoadingMore] = useState(false);
  const [cohorts, setCohorts] = useState([]);
  const [courses, setCourses] = useState([]);
  const [programmes, setProgrammes] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [selectedCohortId, setSelectedCohortId] = useState('');
  const [attendanceDate, setAttendanceDate] = useState(todayLocal);
  const [attendanceDraft, setAttendanceDraft] = useState({});
  const [announcementForm, setAnnouncementForm] = useState(initialAnnouncement);
  const [loading, setLoading] = useState(true);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [attendanceHasMore, setAttendanceHasMore] = useState(false);
  const [attendanceLoadingMore, setAttendanceLoadingMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadPage = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const responses = await Promise.all([
        notificationsAPI.listAnnouncements({ limit: pageSize }),
        ...(!canManage ? [notificationsAPI.listAttendance({ limit: 100 })] : []),
        ...(canManage ? [notificationsAPI.listAttendanceCohorts(), coursesAPI.list()] : []),
        ...(role === 'SUPER_ADMIN' ? [programmesAPI.list()] : []),
      ]);
      const announcementItems = responses[0].data.data || [];
      setAnnouncements(announcementItems);
      setAnnouncementsHasMore(announcementItems.length === pageSize);
      if (!canManage) {
        const attendanceItems = responses[1].data.data || [];
        setAttendance(attendanceItems);
        setAttendanceHasMore(attendanceItems.length === 100);
      }
      if (canManage) {
        const cohortData = responses[1].data.data || [];
        setCohorts(cohortData);
        setSelectedCohortId((current) => cohortData.some((cohort) => cohort.id === current) ? current : cohortData[0]?.id || '');
        setCourses(responses[2].data.data || []);
      }
      if (role === 'SUPER_ADMIN') setProgrammes(responses[3].data.data || []);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not load communications.');
    } finally {
      setLoading(false);
    }
  }, [canManage, role]);

  useEffect(() => { loadPage(); }, [loadPage]);

  const loadAttendance = useCallback(async (cohortId, date, cursor = null, append = false) => {
    if (append) setAttendanceLoadingMore(true);
    else setAttendanceLoading(true);
    try {
      const { data } = await notificationsAPI.listAttendance(
        canManage
          ? { cohortId, date, limit: 100, ...(cursor && { cursor }) }
          : { limit: 100, ...(cursor && { cursor }) },
      );
      const items = data.data || [];
      setAttendance((current) => append ? [...current, ...items] : items);
      setAttendanceHasMore(items.length === 100);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not load attendance.');
    } finally {
      setAttendanceLoading(false);
      setAttendanceLoadingMore(false);
    }
  }, [canManage]);

  useEffect(() => {
    if (canManage && selectedCohortId) loadAttendance(selectedCohortId, attendanceDate);
  }, [attendanceDate, canManage, loadAttendance, selectedCohortId]);

  const loadMoreAnnouncements = async () => {
    const cursor = announcements.at(-1)?.id;
    if (!cursor) return;
    setAnnouncementsLoadingMore(true);
    setError('');
    try {
      const { data } = await notificationsAPI.listAnnouncements({ limit: pageSize, cursor });
      const items = data.data || [];
      setAnnouncements((current) => [...current, ...items]);
      setAnnouncementsHasMore(items.length === pageSize);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not load more announcements.');
    } finally {
      setAnnouncementsLoadingMore(false);
    }
  };

  const loadMoreAttendance = () => {
    const cursor = attendance.at(-1)?.id;
    if (cursor) loadAttendance(canManage ? selectedCohortId : null, canManage ? attendanceDate : null, cursor, true);
  };

  const selectedCohort = cohorts.find((cohort) => cohort.id === selectedCohortId);
  const attendanceBatchCount = Math.ceil((selectedCohort?.enrolments.length || 0) / maxAttendanceStudents);
  const attendanceSummary = getAttendanceSummary(selectedCohort?.enrolments || [], attendanceDraft);
  const attendanceRecords = useMemo(
    () => attendance.filter((record) => !selectedCohortId || record.cohortId === selectedCohortId),
    [attendance, selectedCohortId],
  );
  const cohortOptions = cohorts.map((cohort) => ({ value: cohort.id, label: cohort.name }));
  const audienceOptions = [
    ...(role === 'SUPER_ADMIN' ? [{ value: 'all', label: 'All active learners and trainers' }] : []),
    ...(role === 'SUPER_ADMIN' ? [{ value: 'programme', label: 'Programme' }] : []),
    { value: 'cohort', label: 'Cohort' },
    { value: 'course', label: 'Course' },
  ];
  const audienceChoices = {
    programme: programmes.map((programme) => ({ value: programme.id, label: programme.title })),
    cohort: cohortOptions,
    course: courses.filter((course) => course.status === 'PUBLISHED').map((course) => ({ value: course.id, label: course.title })),
  };
  const announcementTargetLabel = (announcement) => {
    if (announcement.courseId) return courses.find((course) => course.id === announcement.courseId)?.title || 'Course announcement';
    if (announcement.cohortId) return cohorts.find((cohort) => cohort.id === announcement.cohortId)?.name || 'Cohort announcement';
    if (announcement.programmeId) return programmes.find((programme) => programme.id === announcement.programmeId)?.title || 'Programme announcement';
    return 'Academy-wide';
  };

  useEffect(() => {
    if (!selectedCohort) return;
    const savedByStudent = new Map(attendance
      .filter((record) => record.cohortId === selectedCohort.id && new Date(record.date).toISOString().slice(0, 10) === attendanceDate)
      .map((record) => [record.studentId, record.present]));
    setAttendanceDraft(Object.fromEntries(selectedCohort.enrolments.map(({ studentId }) => [
      studentId,
      savedByStudent.get(studentId) ?? true,
    ])));
  }, [attendance, attendanceDate, selectedCohort]);

  const submitAnnouncement = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const payload = {
        title: announcementForm.title,
        body: announcementForm.body,
        ...(announcementForm.audience === 'programme' && { programmeId: announcementForm.targetId }),
        ...(announcementForm.audience === 'cohort' && { cohortId: announcementForm.targetId }),
        ...(announcementForm.audience === 'course' && { courseId: announcementForm.targetId }),
      };
      await notificationsAPI.createAnnouncement(payload);
      setAnnouncementForm(initialAnnouncement);
      setNotice('Announcement published and notifications sent to its audience.');
      await loadPage();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not publish the announcement.');
    } finally {
      setSaving(false);
    }
  };

  const submitAttendance = async (event) => {
    event.preventDefault();
    if (!selectedCohort?.enrolments.length) {
      setError('Select a cohort with active learners before recording attendance.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    let savedCount = 0;
    const records = selectedCohort.enrolments.map(({ studentId }) => ({
      studentId,
      present: attendanceDraft[studentId] !== false,
    }));
    try {
      for (let start = 0; start < records.length; start += maxAttendanceStudents) {
        const batch = records.slice(start, start + maxAttendanceStudents);
        await notificationsAPI.recordAttendance({
          cohortId: selectedCohort.id,
          date: attendanceDate,
          records: batch,
        });
        savedCount += batch.length;
      }
      setNotice(`Attendance saved for ${records.length} learners across ${attendanceBatchCount} batch${attendanceBatchCount === 1 ? '' : 'es'}.`);
      await loadAttendance(selectedCohort.id, attendanceDate);
    } catch (requestError) {
      if (savedCount) {
        setNotice(`Saved attendance for ${savedCount} of ${records.length} learners. Retry to finish; saved entries are safe to resubmit.`);
      }
      setError(requestError.response?.data?.message || 'Could not record attendance.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-stack">
      <section className="page-heading">
        <div>
          <span className="eyebrow">Stay connected</span>
          <h1>Communications</h1>
          <p>Read academy updates and keep attendance records up to date.</p>
        </div>
      </section>
      {notice && <div className="notice notice-success">{notice}</div>}
      {error && <div className="notice notice-error" role="alert">{error}</div>}

      {canManage && <section className="card communication-section">
        <div className="card-heading"><div><span className="eyebrow">Share an update</span><h2>Publish announcement</h2></div><Megaphone size={20} /></div>
        <form className="communication-form" onSubmit={submitAnnouncement}>
          <Input label="Announcement title" maxLength={160} value={announcementForm.title} onChange={(title) => setAnnouncementForm((current) => ({ ...current, title }))} required />
          <Textarea label="Message" maxLength={10000} value={announcementForm.body} onChange={(body) => setAnnouncementForm((current) => ({ ...current, body }))} required />
          <div className="assessment-form-grid">
            <Select label="Audience" value={announcementForm.audience} onChange={(audience) => setAnnouncementForm((current) => ({ ...current, audience, targetId: '' }))} options={audienceOptions} required />
            {announcementForm.audience && announcementForm.audience !== 'all' && <Select label="Choose audience" value={announcementForm.targetId} onChange={(targetId) => setAnnouncementForm((current) => ({ ...current, targetId }))} options={audienceChoices[announcementForm.audience] || []} required />}
          </div>
          <Button type="submit" disabled={saving}>{saving ? 'Publishing…' : 'Publish announcement'}</Button>
        </form>
      </section>}

      <section className="card communication-section">
        <div className="card-heading"><div><span className="eyebrow">Academy updates</span><h2>Announcements</h2></div><Megaphone size={20} /></div>
        {loading ? <p className="communication-empty">Loading announcements…</p> : announcements.length ? <div className="announcement-list">
          {announcements.map((announcement) => <article className="announcement-item" key={announcement.id}>
            <div className="announcement-heading"><h3>{announcement.title}</h3><span>{announcementTargetLabel(announcement)}</span></div>
            <p>{announcement.body}</p>
            <div className="announcement-meta">
              <span>{announcement.author ? `Posted by ${announcement.author.firstName} ${announcement.author.lastName}` : 'Academy announcement'}</span>
              <time dateTime={announcement.createdAt}>{new Date(announcement.createdAt).toLocaleString()}</time>
            </div>
          </article>)}
          {announcementsHasMore && <div className="communication-load-more"><Button variant="secondary" disabled={announcementsLoadingMore} onClick={loadMoreAnnouncements}>{announcementsLoadingMore ? 'Loading…' : 'Load more announcements'}</Button></div>}
        </div> : <p className="communication-empty">There are no announcements for you yet.</p>}
      </section>

      {canManage && <section className="card communication-section">
        <div className="card-heading"><div><span className="eyebrow">Programme delivery</span><h2>Record attendance</h2></div><UsersRound size={20} /></div>
        {cohorts.length ? <>
          <form className="attendance-form" onSubmit={submitAttendance}>
            <div className="assessment-form-grid">
              <Select label="Cohort" value={selectedCohortId} onChange={setSelectedCohortId} options={cohortOptions} required />
              <Input label="Attendance date" type="date" max={todayLocal()} value={attendanceDate} onChange={setAttendanceDate} required />
            </div>
            {selectedCohort?.enrolments.length ? <div className="attendance-roster">
              {attendanceBatchCount > 1 && <p className="notice notice-warning">Attendance will be saved in {attendanceBatchCount} batches of up to {maxAttendanceStudents} learners.</p>}
              <div className="attendance-roster-summary">
                <span><strong>{attendanceSummary.present}</strong> present</span>
                <span><strong>{attendanceSummary.absent}</strong> absent</span>
                <div>
                  <Button size="sm" variant="ghost" disabled={saving} onClick={() => setAttendanceDraft(Object.fromEntries(selectedCohort.enrolments.map(({ studentId }) => [studentId, true])))}>Mark all present</Button>
                  <Button size="sm" variant="ghost" disabled={saving} onClick={() => setAttendanceDraft(Object.fromEntries(selectedCohort.enrolments.map(({ studentId }) => [studentId, false])))}>Mark all absent</Button>
                </div>
              </div>
              {selectedCohort.enrolments.map(({ studentId, student }) => <label className="attendance-roster-row" key={studentId}>
                <span>{student.firstName} {student.lastName}</span>
                <Select aria-label={`Attendance for ${student.firstName} ${student.lastName}`} value={attendanceDraft[studentId] === false ? 'ABSENT' : 'PRESENT'} onChange={(value) => setAttendanceDraft((current) => ({ ...current, [studentId]: value === 'PRESENT' }))} options={[{ value: 'PRESENT', label: 'Present' }, { value: 'ABSENT', label: 'Absent' }]} />
              </label>)}
            </div> : <p className="communication-empty">No active learners are enrolled in this cohort.</p>}
            <Button type="submit" disabled={saving || !selectedCohort?.enrolments.length}>{saving ? 'Saving…' : 'Save attendance'}</Button>
          </form>
        </> : <p className="communication-empty">{loading ? 'Loading cohorts…' : 'No cohorts are assigned to your account.'}</p>}
        <div className="attendance-history">
          <h3>Attendance for selected date</h3>
          {attendanceLoading ? <p className="communication-empty">Loading attendance…</p> : attendanceRecords.length ? <div className="attendance-history-list">{attendanceRecords.map((record) => <div className="attendance-history-row" key={record.id}>
            <span><strong>{record.student?.firstName} {record.student?.lastName}</strong><small>{record.cohort?.name}</small></span>
            <time dateTime={record.date}>{new Date(record.date).toLocaleDateString()}</time>
            <span className={`badge ${record.present ? 'badge-active' : 'badge-suspended'}`}>{record.present ? 'Present' : 'Absent'}</span>
          </div>)}</div> : <p className="communication-empty">No attendance recorded yet.</p>}
          {attendanceHasMore && <div className="communication-load-more"><Button variant="secondary" disabled={attendanceLoadingMore} onClick={loadMoreAttendance}>{attendanceLoadingMore ? 'Loading…' : 'Load more attendance'}</Button></div>}
        </div>
      </section>}

      {!canManage && <section className="card communication-section">
        <div className="card-heading"><div><span className="eyebrow">Your learning record</span><h2>My attendance</h2></div><UsersRound size={20} /></div>
        {loading ? <p className="communication-empty">Loading attendance…</p> : attendance.length ? <div className="attendance-history-list">
          {attendance.map((record) => <div className="attendance-history-row" key={record.id}>
            <span><strong>{record.cohort?.name || 'Cohort'}</strong></span>
            <time dateTime={record.date}>{new Date(record.date).toLocaleDateString()}</time>
            <span className={`badge ${record.present ? 'badge-active' : 'badge-suspended'}`}>{record.present ? 'Present' : 'Absent'}</span>
          </div>)}
          {attendanceHasMore && <div className="communication-load-more"><Button variant="secondary" disabled={attendanceLoadingMore} onClick={loadMoreAttendance}>{attendanceLoadingMore ? 'Loading…' : 'Load more attendance'}</Button></div>}
        </div> : <p className="communication-empty">Your attendance records will appear here.</p>}
      </section>}
    </div>
  );
}
