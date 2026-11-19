import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, Check, ChevronDown, ChevronUp, ClipboardCheck, Download, FileText, Pencil, Plus, Send, Trash2, Upload } from 'lucide-react';
import { coursesAPI, progressAPI, resourcesAPI } from '../../services/api';
import { useAuth } from '../../hooks/useAuth';
import { statusClass, statusLabel } from '../../components/common/navConfig';
import { Button } from '../../components/common/Button';
import { Input, Select, Textarea } from '../../components/forms/Input';
import { flattenCourseLessons } from './learningProgress.js';
import LessonContentRenderer from './LessonContentRenderer.jsx';
import LessonContentEditor from './LessonContentEditor.jsx';
import StudentCoursePlayer from './StudentCoursePlayer.jsx';
import CourseDiscussions from './CourseDiscussions.jsx';

const initialAssignment = { title: '', description: '', instructions: '', maxScore: 100, dueDate: '' };
const resourceAccept = '.mp4,.webm,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.gif,.webp';

const readLastLesson = (key) => {
  try {
    return window.localStorage.getItem(key);
  } catch (error) {
    console.error('Could not restore the last lesson:', error);
    return null;
  }
};

const saveLastLesson = (key, lessonId) => {
  try {
    window.localStorage.setItem(key, lessonId);
  } catch (error) {
    console.error('Could not save the last lesson:', error);
  }
};

