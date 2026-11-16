import { useState } from 'react';
import { ArrowLeft, BookOpen, Check, ChevronLeft, ChevronRight, Clock3, Download, GraduationCap, List, Play, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/common/Button';
import { resourcesAPI } from '../../services/api';
import { flattenCourseLessons, getCourseLessonProgress } from './learningProgress.js';
import LessonContentRenderer from './LessonContentRenderer.jsx';

const getOutcomes = (value) => {
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string' && item.trim());
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter((item) => typeof item === 'string' && item.trim());
  } catch {
    return value.split('\n').map((item) => item.trim()).filter(Boolean);
  }
  return [];
};

const safeImageSource = (value) => {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value, window.location.origin);
    return ['http:', 'https:'].includes(url.protocol) ? value : '';
  } catch {
    return '';
  }
};

const safeExternalUrl = (value) => {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? value : '';
  } catch {
    return '';
  }
};

function ResourceList({ resources, title }) {
  if (!resources.length) return null;
  return (
    <section className="student-player-resources" aria-label={title}>
      <h3>{title}</h3>
      {resources.map((resource) => (
        <a key={resource.id} href={resourcesAPI.downloadUrl(resource.id)} target="_blank" rel="noreferrer">
          <Download size={15} />
          <span>{resource.originalName || 'Course resource'}<small>{resource.mimeType || 'Learning material'}</small></span>
        </a>
      ))}
    </section>
  );
}

function CourseVideo({ url }) {
  const [unavailable, setUnavailable] = useState(false);
  if (unavailable) {
    return <p className="lesson-resource-unavailable" role="note">This video could not be loaded. Contact your Tutor.</p>;
  }
  return <video className="student-player-video" controls preload="metadata" src={url} onError={() => setUnavailable(true)}>
    Your browser cannot play this video.
  </video>;
}

function LessonOutline({ course, lessons, selectedLesson, onOpenLesson, progress, open }) {
  return (
    <aside className={`student-player-sidebar${open ? ' is-open' : ''}`} aria-label="Course lessons">
      <div className="student-player-sidebar-heading">
        <div><span className="eyebrow">Course contents</span><strong>{course.title}</strong></div>
        <span>{progress.completed}/{progress.total}</span>
      </div>
      <progress value={progress.completed} max={progress.total || 1} aria-label={`${progress.percentage}% of lessons completed`} />
      {course.modules.map((module, index) => (
        <section className="student-player-module" key={module.id}>
          <div className="student-player-module-title">
            <span>{String(index + 1).padStart(2, '0')}</span>
            <strong>{module.title}</strong>
          </div>
          {module.description && <p>{module.description}</p>}
          <div className="student-player-lesson-list">
            {(module.lessons || []).map((lesson) => (
              <button
                type="button"
                key={lesson.id}
                className={`student-player-lesson${selectedLesson?.id === lesson.id ? ' is-current' : ''}`}
                aria-current={selectedLesson?.id === lesson.id ? 'page' : undefined}
                onClick={() => onOpenLesson(lesson)}
              >
                <span className="student-player-lesson-state">
                  {lesson.isCompleted ? <Check size={14} aria-label="Completed" /> : <Play size={12} aria-hidden="true" />}
                </span>
                <span>{lesson.title}</span>
              </button>
            ))}
            {!module.lessons?.length && <p className="muted small">No published lessons yet.</p>}
          </div>
        </section>
      ))}
      {!lessons.length && <p className="muted small">No published lessons are available yet.</p>}
    </aside>
  );
}