export default function CourseDetailPage() {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const role = typeof user?.role === 'string' ? user.role : user?.role?.name;
  const lessonId = searchParams.get('lesson');
  const restoredCourseId = useRef('');
  const canManage = role === 'SUPER_ADMIN' || role === 'TRAINER';
  const [course, setCourse] = useState(null);
  const [studentProgress, setStudentProgress] = useState([]);
  const [progressLoadError, setProgressLoadError] = useState('');
  const [progressRetrying, setProgressRetrying] = useState(false);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [moduleTitle, setModuleTitle] = useState('');
  const [openLessonModule, setOpenLessonModule] = useState('');
  const [selectedLesson, setSelectedLesson] = useState(null);
  const [lessonLoading, setLessonLoading] = useState(false);
  const [lessonLoadError, setLessonLoadError] = useState('');
  const [lessonRetryKey, setLessonRetryKey] = useState(0);
  const [resourceSaving, setResourceSaving] = useState(false);
  const [assignmentDraft, setAssignmentDraft] = useState(initialAssignment);
  const [submissionDrafts, setSubmissionDrafts] = useState({});
  const [selectedAssignment, setSelectedAssignment] = useState(null);
  const [expandedModules, setExpandedModules] = useState({});
  const [completingLesson, setCompletingLesson] = useState(false);
  const [accessSaving, setAccessSaving] = useState(false);
  const [accessError, setAccessError] = useState('');
  const [lessonDraft, setLessonDraft] = useState({
    title: '',
    type: 'TEXT',
    content: '[]',
    videoUrl: '',
    isPublished: true,
    objectives: [],
    outcomes: [],
    estimatedDuration: '',
  });
  const [editingLessonId, setEditingLessonId] = useState('');
  const [lessonMetadataDirty, setLessonMetadataDirty] = useState(false);

  const loadCourse = useCallback(async () => {
    setLoading(true);
    setError('');
    setProgressLoadError('');
    try {
      const [courseResponse, assignmentsResponse] = await Promise.all([
        coursesAPI.get(id),
        coursesAPI.listAssignments({ courseId: id }),
      ]);
      setCourse(courseResponse.data.data);
      setAssignments(assignmentsResponse.data.data || []);
      if (role === 'STUDENT') {
        try {
          const { data } = await progressAPI.mine();
          setStudentProgress(data.data || []);
        } catch (requestError) {
          setStudentProgress([]);
          setProgressLoadError(requestError.response?.data?.message || 'Could not load your saved lesson position.');
        }
      } else {
        setStudentProgress([]);
      }
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not load this course.');
    } finally {
      setLoading(false);
    }
  }, [id, role]);

  useEffect(() => { loadCourse(); }, [loadCourse]);

  const runAction = async (action, successMessage) => {
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(successMessage);
      await loadCourse();
      return true;
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'That action could not be completed.');
      return false;
    }
  };

  const refreshSelectedLesson = async (lessonId) => {
    if (!lessonId) return;
    const { data } = await coursesAPI.getLesson(lessonId);
    setSelectedLesson(data.data);
  };

  const uploadResource = async (event, lessonId = null) => {
    event.preventDefault();
    const uploadForm = event.currentTarget;
    const formData = new FormData(uploadForm);
    formData.set('courseId', id);
    if (lessonId) formData.set('lessonId', lessonId);
    setResourceSaving(true);
    setError('');
    setNotice('');
    try {
      await resourcesAPI.upload(formData);
      uploadForm.reset();
      await loadCourse();
      await refreshSelectedLesson(lessonId);
      setNotice('Learning material uploaded.');
    } catch (requestError) {
      setError(requestError.response?.data?.message || requestError.message || 'Could not upload this learning material.');
    } finally {
      setResourceSaving(false);
    }
  };

  const deleteResource = async (resource, lessonId = null) => {
    if (!window.confirm(`Delete "${resource.originalName}"? This cannot be undone.`)) return;
    setError('');
    setNotice('');
    try {
      await resourcesAPI.delete(resource.id);
      await loadCourse();
      await refreshSelectedLesson(lessonId);
      setNotice('Learning material deleted.');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not delete this learning material.');
    }
  };

  const createModule = async (event) => {
    event.preventDefault();
    await runAction(
      () => coursesAPI.createModule(id, { title: moduleTitle }),
      'Module added to this course.',
    );
    setModuleTitle('');
  };

  const saveLesson = async (moduleId, blocks) => {
    const editing = Boolean(editingLessonId);
    if (!lessonDraft.title.trim()) throw new Error('Lesson title is required.');
    const lessonData = {
      ...lessonDraft,
      content: JSON.stringify(blocks),
    };
    setError('');
    setNotice('');
    try {
      const { data } = await (editing
        ? coursesAPI.updateLesson(editingLessonId, lessonData)
        : coursesAPI.createLesson(moduleId, lessonData));
      const savedLesson = data.data;
      setCourse((current) => ({
        ...current,
        modules: current.modules.map((module) => {
          if (module.id !== moduleId) return module;
          return {
            ...module,
            lessons: editing
              ? module.lessons.map((lesson) => (lesson.id === savedLesson.id ? { ...lesson, ...savedLesson } : lesson))
              : [...module.lessons, savedLesson],
          };
        }),
      }));
      setSelectedLesson((current) => (
        current?.id === savedLesson.id ? { ...current, ...savedLesson } : current
      ));
      setNotice(editing ? 'Lesson updated.' : 'Lesson added to the course.');
      return savedLesson;
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not save this lesson.');
      throw requestError;
    }
  };

  const finishLessonEdit = () => {
    setLessonDraft({ title: '', type: 'TEXT', content: '', videoUrl: '', isPublished: true });
    setEditingLessonId('');
    setOpenLessonModule('');
    setLessonMetadataDirty(false);
  };

  const editModule = async (module) => {
    const title = window.prompt('Module title', module.title);
    if (title === null || !title.trim() || title.trim() === module.title) return;
    await runAction(() => coursesAPI.updateModule(module.id, { title: title.trim() }), 'Module updated.');
  };

  const deleteModule = async (module) => {
    if (!window.confirm(`Delete "${module.title}" and its lessons? This cannot be undone.`)) return;
    await runAction(() => coursesAPI.deleteModule(module.id), 'Module deleted.');
  };

  const editLesson = (moduleId, lesson) => {
    setOpenLessonModule(moduleId);
    setEditingLessonId(lesson.id);
    setLessonDraft({
      title: lesson.title || '',
      type: lesson.type || 'TEXT',
      content: lesson.content || '',
      videoUrl: lesson.videoUrl || '',
      isPublished: Boolean(lesson.isPublished),
    });
    setLessonMetadataDirty(false);
  };

  const deleteLesson = async (lesson) => {
    if (!window.confirm(`Delete "${lesson.title}"? This cannot be undone.`)) return;
    await runAction(() => coursesAPI.deleteLesson(lesson.id), 'Lesson deleted.');
  };

  const openLesson = (lesson) => {
    setError('');
    setSearchParams({ lesson: lesson.id });
  };

  const completeLesson = async () => {
    if (!selectedLesson) return;
    setCompletingLesson(true);
    setError('');
    try {
      const { data } = await progressAPI.completeLesson(selectedLesson.id);
      setSelectedLesson((current) => ({ ...current, progress: data.data }));
      setCourse((current) => ({
        ...current,
        modules: current.modules.map((module) => ({
          ...module,
          lessons: module.lessons.map((lesson) => (
            lesson.id === selectedLesson.id ? { ...lesson, isCompleted: true } : lesson
          )),
        })),
      }));
      setNotice('Lesson marked complete.');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not update lesson progress.');
    } finally {
      setCompletingLesson(false);
    }
  };

  useEffect(() => {
    if (!course || course.id !== id || restoredCourseId.current === id) return;
    restoredCourseId.current = id;
    if (lessonId || role !== 'STUDENT') return;

    const lastAccessed = studentProgress.find((item) => item.lesson?.module?.course?.id === id);
    const savedLessonId = lastAccessed?.lessonId || readLastLesson(`reoacademy:last-lesson:${user.id}:${id}`);
    const savedLesson = flattenCourseLessons(course.modules).find(({ id: savedId }) => savedId === savedLessonId);
    if (savedLesson) setSearchParams({ lesson: savedLesson.id }, { replace: true });
  }, [course, id, lessonId, role, setSearchParams, studentProgress, user?.id]);

  useEffect(() => {
    if (!lessonId) {
      setSelectedLesson(null);
      setLessonLoading(false);
      setLessonLoadError('');
      return undefined;
    }

    let active = true;
    setLessonLoading(true);
    setSelectedLesson(null);
    setAccessError('');
    setLessonLoadError('');
    coursesAPI.getLesson(lessonId)
      .then(async ({ data }) => {
        const lesson = data.data;
        if (lesson.module?.courseId !== id) {
          throw new Error('This lesson does not belong to the current course.');
        }
        if (!active) return;
        setSelectedLesson(lesson);
        if (role === 'STUDENT') {
          saveLastLesson(`reoacademy:last-lesson:${user.id}:${id}`, lesson.id);
          try {
            const { data: accessResponse } = await progressAPI.accessLesson(lesson.id);
            if (active) {
              const accessed = accessResponse.data;
              setStudentProgress((current) => [
                accessed,
                ...current.filter((item) => item.lessonId !== accessed.lessonId),
              ].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)));
            }
          } catch (requestError) {
            if (active) setAccessError(requestError.response?.data?.message || 'Could not save your place in this course.');
          }
        }
      })
      .catch((requestError) => {
        if (!active) return;
        setSelectedLesson(null);
        const message = requestError.response?.data?.message || requestError.message || 'Could not open this lesson.';
        if (role === 'STUDENT') setLessonLoadError(message);
        else setError(message);
      })
      .finally(() => {
        if (active) setLessonLoading(false);
      });

    return () => { active = false; };
  }, [id, lessonId, lessonRetryKey, role, user?.id]);

  const retryLessonAccess = async () => {
    if (!selectedLesson) return;
    setAccessSaving(true);
    setAccessError('');
    try {
      const { data } = await progressAPI.accessLesson(selectedLesson.id);
      const accessed = data.data;
      setStudentProgress((current) => [
        accessed,
        ...current.filter((item) => item.lessonId !== accessed.lessonId),
      ].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)));
    } catch (requestError) {
      setAccessError(requestError.response?.data?.message || 'Could not save your place in this course.');
    } finally {
      setAccessSaving(false);
    }
  };

  const retryProgressLoad = async () => {
    setProgressRetrying(true);
    setProgressLoadError('');
    try {
      const { data } = await progressAPI.mine();
      setStudentProgress(data.data || []);
    } catch (requestError) {
      setProgressLoadError(requestError.response?.data?.message || 'Could not load your saved lesson position.');
    } finally {
      setProgressRetrying(false);
    }
  };

  const createAssignment = async (event) => {
    event.preventDefault();
    const form = {
      ...assignmentDraft,
      maxScore: Number(assignmentDraft.maxScore),
      dueDate: assignmentDraft.dueDate ? new Date(assignmentDraft.dueDate).toISOString() : undefined,
      status: 'PUBLISHED',
    };
    await runAction(
      () => coursesAPI.createAssignment(id, form),
      'Assignment published.',
    );
    setAssignmentDraft(initialAssignment);
  };

  const submitAssignment = async (event, assignmentId) => {
    event.preventDefault();
    const content = submissionDrafts[assignmentId] || '';
    if (!content.trim()) {
      setError('Write your response before submitting.');
      return;
    }
    const submitted = await runAction(
      () => coursesAPI.submitAssignment(assignmentId, { content }),
      'Your work has been saved.',
    );
    if (submitted) {
      setSubmissionDrafts((drafts) => ({ ...drafts, [assignmentId]: content }));
    }
  };

  const showSubmissions = async (assignment) => {
    setError('');
    try {
      const { data } = await coursesAPI.getAssignment(assignment.id);
      setSelectedAssignment(data.data);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not load submissions.');
    }
  };

  const gradeSubmission = async (event, submission) => {
    event.preventDefault();
    const draft = submissionDrafts[submission.id] || {};
    await runAction(
      () => coursesAPI.gradeSubmission(submission.id, { score: Number(draft.score), feedback: draft.feedback || '' }),
      'Submission graded.',
    );
    setSelectedAssignment(null);
  };

  const releaseGrade = async (submission) => {
    setError('');
    setNotice('');
    try {
      await coursesAPI.releaseSubmissionGrade(submission.id);
      const { data } = await coursesAPI.getAssignment(selectedAssignment.id);
      setSelectedAssignment(data.data);
      setNotice('Grade released to the student.');
      await loadCourse();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not release this grade.');
    }
  };

  if (loading) return <div className="card loading-card">Opening course…</div>;
  if (error && !course) {
    return <div className="page-stack">
      <div className="notice notice-error" role="alert">{error}</div>
      <div className="lesson-form-actions">
        <Button type="button" onClick={loadCourse}>Retry</Button>
        <Link className="btn btn-secondary" to="/courses"><ArrowLeft size={16} /> Back to courses</Link>
      </div>
    </div>;
  }
  if (!course) return null;
  const lessons = flattenCourseLessons(course.modules);
  const selectedLessonIndex = lessons.findIndex((lesson) => lesson.id === selectedLesson?.id);

  return (
    <div className="page-stack">
      {role !== 'STUDENT' && <Link className="back-link" to="/courses"><ArrowLeft size={16} /> All courses</Link>}
      {role !== 'STUDENT' && <section className="course-hero">
        <div>
          <span className="eyebrow eyebrow-light">{course.programme?.title || 'REO Travel Academy'}</span>
          <h1>{course.title}</h1>
          <p>{course.description || 'Explore the lessons and activities in this course.'}</p>
        </div>
        <span className={statusClass(course.status)}>{statusLabel(course.status)}</span>
      </section>}

      {notice && <div className="notice notice-success">{notice}</div>}
      {error && <div className="notice notice-error" role="alert">{error}</div>}

      {role === 'STUDENT' && <StudentCoursePlayer
        course={course}
        selectedLesson={selectedLesson}
        lessonLoading={lessonLoading}
        lessonLoadError={lessonLoadError}
        studentProgress={studentProgress}
        progressLoadError={progressLoadError}
        progressRetrying={progressRetrying}
        onRetryProgress={retryProgressLoad}
        onOpenLesson={openLesson}
        onCloseLesson={() => setSearchParams({}, { replace: true })}
        onRetryLesson={() => setLessonRetryKey((key) => key + 1)}
        onCompleteLesson={completeLesson}
        completingLesson={completingLesson}
        accessError={accessError}
        accessSaving={accessSaving}
        onRetryAccess={retryLessonAccess}
      />}
      {['STUDENT', 'TRAINER', 'SUPER_ADMIN'].includes(role) && <CourseDiscussions
        key={id}
        courseId={id}
        courseTitle={course.title}
        selectedLesson={selectedLesson}
        role={role}
      />}

      {role !== 'STUDENT' && lessonLoading && !selectedLesson && <div className="card loading-card" role="status">Opening lesson…</div>}
      {role !== 'STUDENT' && selectedLesson && <section className="card lesson-viewer" aria-label="Lesson content">
        <div className="card-heading">
          <div><span className="eyebrow">{selectedLesson.module.course.title}</span><h2>{selectedLesson.title}</h2></div>
          <Button variant="ghost" onClick={() => setSearchParams({}, { replace: true })}>Close lesson</Button>
        </div>
        {selectedLessonIndex >= 0 && <div className="lesson-navigation">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => openLesson(lessons[selectedLessonIndex - 1])}
            disabled={selectedLessonIndex === 0}
          >Previous lesson</Button>
          <span aria-live="polite">Lesson {selectedLessonIndex + 1} of {lessons.length}</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => openLesson(lessons[selectedLessonIndex + 1])}
            disabled={selectedLessonIndex === lessons.length - 1}
          >Next lesson</Button>
        </div>}
        {selectedLesson.type === 'VIDEO' && selectedLesson.videoUrl && (
          <p><a className="text-link" href={selectedLesson.videoUrl} target="_blank" rel="noreferrer">Open lesson video</a></p>
        )}
        <LessonContentRenderer
          content={selectedLesson.content}
          resources={[...(course.resources || []), ...(selectedLesson.resources || [])]}
        />
        {selectedLesson.resources?.length > 0 && <div className="lesson-resources">
          <strong>Lesson resources</strong>
          {selectedLesson.resources.map((resource) => <div className="course-resource-row" key={resource.id}>
            {resource.mimeType.startsWith('video/')
              ? <video className="lesson-resource-video" controls preload="metadata" src={resourcesAPI.downloadUrl(resource.id)}>
                Your browser cannot play this video.
              </video>
              : <a href={resourcesAPI.downloadUrl(resource.id)} target="_blank" rel="noreferrer"><Download size={15} /> {resource.originalName}</a>}
            {canManage && <button className="icon-button action-danger" type="button" aria-label={`Delete ${resource.originalName}`} onClick={() => deleteResource(resource, selectedLesson.id)}><Trash2 size={15} /></button>}
          </div>)}
        </div>}
        {canManage && <form className="resource-upload-form" onSubmit={(event) => uploadResource(event, selectedLesson.id)}>
          <strong>Add video or training material to this lesson</strong>
          <p className="muted small">MP4/WebM video, PDF, Office documents, spreadsheet, text, or image.</p>
          <input className="input" type="file" name="file" accept={resourceAccept} required />
          <Button type="submit" variant="secondary" disabled={resourceSaving}><Upload size={15} /> {resourceSaving ? 'Uploading…' : 'Upload to lesson'}</Button>
        </form>}
        {role === 'STUDENT' && (
          <div className="lesson-completion">
            {selectedLesson.progress?.completed
              ? <span className="badge badge-completed"><Check size={14} /> Completed</span>
              : <Button onClick={completeLesson} disabled={completingLesson}><Check size={15} /> {completingLesson ? 'Saving…' : 'Mark lesson complete'}</Button>}
          </div>
        )}
      </section>}

      {role !== 'STUDENT' && (canManage || course.resources?.some((resource) => !resource.lessonId)) && <section className="card course-content-panel">
        <div className="card-heading">
          <div><span className="eyebrow">Shared learning material</span><h2>Course materials</h2></div>
          <span className="muted small">{course.resources?.filter((resource) => !resource.lessonId).length || 0} files</span>
        </div>
        {course.resources?.filter((resource) => !resource.lessonId).map((resource) => <div className="course-resource-row" key={resource.id}>
          <a href={resourcesAPI.downloadUrl(resource.id)} target="_blank" rel="noreferrer"><Download size={15} /> {resource.originalName}</a>
          {canManage && <button className="icon-button action-danger" type="button" aria-label={`Delete ${resource.originalName}`} onClick={() => deleteResource(resource)}><Trash2 size={15} /></button>}
        </div>)}
        {canManage && <form className="resource-upload-form" onSubmit={(event) => uploadResource(event)}>
          <strong>Upload material for the whole course</strong>
          <p className="muted small">Materials attached here are available to learners enrolled in this published course.</p>
          <input className="input" type="file" name="file" accept={resourceAccept} required />
          <Button type="submit" variant="secondary" disabled={resourceSaving}><Upload size={15} /> {resourceSaving ? 'Uploading…' : 'Upload course material'}</Button>
        </form>}
      </section>}

      {role !== 'STUDENT' && <section className="card course-content-panel">
        <div className="card-heading">
          <div><span className="eyebrow">Learning path</span><h2>Course modules</h2></div>
          <span className="muted small">{course.modules?.length || 0} modules</span>
        </div>
        {canManage && (
          <form className="inline-create-form" onSubmit={createModule}>
            <Input aria-label="Module title" placeholder="Name your next module" value={moduleTitle} onChange={setModuleTitle} required />
            <Button type="submit"><Plus size={16} /> Add module</Button>
          </form>
        )}
        {course.modules?.length ? course.modules.map((module, index) => {
          const expanded = expandedModules[module.id] !== false;
          const editingThisModuleLesson = editingLessonId && module.lessons?.some((lesson) => lesson.id === editingLessonId);
          return (
            <article className="module-card" key={module.id}>
              <button className="module-heading" onClick={() => setExpandedModules((current) => ({ ...current, [module.id]: !expanded }))} aria-expanded={expanded}>
                <span className="module-number">{String(index + 1).padStart(2, '0')}</span>
                <span className="module-title"><strong>{module.title}</strong><small>{module.lessons?.length || 0} lessons</small></span>
                {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </button>
              {expanded && <div className="module-body">
                {canManage && <div className="module-actions">
                  <Button variant="ghost" size="sm" onClick={() => editModule(module)}><Pencil size={14} /> Rename module</Button>
                  <Button variant="ghost" size="sm" className="action-danger" onClick={() => deleteModule(module)}><Trash2 size={14} /> Delete module</Button>
                </div>}
                {module.lessons?.length ? module.lessons.map((lesson) => (
                  <div className="lesson-row" key={lesson.id}>
                    <span className="lesson-icon"><FileText size={17} /></span>
                    <span><strong>{lesson.title}</strong><small>{lesson.type.replaceAll('_', ' ').toLowerCase()}{!lesson.isPublished ? ' · Draft' : ''}{lesson.isCompleted ? ' · Completed' : ''}</small></span>
                    {!canManage && <Button
                      variant="ghost"
                      size="sm"
                      aria-current={lesson.id === lessonId ? 'page' : undefined}
                      onClick={() => openLesson(lesson)}
                    >{lesson.id === lessonId ? 'Current lesson' : lesson.isCompleted ? 'Review lesson' : 'Open lesson'}</Button>}
                    {canManage && <span className="lesson-actions">
                      <Button variant="ghost" size="sm" onClick={() => openLesson(lesson)}>Materials</Button>
                      <button className="icon-button" onClick={() => editLesson(module.id, lesson)} title="Edit lesson" aria-label={`Edit ${lesson.title}`}><Pencil size={14} /></button>
                      <button className="icon-button action-danger" onClick={() => deleteLesson(lesson)} title="Delete lesson" aria-label={`Delete ${lesson.title}`}><Trash2 size={14} /></button>
                    </span>}
                  </div>
                )) : <p className="muted small lesson-empty">No lessons have been added to this module yet.</p>}
                {canManage && (openLessonModule === module.id ? (
                  <div className="lesson-form">
                    <Input label="Lesson title" value={lessonDraft.title} onChange={(title) => {
                      setLessonDraft((draft) => ({ ...draft, title }));
                      setLessonMetadataDirty(true);
                    }} required />
                    <Select label="Lesson type" value={lessonDraft.type} onChange={(type) => {
                      setLessonDraft((draft) => ({ ...draft, type }));
                      setLessonMetadataDirty(true);
                    }} options={[
                      { value: 'TEXT', label: 'Text lesson' },
                      { value: 'VIDEO', label: 'Video' },
                      { value: 'DOCUMENT', label: 'Document' },
                      { value: 'LINK', label: 'External link' },
                    ]} />
                    {lessonDraft.type === 'VIDEO' && <Input label="Video URL" type="url" value={lessonDraft.videoUrl} onChange={(videoUrl) => {
                      setLessonDraft((draft) => ({ ...draft, videoUrl }));
                      setLessonMetadataDirty(true);
                    }} />}
                    <label className="builder-checkbox"><input type="checkbox" checked={lessonDraft.isPublished} onChange={(event) => {
                      setLessonDraft((draft) => ({ ...draft, isPublished: event.target.checked }));
                      setLessonMetadataDirty(true);
                    }} /> Include in learner course</label>
                    <LessonContentEditor
                      key={editingLessonId || `new-${module.id}`}
                      content={lessonDraft.content}
                      resources={[...(course.resources || []), ...(selectedLesson?.resources || [])]}
                      externalDirty={lessonMetadataDirty}
                      onSave={(blocks) => saveLesson(module.id, blocks)}
                      onCancel={finishLessonEdit}
                      onSaved={finishLessonEdit}
                      saveLabel={editingThisModuleLesson ? 'Save lesson changes' : 'Add lesson'}
                    />
                  </div>
                ) : <Button variant="secondary" size="sm" onClick={() => setOpenLessonModule(module.id)}><Plus size={15} /> Add lesson</Button>)}
              </div>}
            </article>
          );
        }) : <div className="empty-state"><BookOpen size={24} /><h3>Your course outline starts here</h3><p>Add a module, then build it out with lessons and learning materials.</p></div>}
      </section>}

      {!(role === 'STUDENT' && selectedLesson) && <section className="card course-content-panel">
        <div className="card-heading">
          <div><span className="eyebrow">Practice &amp; feedback</span><h2>Assignments</h2></div>
          <span className="muted small">{assignments.length} assignments</span>
        </div>
        {canManage && (
          <form className="assignment-form" onSubmit={createAssignment}>
            <Input label="Assignment title" value={assignmentDraft.title} onChange={(title) => setAssignmentDraft((draft) => ({ ...draft, title }))} required />
            <Textarea label="Instructions" value={assignmentDraft.instructions} onChange={(instructions) => setAssignmentDraft((draft) => ({ ...draft, instructions }))} required />
            <div className="assignment-form-row">
              <Input label="Maximum score" type="number" min="1" value={assignmentDraft.maxScore} onChange={(maxScore) => setAssignmentDraft((draft) => ({ ...draft, maxScore }))} required />
              <Input label="Due date" type="datetime-local" value={assignmentDraft.dueDate} onChange={(dueDate) => setAssignmentDraft((draft) => ({ ...draft, dueDate }))} />
              <Button type="submit"><Plus size={16} /> Publish assignment</Button>
            </div>
          </form>
        )}
        {assignments.length ? <div className="assignment-list">
          {assignments.map((assignment) => {
            const submissions = assignment.submissions || [];
            const latestSubmission = submissions[0];
            const deadlinePassed = assignment.dueDate && new Date(assignment.dueDate).getTime() < Date.now();
            const canResubmit = !latestSubmission || latestSubmission.canResubmit !== false;
            const canSubmit = !deadlinePassed && canResubmit;
            return (
            <article className="assignment-card" key={assignment.id}>
              <div className="assignment-heading"><span className="assignment-icon"><ClipboardCheck size={18} /></span><span><strong>{assignment.title}</strong><small>{assignment.dueDate ? `Due ${new Date(assignment.dueDate).toLocaleString()}` : 'No due date'} · Up to {assignment.maxScore} points</small></span></div>
              <p>{assignment.instructions || assignment.description || 'Review the instructions and submit your work.'}</p>
              {canManage ? <Button variant="secondary" size="sm" onClick={() => showSubmissions(assignment)}>Review submissions</Button> : (
                <div className="student-assignment-work">
                  {submissions.length > 0 && <div className="submission-history" aria-label="Submission history">
                    <strong>Your submissions</strong>
                    {submissions.map((submission, index) => (
                      <div className="submission-history-entry" key={submission.id}>
                        <div>
                          <span className={statusClass(submission.status)}>{statusLabel(submission.status)}</span>
                          <time dateTime={submission.submittedAt}>{new Date(submission.submittedAt).toLocaleString()}</time>
                        </div>
                        {submission.content && <p>{submission.content}</p>}
                        {submission.grade?.released && <p className="submission-feedback">
                          Score <strong>{submission.grade.score}/{assignment.maxScore}</strong>
                          {submission.grade.feedback && <> · {submission.grade.feedback}</>}
                        </p>}
                        {index === 0 && !submission.canResubmit && !submission.grade?.released && (
                          <p className="muted small">Your work is being reviewed. Editing is unavailable after grading begins.</p>
                        )}
                      </div>
                    ))}
                  </div>}
                  {canSubmit ? <form className="submission-form" onSubmit={(event) => submitAssignment(event, assignment.id)}>
                    <Textarea
                      label={latestSubmission ? 'Revise your response' : 'Your response'}
                      value={submissionDrafts[assignment.id] ?? latestSubmission?.content ?? ''}
                      onChange={(content) => setSubmissionDrafts((drafts) => ({ ...drafts, [assignment.id]: content }))}
                      placeholder="Write your answer here…"
                      required
                    />
                    <Button type="submit"><Send size={15} /> {latestSubmission ? 'Save revised submission' : 'Submit work'}</Button>
                  </form> : deadlinePassed && !latestSubmission ? (
                    <p className="notice notice-warning">The deadline has passed. Submissions are closed.</p>
                  ) : null}
                  {deadlinePassed && latestSubmission && <p className="muted small">The deadline has passed. Your submitted work is available for review.</p>}
                </div>
              )}
            </article>
            );
          })}
        </div> : <div className="empty-state"><h3>No assignments yet</h3><p>Published course assignments will appear here.</p></div>}
      </section>}

      {selectedAssignment && <section className="card course-content-panel">
        <div className="card-heading">
          <div><span className="eyebrow">Trainer workspace</span><h2>Submissions · {selectedAssignment.title}</h2></div>
          <Button variant="ghost" onClick={() => setSelectedAssignment(null)}>Close</Button>
        </div>
        {selectedAssignment.submissions?.length ? selectedAssignment.submissions.map((submission) => (
          <form className="submission-review" key={submission.id} onSubmit={(event) => gradeSubmission(event, submission)}>
            <div className="submission-student"><span className="person-avatar">{`${submission.student.firstName?.[0] || ''}${submission.student.lastName?.[0] || ''}`.toUpperCase()}</span><span><strong>{submission.student.firstName} {submission.student.lastName}</strong><small>Submitted {new Date(submission.submittedAt).toLocaleString()}</small></span></div>
            <p>{submission.content || 'File submission'}</p>
            {submission.grade ? <div className="submission-grade-status">
              <span className="badge badge-graded">Scored {submission.grade.score} · {submission.grade.feedback || 'No feedback'}{submission.grade.released ? ' · Released' : ' · Not released'}</span>
              {!submission.grade.released && <Button type="button" size="sm" onClick={() => releaseGrade(submission)}>Release grade</Button>}
            </div> : <>
              <Input label={`Score (out of ${selectedAssignment.maxScore})`} type="number" min="0" max={selectedAssignment.maxScore} value={submissionDrafts[submission.id]?.score || ''} onChange={(score) => setSubmissionDrafts((drafts) => ({ ...drafts, [submission.id]: { ...drafts[submission.id], score } }))} required />
              <Input label="Feedback" value={submissionDrafts[submission.id]?.feedback || ''} onChange={(feedback) => setSubmissionDrafts((drafts) => ({ ...drafts, [submission.id]: { ...drafts[submission.id], feedback } }))} />
              <Button type="submit"><Check size={15} /> Save grade</Button>
            </>}
          </form>
        )) : <div className="empty-state"><h3>No submissions yet</h3><p>Student work will appear here when it is submitted.</p></div>}
      </section>}
    </div>
  );
}