export default function StudentCoursePlayer({
  course,
  selectedLesson,
  lessonLoading,
  lessonLoadError,
  studentProgress = [],
  progressLoadError,
  progressRetrying,
  onOpenLesson,
  onCloseLesson,
  onCompleteLesson,
  completingLesson,
  accessError,
  accessSaving,
  onRetryAccess,
  onRetryLesson,
  onRetryProgress,
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const lessons = flattenCourseLessons(course.modules);
  const progress = getCourseLessonProgress(lessons);
  const selectedLessonIndex = lessons.findIndex((lesson) => lesson.id === selectedLesson?.id);
  const lastAccessed = studentProgress.find((item) => (
    item.lesson?.module?.course?.id === course.id
    && lessons.some((lesson) => lesson.id === item.lessonId)
  ));
  const lastAccessedLesson = lessons.find((lesson) => lesson.id === lastAccessed?.lessonId);
  const nextLesson = lessons.find((lesson) => !lesson.isCompleted) || lessons[0];
  const outcomes = getOutcomes(course.learningOutcomes);
  const trainers = (course.trainers || []).map(({ trainer }) => trainer).filter(Boolean);
  const coverImage = safeImageSource(course.thumbnailUrl || course.thumbnail || course.coverImage);
  const lessonVideoUrl = safeExternalUrl(selectedLesson?.videoUrl);
  const isDirectVideoFile = /\.(mp4|webm|ogg)(\?.*)?$/i.test(lessonVideoUrl);
  const navigateToLesson = (lesson) => {
    setSidebarOpen(false);
    onOpenLesson(lesson);
  };

  if (lessonLoading && !selectedLesson) {
    return <section className="student-player" aria-label="Lesson player">
      <header className="student-player-topbar">
        <Button type="button" variant="ghost" onClick={onCloseLesson}><ArrowLeft size={16} /> Course overview</Button>
        <span>{course.programme?.title || 'REO Travel Academy'}</span>
      </header>
      <div className="card loading-card" role="status">Opening lesson…</div>
    </section>;
  }

  if (lessonLoadError && !selectedLesson) {
    return <section className="student-player" aria-label="Lesson player">
      <header className="student-player-topbar">
        <Button type="button" variant="ghost" onClick={onCloseLesson}><ArrowLeft size={16} /> Course overview</Button>
        <span>{course.programme?.title || 'REO Travel Academy'}</span>
      </header>
      <div className="notice notice-error student-player-access-error" role="alert">
        <span>{lessonLoadError}</span>
        <Button type="button" variant="ghost" size="sm" onClick={onRetryLesson}>Retry opening lesson</Button>
      </div>
    </section>;
  }

  if (selectedLesson) {
    return (
      <section className="student-player" aria-label="Lesson player">
        <header className="student-player-topbar">
          <Button type="button" variant="ghost" onClick={onCloseLesson}><ArrowLeft size={16} /> Course overview</Button>
          <span>{course.programme?.title || 'REO Travel Academy'}</span>
          <Button
            type="button"
            variant="secondary"
            className="student-player-outline-toggle"
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen((open) => !open)}
          ><List size={16} /> {sidebarOpen ? 'Hide lessons' : 'Course lessons'}</Button>
        </header>
        <div className="student-player-layout">
          <LessonOutline
            course={course}
            lessons={lessons}
            selectedLesson={selectedLesson}
            onOpenLesson={navigateToLesson}
            progress={progress}
            open={sidebarOpen}
          />
          <main className="student-player-main">
            {progressLoadError && <div className="notice notice-error student-player-access-error" role="alert">
              <span>{progressLoadError}</span>
              <Button type="button" variant="ghost" size="sm" onClick={onRetryProgress} disabled={progressRetrying}>
                {progressRetrying ? 'Retrying…' : 'Retry progress'}
              </Button>
            </div>}
            {accessError && <div className="notice notice-error student-player-access-error" role="alert">
              <span>{accessError}</span>
              <Button type="button" variant="ghost" size="sm" onClick={onRetryAccess} disabled={accessSaving}>
                {accessSaving ? 'Retrying…' : 'Retry'}
              </Button>
            </div>}
            <div className="student-player-breadcrumb">
              <span>{selectedLesson.module?.title}</span><ChevronRight size={14} /><span>Lesson {Math.max(1, selectedLessonIndex + 1)}</span>
            </div>
            <h1>{selectedLesson.title}</h1>
            {selectedLesson.estimatedDuration && <p className="student-player-duration"><Clock3 size={15} /> {selectedLesson.estimatedDuration}</p>}
            <div className="student-player-content">
              {selectedLesson.type === 'VIDEO' && lessonVideoUrl && (isDirectVideoFile
                ? <CourseVideo url={lessonVideoUrl} />
                : <p><a className="text-link" href={lessonVideoUrl} target="_blank" rel="noreferrer">Open lesson video</a></p>)}
              <LessonContentRenderer
                key={selectedLesson.id}
                content={selectedLesson.content}
                resources={[...(course.resources || []), ...(selectedLesson.resources || [])]}
              />
            </div>
            <ResourceList resources={selectedLesson.resources || []} title="Lesson resources" />
            <ResourceList resources={(course.resources || []).filter((resource) => !resource.lessonId)} title="Course resources" />
            <footer className="student-player-footer">
              <Button
                type="button"
                variant="secondary"
                disabled={selectedLessonIndex <= 0}
                onClick={() => navigateToLesson(lessons[selectedLessonIndex - 1])}
              ><ChevronLeft size={16} /> Previous lesson</Button>
              <div className="lesson-completion">
                {selectedLesson.progress?.completed || selectedLesson.isCompleted
                  ? <span className="badge badge-completed"><Check size={14} /> Completed</span>
                  : <Button onClick={onCompleteLesson} disabled={completingLesson}>
                    <Check size={15} /> {completingLesson ? 'Saving…' : 'Mark lesson complete'}
                  </Button>}
              </div>
              <Button
                type="button"
                variant="secondary"
                disabled={selectedLessonIndex < 0 || selectedLessonIndex >= lessons.length - 1}
                onClick={() => navigateToLesson(lessons[selectedLessonIndex + 1])}
              >Next lesson <ChevronRight size={16} /></Button>
            </footer>
          </main>
        </div>
      </section>
    );
  }

  return (
    <section className="student-course-overview" aria-label="Course overview">
      <Link className="back-link" to="/courses"><ArrowLeft size={16} /> All courses</Link>
      {progressLoadError && <div className="notice notice-error student-player-access-error" role="alert">
        <span>{progressLoadError}</span>
        <Button type="button" variant="ghost" size="sm" onClick={onRetryProgress} disabled={progressRetrying}>
          {progressRetrying ? 'Retrying…' : 'Retry progress'}
        </Button>
      </div>}
      <header className="student-course-overview-hero">
        {coverImage
          ? <img src={coverImage} alt="" className="student-course-cover" />
          : <div className="student-course-cover student-course-cover-placeholder" aria-hidden="true"><BookOpen size={36} /></div>}
        <div className="student-course-intro">
          <span className="eyebrow">{course.programme?.title || 'REO Travel Academy'}</span>
          <h1>{course.title}</h1>
          <p>{course.description || 'Explore the lessons and activities in this course.'}</p>
          <div className="student-course-meta">
            {course.estimatedDuration && <span><Clock3 size={15} /> {course.estimatedDuration}</span>}
            <span><BookOpen size={15} /> {progress.total} lessons · {course.modules?.length || 0} modules</span>
            {trainers.length > 0 && <span><UserRound size={15} /> {trainers.map(({ firstName, lastName }) => `${firstName || ''} ${lastName || ''}`.trim()).join(', ')}</span>}
          </div>
        </div>
      </header>

      <section className="student-course-progress card" aria-label="Course progress">
        <div className="student-course-progress-copy">
          <div><span className="eyebrow">Your progress</span><strong>{progress.completed} of {progress.total} lessons complete</strong></div>
          <span>{progress.percentage}%</span>
        </div>
        <progress value={progress.completed} max={progress.total || 1} aria-label={`${progress.percentage}% of course lessons completed`} />
        {course.completion?.completed
          ? <span className="badge badge-completed"><Check size={14} /> Course requirements complete</span>
          : <p>{`Complete ${course.completion?.requiredLessonCompletionPercent ?? 100}% of lessons`}{course.completion?.requiredAssessments
            ? ` and pass ${course.completion.requiredAssessments} assessment${course.completion.requiredAssessments === 1 ? '' : 's'}`
            : ''} to finish this course.</p>}
        <p>{lastAccessedLesson ? `Last opened: ${lastAccessedLesson.title}` : 'Your course progress is saved as you learn.'}</p>
        {nextLesson && <Button onClick={() => onOpenLesson(lastAccessedLesson || nextLesson)}>
          <Play size={15} /> {lastAccessedLesson ? 'Continue learning' : progress.completed ? 'Continue learning' : 'Start learning'}
        </Button>}
        {!nextLesson && <span className="muted small">This course has no published lessons yet.</span>}
      </section>

      {outcomes.length > 0 && <section className="student-course-outcomes card">
        <div><span className="eyebrow">What you will learn</span><h2>Learning outcomes</h2></div>
        <ul>{outcomes.map((outcome, index) => <li key={`${outcome}-${index}`}>{outcome}</li>)}</ul>
      </section>}

      <div className="student-course-overview-grid">
        <section className="student-course-outline card">
          <div className="card-heading"><div><span className="eyebrow">Learning path</span><h2>Course content</h2></div><span>{course.modules?.length || 0} modules</span></div>
          {course.modules?.length ? course.modules.map((module, index) => (
            <article key={module.id} className="student-overview-module">
              <div className="student-overview-module-heading">
                <span>{String(index + 1).padStart(2, '0')}</span>
                <div><h3>{module.title}</h3>{module.description && <p>{module.description}</p>}</div>
                <small>{module.lessons?.length || 0} lessons</small>
              </div>
              {(module.lessons || []).map((lesson) => (
                <button className="student-overview-lesson" type="button" key={lesson.id} onClick={() => onOpenLesson(lesson)}>
                  <span className={`student-overview-lesson-icon${lesson.isCompleted ? ' is-complete' : ''}`}>
                    {lesson.isCompleted ? <Check size={14} /> : <Play size={12} />}
                  </span>
                  <span><strong>{lesson.title}</strong><small>{lesson.estimatedDuration || lesson.type.replaceAll('_', ' ').toLowerCase()}</small></span>
                  <span>{lesson.isCompleted ? 'Review' : 'Open'} <ChevronRight size={15} /></span>
                </button>
              ))}
              {!module.lessons?.length && <p className="muted small">No published lessons yet.</p>}
            </article>
          )) : <div className="empty-state"><BookOpen size={22} /><h3>Course content is being prepared</h3><p>Your Tutor will add lessons here soon.</p></div>}
        </section>

        <aside className="student-course-overview-aside">
          {trainers.length > 0 && <section className="student-course-tutor card">
            <span className="eyebrow">Your {trainers.length === 1 ? 'Tutor' : 'Tutors'}</span>
            {trainers.map(({ id, firstName, lastName, email }) => (
              <div key={id}><GraduationCap size={17} /><span><strong>{`${firstName || ''} ${lastName || ''}`.trim()}</strong><small>{email}</small></span></div>
            ))}
          </section>}
          <ResourceList resources={(course.resources || []).filter((resource) => !resource.lessonId)} title="Course resources" />
        </aside>
      </div>
    </section>
  );
}
