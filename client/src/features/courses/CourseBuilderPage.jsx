import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowDown, ArrowLeft, ArrowUp, BookOpen, Check, ChevronLeft, ChevronRight,
  CircleAlert, Eye, Plus, Save, Trash2,
} from 'lucide-react';
import { assessmentsAPI, cohortsAPI, coursesAPI, programmesAPI, resourcesAPI, usersAPI } from '../../services/api';
import { useAuth } from '../../hooks/useAuth';
import { Button } from '../../components/common/Button';
import { Input, Select, Textarea } from '../../components/forms/Input';
import LessonContentEditor, { parseLessonContentBlocks } from './LessonContentEditor.jsx';
import LessonContentRenderer from './LessonContentRenderer.jsx';

const steps = [
  { title: 'Course identity', caption: 'Position the course' },
  { title: 'Learning outcomes', caption: 'Set learner goals' },
  { title: 'Course structure', caption: 'Build the curriculum' },
  { title: 'Lesson content', caption: 'Create the experience' },
  { title: 'Course resources', caption: 'Add learning materials' },
  { title: 'Course settings', caption: 'Configure access' },
  { title: 'Review & publish', caption: 'Validate and release' },
];

const newAssessment = {
  title: '',
  description: '',
  instructions: '',
  programOfferingId: '',
  attemptLimit: 1,
  timeLimitMin: '',
  passMarkPercent: 50,
  availableFrom: '',
  availableTo: '',
  status: 'DRAFT',
};

const newQuestion = {
  type: 'MULTIPLE_CHOICE',
  prompt: '',
  points: 1,
  options: '',
  correctAnswer: '',
  explanation: '',
};

const parseList = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    return value.split('\n').map((item) => item.trim()).filter(Boolean);
  }
  return [];
};

const inputDate = (value) => value ? new Date(value).toISOString().slice(0, 16) : '';
const datePayload = (value) => value ? new Date(value).toISOString() : null;
const isHttpUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};
const hasDraftChanges = (draft, pristine) => Object.keys(pristine).some((key) => draft[key] !== pristine[key]);

const completionSettings = (value) => {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value || '{}') : value || {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const initialCourseFields = (course) => {
  const rules = completionSettings(course.completionRequirements);
  return ({
  title: course.title || '',
  subtitle: course.subtitle || '',
  description: course.description || '',
  courseCode: course.courseCode || '',
  category: course.category || '',
  requirements: course.requirements || '',
  thumbnail: course.thumbnail || course.thumbnailUrl || '',
  coverImage: course.coverImage || '',
  introduction: course.introduction || '',
  language: course.language || 'English',
  difficulty: course.difficulty || 'All Levels',
  visibility: course.visibility || 'public',
  programmeId: course.programmeId || '',
  learningObjectives: parseList(course.learningObjectives).join('\n'),
  learningOutcomes: parseList(course.learningOutcomes).join('\n'),
  targetAudience: course.targetAudience || '',
  prerequisites: course.prerequisites || '',
  prerequisitesMode: course.prerequisitesMode || 'none',
  minimumLessonCompletionPercent: rules.minimumLessonCompletionPercent ?? 100,
  requireAssessment: Boolean(rules.requireAssessment),
  requireThumbnail: Boolean(rules.requireThumbnail),
  estimatedDuration: course.estimatedDuration || '',
  startDate: inputDate(course.startDate),
  endDate: inputDate(course.endDate),
  trainerIds: (course.trainers || []).map(({ trainerId }) => trainerId),
  cohortIds: (course.cohorts || []).map(({ cohortId }) => cohortId),
  });
};

const updateById = (list, id, patch) => list.map((item) => (
  item.id === id ? { ...item, ...patch } : item
));

export default function CourseBuilderPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const role = typeof user?.role === 'string' ? user.role : user?.role?.name;
  const isAdmin = role === 'SUPER_ADMIN';
  const [course, setCourse] = useState(null);
  const [fields, setFields] = useState(null);
  const [quality, setQuality] = useState(null);
  const [programmes, setProgrammes] = useState([]);
  const [trainers, setTrainers] = useState([]);
  const [cohorts, setCohorts] = useState([]);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [moduleDraft, setModuleDraft] = useState('');
  const [moduleTitleDrafts, setModuleTitleDrafts] = useState({});
  const [moduleDescriptionDrafts, setModuleDescriptionDrafts] = useState({});
  const [lessonEditDrafts, setLessonEditDrafts] = useState({});
  const [editingLessonId, setEditingLessonId] = useState('');
  const [lessonTitleDraft, setLessonTitleDraft] = useState('');
  const [lessonModuleId, setLessonModuleId] = useState('');
  const [lessonPublished, setLessonPublished] = useState(true);
  const [selectedLessonId, setSelectedLessonId] = useState('');
  const [contentDirty, setContentDirty] = useState(false);
  const [resourceNameDrafts, setResourceNameDrafts] = useState({});
  const [resourceFileSelected, setResourceFileSelected] = useState(false);
  const [assessmentDraft, setAssessmentDraft] = useState(newAssessment);
  const [questionDraft, setQuestionDraft] = useState(newQuestion);
  const [editingAssessmentId, setEditingAssessmentId] = useState('');
  const [editingQuestionId, setEditingQuestionId] = useState('');
  const [assessmentSettingsDirty, setAssessmentSettingsDirty] = useState(false);
  const [preview, setPreview] = useState(false);

  const reload = useCallback(async () => {
    const [courseResponse, qualityResponse] = await Promise.all([
      coursesAPI.builder(id),
      coursesAPI.quality(id),
    ]);
    const loadedCourse = courseResponse.data.data;
    setCourse(loadedCourse);
    setFields(initialCourseFields(loadedCourse));
    setQuality(qualityResponse.data.data);
  }, [id]);
  const refreshQuality = async () => {
    try {
      const { data } = await coursesAPI.quality(id);
      setQuality(data.data);
    } catch (requestError) {
      setQuality(null);
      setError(requestError.response?.data?.message || 'The resource was saved, but course validation could not be refreshed.');
    }
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const trainerRequest = isAdmin
      ? usersAPI.list({ role: 'TRAINER', status: 'ACTIVE', page: 1, pageSize: 50 }).then(async ({ data }) => {
        const items = data.data.items || [];
        const pageCount = Math.ceil((data.data.total || items.length) / data.data.pageSize);
        const remaining = await Promise.all(Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) => (
          usersAPI.list({ role: 'TRAINER', status: 'ACTIVE', page: index + 2, pageSize: 50 })
        )));
        return [...items, ...remaining.flatMap(({ data: page }) => page.data.items || [])];
      })
      : Promise.resolve([]);
    const programmeRequest = isAdmin ? programmesAPI.list() : Promise.resolve(null);
    Promise.all([
      coursesAPI.builder(id),
      coursesAPI.quality(id),
      trainerRequest,
      cohortsAPI.list(),
      programmeRequest,
    ]).then(([courseResponse, qualityResponse, trainerOptions, cohortResponse, programmeResponse]) => {
      if (!active) return;
      const loadedCourse = courseResponse.data.data;
      setCourse(loadedCourse);
      setFields(initialCourseFields(loadedCourse));
      setQuality(qualityResponse.data.data);
      const trainerById = new Map(trainerOptions.map((trainer) => [trainer.id, trainer]));
      for (const { trainer } of loadedCourse.trainers) {
        if (!trainerById.has(trainer.id)) trainerById.set(trainer.id, trainer);
      }
      setTrainers([...trainerById.values()]);
      setCohorts(cohortResponse?.data?.data || []);
      setProgrammes(programmeResponse?.data?.data || []);
      setError('');
    }).catch((requestError) => {
      if (active) setError(requestError.response?.data?.message || 'Could not load the course builder.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [id, isAdmin]);

  const lessons = useMemo(() => (course?.modules || []).flatMap((module) => module.lessons.map((lesson) => ({
    ...lesson,
    moduleTitle: module.title,
    moduleId: module.id,
  }))), [course]);
  const intakeOfferingOptions = useMemo(() => [...new Map(cohorts
    .filter((cohort) => cohort.programmeId === fields?.programmeId && cohort.intakeProgramOffering?.intake)
    .map((cohort) => {
      const { id, intake } = cohort.intakeProgramOffering;
      return [id, {
        value: id,
        label: `GATE ${String(intake.gateNumber).padStart(2, '0')} — ${intake.season} ${intake.year}`,
      }];
    })).values()], [cohorts, fields?.programmeId]);
  const selectedLesson = lessons.find((lesson) => lesson.id === selectedLessonId) || null;
  const currentStep = steps[step];
  const issues = quality?.issues
    || [...(quality?.errors || []), ...(quality?.warnings || quality?.recommendations || []), ...(quality?.info || [])];
  const issuesForStep = (stepNumber) => issues.filter((issue) => issue.step === stepNumber);
  const openQualityIssue = (issue) => {
    setStep(issue.step - 1);
    setPreview(false);
    if (issue.entityType === 'Lesson') setSelectedLessonId(issue.entityId);
    const targetId = issue.entityType === 'Lesson'
      ? `builder-${issue.step === 4 ? 'content' : 'structure'}-lesson-${issue.entityId}`
      : issue.entityType === 'Module'
        ? `builder-module-${issue.entityId}`
        : issue.entityType === 'Assessment'
          ? `builder-assessment-${issue.entityId}`
          : issue.entityType === 'Resource'
            ? `builder-resource-${issue.entityId}`
            : null;
    if (targetId) {
      window.setTimeout(() => {
        document.getElementById(targetId)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      }, 0);
    }
  };
  const unsavedFields = useMemo(() => Boolean(course && fields
    && JSON.stringify(fields) !== JSON.stringify(initialCourseFields(course))), [course, fields]);
  const hasUnsavedBuilderDrafts = unsavedFields
    || Object.keys(moduleTitleDrafts).length > 0
    || Object.keys(moduleDescriptionDrafts).length > 0
    || Object.keys(lessonEditDrafts).length > 0
    || Boolean(moduleDraft.trim() || lessonTitleDraft.trim() || lessonModuleId || editingLessonId || resourceFileSelected)
    || Object.keys(resourceNameDrafts).length > 0
    || hasDraftChanges(assessmentDraft, newAssessment)
    || hasDraftChanges(questionDraft, newQuestion)
    || assessmentSettingsDirty
    || Boolean(editingQuestionId);

  useEffect(() => {
    if (!hasUnsavedBuilderDrafts) return undefined;
    const warnBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const confirmInternalNavigation = (event) => {
      const anchor = event.target.closest?.('a[href]');
      if (!anchor || anchor.target || anchor.origin !== window.location.origin) return;
      if (!window.confirm('Discard unsaved course-builder changes and leave this page?')) {
        event.preventDefault();
      }
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    document.addEventListener('click', confirmInternalNavigation, true);
    return () => {
      window.removeEventListener('beforeunload', warnBeforeUnload);
      document.removeEventListener('click', confirmInternalNavigation, true);
    };
  }, [hasUnsavedBuilderDrafts]);

  const withFeedback = async (action, successMessage) => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await action();
      await reload();
      if (successMessage) setNotice(successMessage);
      return true;
    } catch (requestError) {
      const currentQuality = requestError.response?.data?.errors;
      if (currentQuality?.issues) setQuality(currentQuality);
      setError(requestError.response?.data?.message || 'Could not save your changes.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const updateFields = (patch) => setFields((current) => ({ ...current, ...patch }));
  const patchAssessment = (assessmentId, patch) => {
    setAssessmentSettingsDirty(true);
    setCourse((current) => ({ ...current, assessments: updateById(current.assessments, assessmentId, patch) }));
  };
  const saveIdentity = () => {
    const title = fields.title.trim();
    const description = fields.description.trim();
    if (title.length < 3 || title.length > 120 || !description) {
      setError('Enter a course title between 3 and 120 characters and a course description.');
      return Promise.resolve(false);
    }
    if ([fields.thumbnail, fields.coverImage].some((value) => value.trim() && !isHttpUrl(value.trim()))) {
      setError('Course thumbnail and cover image must use valid HTTP(S) URLs.');
      return Promise.resolve(false);
    }
    return withFeedback(() => coursesAPI.update(id, {
      title,
      subtitle: fields.subtitle.trim(),
      description,
      courseCode: fields.courseCode.trim(),
      category: fields.category.trim(),
      requirements: fields.requirements.trim(),
      thumbnail: fields.thumbnail.trim(),
      coverImage: fields.coverImage.trim(),
      introduction: fields.introduction.trim(),
      language: fields.language.trim(),
      difficulty: fields.difficulty,
    }), 'Course identity saved.');
  };
  const saveOutcomes = () => {
    const objectives = fields.learningObjectives.split('\n').map((item) => item.trim()).filter(Boolean);
    const outcomes = fields.learningOutcomes.split('\n').map((item) => item.trim()).filter(Boolean);
    if (!objectives.length || !outcomes.length || !fields.targetAudience.trim()) {
      setError('Add at least one learning objective, one measurable outcome, and a target audience before saving.');
      return Promise.resolve(false);
    }
    return withFeedback(() => coursesAPI.update(id, {
      learningObjectives: objectives,
      learningOutcomes: outcomes,
      targetAudience: fields.targetAudience.trim(),
      prerequisites: fields.prerequisites.trim(),
      prerequisitesMode: fields.prerequisitesMode,
    }), 'Learning outcomes saved.');
  };
  const validateSettings = () => {
    const threshold = Number(fields.minimumLessonCompletionPercent);
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > 100) {
      return 'Required lesson completion must be a whole percentage from 1 to 100.';
    }
    const start = fields.startDate ? new Date(fields.startDate) : null;
    const end = fields.endDate ? new Date(fields.endDate) : null;
    if ((start && !Number.isFinite(start.getTime())) || (end && !Number.isFinite(end.getTime()))) {
      return 'Provide valid course availability dates.';
    }
    if (start && end && end < start) return 'The course end date must be after its start date.';
    if (!['public', 'private', 'cohort'].includes(fields.visibility)) return 'Select a valid course visibility.';
    return '';
  };
  const saveSettings = () => {
    const validationError = validateSettings();
    if (validationError) {
      setError(validationError);
      return Promise.resolve(false);
    }
    const completionRequirements = {
      minimumLessonCompletionPercent: Number(fields.minimumLessonCompletionPercent),
      requireAssessment: fields.requireAssessment,
      requireThumbnail: fields.requireThumbnail,
    };
    return withFeedback(() => coursesAPI.update(id, {
      estimatedDuration: fields.estimatedDuration,
      visibility: fields.visibility,
      programmeId: isAdmin ? fields.programmeId || null : undefined,
      startDate: datePayload(fields.startDate),
      endDate: datePayload(fields.endDate),
      completionRequirements,
      trainerIds: isAdmin ? fields.trainerIds : undefined,
      cohortIds: isAdmin ? fields.cohortIds : undefined,
    }), 'Course settings saved.');
  };

  const saveCurrentStep = async () => {
    if (step === 0) return saveIdentity();
    if (step === 1) return saveOutcomes();
    if (step === 5) return saveSettings();
    return true;
  };

  const uploadCourseResource = async (event) => {
    const form = event.currentTarget;
    const formData = new FormData(form);
    formData.set('courseId', id);
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { data } = await resourcesAPI.upload(formData);
      setCourse((current) => ({
        ...current,
        resources: [...(current.resources || []), data.data],
      }));
      setQuality(null);
      form.reset();
      setResourceFileSelected(false);
      setNotice('Course resource uploaded.');
      await refreshQuality();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not upload this learning resource.');
    } finally {
      setSaving(false);
    }
  };

  const deleteCourseResource = async (resource) => {
    if (!window.confirm(`Delete "${resource.originalName}"? This cannot be undone.`)) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await resourcesAPI.delete(resource.id);
      setCourse((current) => ({
        ...current,
        resources: (current.resources || []).filter(({ id: resourceId }) => resourceId !== resource.id),
      }));
      setQuality(null);
      setNotice('Course resource deleted.');
      await refreshQuality();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not delete this learning resource.');
    } finally {
      setSaving(false);
    }
  };
  const saveCourseResourceName = async (resource) => {
    const originalName = resourceNameDrafts[resource.id]?.trim();
    if (!originalName || originalName.length > 255) {
      setError('Resource name must be 1–255 characters and contain no control characters.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { data } = await resourcesAPI.update(resource.id, { originalName });
      setCourse((current) => ({
        ...current,
        resources: (current.resources || []).map((item) => (
          item.id === resource.id ? { ...item, ...data.data } : item
        )),
      }));
      setResourceNameDrafts((current) => {
        const next = { ...current };
        delete next[resource.id];
        return next;
      });
      setNotice('Resource name saved.');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not save this resource name.');
    } finally {
      setSaving(false);
    }
  };
  const saveDraft = async () => {
    const validationError = validateSettings();
    if (validationError) {
      setError(validationError);
      return;
    }
    const completionRequirements = {
      minimumLessonCompletionPercent: Number(fields.minimumLessonCompletionPercent),
      requireAssessment: fields.requireAssessment,
      requireThumbnail: fields.requireThumbnail,
    };
    await withFeedback(() => coursesAPI.update(id, {
      title: fields.title.trim(),
      subtitle: fields.subtitle.trim(),
      description: fields.description.trim(),
      courseCode: fields.courseCode.trim(),
      category: fields.category.trim(),
      requirements: fields.requirements.trim(),
      thumbnail: fields.thumbnail.trim(),
      coverImage: fields.coverImage.trim(),
      introduction: fields.introduction.trim(),
      language: fields.language.trim(),
      difficulty: fields.difficulty,
      learningObjectives: fields.learningObjectives.split('\n').map((item) => item.trim()).filter(Boolean),
      learningOutcomes: fields.learningOutcomes.split('\n').map((item) => item.trim()).filter(Boolean),
      targetAudience: fields.targetAudience.trim(),
      prerequisites: fields.prerequisites.trim(),
      prerequisitesMode: fields.prerequisitesMode,
      estimatedDuration: fields.estimatedDuration,
      visibility: fields.visibility,
      programmeId: isAdmin ? fields.programmeId || null : undefined,
      startDate: datePayload(fields.startDate),
      endDate: datePayload(fields.endDate),
      completionRequirements,
      trainerIds: isAdmin ? fields.trainerIds : undefined,
      cohortIds: isAdmin ? fields.cohortIds : undefined,
    }), course.status === 'DRAFT' ? 'Draft saved. Publication state is unchanged.' : 'Course changes saved. Publication state is unchanged.');
  };
  const goToStep = async (nextStep) => {
    if (step === 2 && (
      Object.keys(moduleTitleDrafts).length
      || Object.keys(moduleDescriptionDrafts).length
      || editingLessonId
      || lessonTitleDraft.trim()
    )) {
      setError('Save or cancel the unfinished module or lesson changes before leaving this step.');
      return;
    }
    if (step === 3 && contentDirty) {
      setError('Save the current lesson content or discard its unsaved changes before leaving this step.');
      return;
    }
    if (step === 4 && (Object.keys(resourceNameDrafts).length || resourceFileSelected)) {
      setError('Save or cancel the resource changes before leaving this step.');
      return;
    }
    if (step === 5 && (
      assessmentSettingsDirty
      || editingQuestionId
      || hasDraftChanges(assessmentDraft, newAssessment)
      || hasDraftChanges(questionDraft, newQuestion)
    )) {
      setError('Save or discard the unfinished assessment or question changes before leaving this step.');
      return;
    }
    const saved = await saveCurrentStep();
    if (!saved) return;
    setStep(nextStep);
    setPreview(false);
    if (nextStep === 6) {
      try {
        const { data } = await coursesAPI.quality(id);
        setQuality(data.data);
      } catch (requestError) {
        setError(requestError.response?.data?.message || 'Could not validate this course.');
      }
    }
  };

  const addModule = async (event) => {
    event.preventDefault();
    if (!moduleDraft.trim()) return;
    const saved = await withFeedback(() => coursesAPI.createModule(id, { title: moduleDraft.trim() }), 'Module added.');
    if (saved) setModuleDraft('');
  };
  const saveModuleTitle = async (module) => {
    const title = moduleTitleDrafts[module.id] ?? module.title;
    const description = moduleDescriptionDrafts[module.id] ?? module.description ?? '';
    if (!title.trim()) {
      setError('Module title is required.');
      return;
    }
    if (moduleTitleDrafts[module.id] === undefined && moduleDescriptionDrafts[module.id] === undefined) return;
    const saved = await withFeedback(() => coursesAPI.updateModule(module.id, {
      title: title.trim(),
      description: description.trim(),
    }), 'Module details saved.');
    if (saved) {
      setModuleTitleDrafts((current) => {
        const next = { ...current };
        delete next[module.id];
        return next;
      });
      setModuleDescriptionDrafts((current) => {
        const next = { ...current };
        delete next[module.id];
        return next;
      });
    }
  };
  const moveModule = async (index, direction) => {
    const moduleIds = course.modules.map(({ id: moduleId }) => moduleId);
    const target = index + direction;
    if (target < 0 || target >= moduleIds.length) return;
    [moduleIds[index], moduleIds[target]] = [moduleIds[target], moduleIds[index]];
    await withFeedback(() => coursesAPI.reorderModules(id, moduleIds), 'Module order saved.');
  };
  const addLesson = async (event) => {
    event.preventDefault();
    if (!lessonTitleDraft.trim() || !lessonModuleId) return;
    const saved = await withFeedback(() => coursesAPI.createLesson(lessonModuleId, {
      title: lessonTitleDraft.trim(),
      content: '[]',
      isPublished: lessonPublished,
    }), 'Lesson added.');
    if (saved) {
      setLessonTitleDraft('');
      setLessonModuleId('');
      setSelectedLessonId('');
      setContentDirty(false);
      setStep(3);
    }
  };
  const moveLesson = async (module, index, direction) => {
    const lessonIds = module.lessons.map(({ id: lessonId }) => lessonId);
    const target = index + direction;
    if (target < 0 || target >= lessonIds.length) return;
    [lessonIds[index], lessonIds[target]] = [lessonIds[target], lessonIds[index]];
    await withFeedback(() => coursesAPI.reorderLessons(module.id, lessonIds), 'Lesson order saved.');
  };
  const chooseLesson = (lesson) => {
    if (contentDirty && !window.confirm('Discard unsaved changes to this lesson content?')) return;
    setSelectedLessonId(lesson.id);
    setContentDirty(false);
  };
  const saveLessonContent = async (blocks) => {
    if (!selectedLesson) throw new Error('Select a lesson before saving content.');
    const { data } = await coursesAPI.updateLesson(selectedLesson.id, {
      content: JSON.stringify(blocks),
    });
    const savedLesson = data.data;
    setCourse((current) => ({
      ...current,
      modules: current.modules.map((module) => ({
        ...module,
        lessons: module.lessons.map((lesson) => (
          lesson.id === savedLesson.id ? { ...lesson, ...savedLesson } : lesson
        )),
      })),
    }));
    setError('');
    return savedLesson;
  };
  const editLessonMetadata = (lesson) => {
    setEditingLessonId(lesson.id);
    setLessonEditDrafts((current) => ({
      ...current,
      [lesson.id]: { title: lesson.title, isPublished: lesson.isPublished },
    }));
  };
  const saveLessonMetadata = async (lesson) => {
    const draft = lessonEditDrafts[lesson.id];
    if (!draft?.title.trim()) {
      setError('Lesson title is required.');
      return;
    }
    const saved = await withFeedback(() => coursesAPI.updateLesson(lesson.id, {
      title: draft.title.trim(),
      isPublished: draft.isPublished,
    }), 'Lesson details saved.');
    if (saved) {
      setEditingLessonId('');
      setLessonEditDrafts((current) => {
        const next = { ...current };
        delete next[lesson.id];
        return next;
      });
    }
  };
  const cancelLessonMetadata = (lesson) => {
    const draft = lessonEditDrafts[lesson.id];
    if (draft && (draft.title !== lesson.title || draft.isPublished !== lesson.isPublished)
      && !window.confirm('Discard unsaved lesson details?')) return;
    setEditingLessonId('');
    setLessonEditDrafts((current) => {
      const next = { ...current };
      delete next[lesson.id];
      return next;
    });
  };
  const deleteLesson = async (lesson) => {
    if (!window.confirm(`Delete “${lesson.title}”? Lessons with learner progress are protected.`)) return;
    const deleted = await withFeedback(() => coursesAPI.deleteLesson(lesson.id), 'Lesson deleted.');
    if (deleted) {
      setLessonEditDrafts((current) => {
        const next = { ...current };
        delete next[lesson.id];
        return next;
      });
      if (editingLessonId === lesson.id) setEditingLessonId('');
    }
    if (deleted && selectedLessonId === lesson.id) {
      setSelectedLessonId('');
      setContentDirty(false);
    }
  };
  const deleteModule = async (module) => {
    if (!window.confirm(`Delete “${module.title}” and its lessons? Modules with learner progress are protected.`)) return;
    const deleted = await withFeedback(() => coursesAPI.deleteModule(module.id), 'Module deleted.');
    if (deleted) {
      setModuleTitleDrafts((current) => {
        const next = { ...current };
        delete next[module.id];
        return next;
      });
      setModuleDescriptionDrafts((current) => {
        const next = { ...current };
        delete next[module.id];
        return next;
      });
      if (selectedLesson?.moduleId === module.id) {
        setSelectedLessonId('');
        setContentDirty(false);
      }
    }
  };
  const saveAssessment = async (event) => {
    event.preventDefault();
    if (assessmentSettingsDirty) {
      setError('Save or discard the edited assessment settings before creating another assessment.');
      return;
    }
    const payload = {
      ...assessmentDraft,
      courseId: id,
      programOfferingId: assessmentDraft.programOfferingId || null,
      timeLimitMin: assessmentDraft.timeLimitMin ? Number(assessmentDraft.timeLimitMin) : null,
      attemptLimit: Number(assessmentDraft.attemptLimit),
      passMarkPercent: Number(assessmentDraft.passMarkPercent),
      availableFrom: datePayload(assessmentDraft.availableFrom),
      availableTo: datePayload(assessmentDraft.availableTo),
    };
    const saved = await withFeedback(() => assessmentsAPI.create(payload), 'Assessment created. Add questions before publishing it.');
    if (saved) setAssessmentDraft(newAssessment);
  };
  const saveAssessmentSettings = async (assessment) => {
    const saved = await withFeedback(() => assessmentsAPI.update(assessment.id, {
      title: assessment.title,
      description: assessment.description,
      instructions: assessment.instructions,
      timeLimitMin: assessment.timeLimitMin,
      attemptLimit: assessment.attemptLimit,
      passMarkPercent: assessment.passMarkPercent,
      availableFrom: assessment.availableFrom ? datePayload(inputDate(assessment.availableFrom)) : null,
      availableTo: assessment.availableTo ? datePayload(inputDate(assessment.availableTo)) : null,
      status: assessment.status,
    }), 'Assessment settings saved.');
    if (saved) {
      setAssessmentSettingsDirty(false);
      setEditingAssessmentId('');
    }
  };
  const discardAssessmentSettings = async () => {
    if (!window.confirm('Discard unsaved assessment settings?')) return;
    setSaving(true);
    setError('');
    try {
      await reload();
      setAssessmentSettingsDirty(false);
      setEditingAssessmentId('');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not reload assessment settings.');
    } finally {
      setSaving(false);
    }
  };
  const addQuestion = async (event, assessment) => {
    event.preventDefault();
    if (assessmentSettingsDirty) {
      setError('Save or discard the edited assessment settings before adding questions.');
      return;
    }
    if (editingQuestionId) {
      setError('Save or cancel the question being edited before adding another question.');
      return;
    }
    const options = questionDraft.options.split('\n').map((item) => item.trim()).filter(Boolean);
    let correctAnswer = questionDraft.correctAnswer.trim();
    if (questionDraft.type === 'MULTIPLE_ANSWER') correctAnswer = correctAnswer.split(',').map((item) => item.trim()).filter(Boolean);
    if (questionDraft.type === 'SHORT_ANSWER') correctAnswer = null;
    const saved = await withFeedback(() => assessmentsAPI.addQuestion(assessment.id, {
      type: questionDraft.type,
      prompt: questionDraft.prompt,
      points: Number(questionDraft.points),
      options: options.length ? options : undefined,
      correctAnswer,
      explanation: questionDraft.explanation,
    }), 'Question added.');
    if (saved) setQuestionDraft(newQuestion);
  };
  const editQuestion = (question) => {
    setEditingQuestionId(question.id);
    setQuestionDraft({
      type: question.type,
      prompt: question.prompt,
      points: question.points,
      options: Array.isArray(question.options) ? question.options.join('\n') : '',
      correctAnswer: Array.isArray(question.correctAnswer)
        ? question.correctAnswer.join(', ')
        : question.correctAnswer == null ? '' : String(question.correctAnswer),
      explanation: question.explanation || '',
    });
  };
  const saveQuestion = async (event, question) => {
    event.preventDefault();
    if (assessmentSettingsDirty) {
      setError('Save or discard the edited assessment settings before changing questions.');
      return;
    }
    const options = questionDraft.options.split('\n').map((item) => item.trim()).filter(Boolean);
    let correctAnswer = questionDraft.correctAnswer.trim();
    if (questionDraft.type === 'MULTIPLE_ANSWER') correctAnswer = correctAnswer.split(',').map((item) => item.trim()).filter(Boolean);
    if (questionDraft.type === 'SHORT_ANSWER') correctAnswer = null;
    const saved = await withFeedback(() => assessmentsAPI.updateQuestion(question.id, {
      type: questionDraft.type,
      prompt: questionDraft.prompt,
      points: Number(questionDraft.points),
      options: options.length ? options : null,
      correctAnswer,
      explanation: questionDraft.explanation,
    }), 'Question updated.');
    if (saved) {
      setEditingQuestionId('');
      setQuestionDraft(newQuestion);
    }
  };
  const cancelQuestionEdit = () => {
    if (!window.confirm('Discard unsaved question changes?')) return;
    setEditingQuestionId('');
    setQuestionDraft(newQuestion);
  };
  const deleteQuestion = async (question) => {
    if (assessmentSettingsDirty) {
      setError('Save or discard the edited assessment settings before deleting questions.');
      return;
    }
    if (editingQuestionId) {
      setError('Save or cancel the question being edited before deleting another question.');
      return;
    }
    if (!window.confirm('Delete this assessment question?')) return;
    await withFeedback(() => assessmentsAPI.deleteQuestion(question.id), 'Question deleted.');
  };
  const publish = async () => {
    if (!quality?.valid) {
      setError('Resolve all blocking quality issues before publishing.');
      return;
    }
    if (course.status === 'PUBLISHED') {
      setNotice('This course is already published. Your content changes are saved without changing its publication state.');
      return;
    }
    if (!window.confirm('Publish this course for its assigned learners?')) return;
    await withFeedback(() => coursesAPI.publish(id), 'Course published.');
  };
  const unpublish = async () => {
    if (!window.confirm('Unpublish this course? Learner access will stop, but enrollment and progress records will remain.')) return;
    await withFeedback(() => coursesAPI.unpublish(id), 'Course returned to draft. Learner records remain intact.');
  };
  const archive = async () => {
    if (!window.confirm('Archive this course? The course and learner history will be preserved.')) return;
    await withFeedback(() => coursesAPI.archive(id), 'Course archived.');
  };
  const toggleSelection = (key, selectedId) => updateFields({
    [key]: fields[key].includes(selectedId)
      ? fields[key].filter((value) => value !== selectedId)
      : [...fields[key], selectedId],
  });

  if (loading) return <div className="card loading-card" role="status">Opening the course builder…</div>;
  if (!course || !fields) {
    return <div className="page-stack">
      {error && <div className="notice notice-error" role="alert">{error}</div>}
      <Link className="back-link" to="/courses"><ArrowLeft size={16} /> Back to courses</Link>
    </div>;
  }

  let completionSettings = {};
  try {
    completionSettings = typeof course.completionRequirements === 'string'
      ? JSON.parse(course.completionRequirements)
      : course.completionRequirements || {};
  } catch {
    completionSettings = {};
  }
  const stepComplete = [
    Boolean(course.title?.trim().length >= 3 && course.description?.trim()),
    Boolean(parseList(course.learningObjectives).length && parseList(course.learningOutcomes).length && course.targetAudience),
    Boolean(course.modules.length && course.modules.every((module) => module.lessons.length)),
    Boolean(lessons.length && lessons.every((lesson) => parseLessonContentBlocks(lesson.content).length)),
    true,
    Boolean(course.trainers?.some(({ trainer }) => trainer?.status === 'ACTIVE')
      && Boolean(course.programmeId)
      && Boolean(course.cohorts?.some(({ cohort }) => (
        cohort?.programmeId === course.programmeId && cohort.intakeProgramOfferingId
      )))
      && course.visibility
      && (!completionSettings.requireAssessment
        || course.assessments.some((assessment) => assessment.status === 'PUBLISHED' && assessment.questions.length))),
    quality?.valid === true,
  ];
  const courseResources = (course.resources || []).filter((resource) => !resource.lessonId);

  return <div className="page-stack course-builder-page">
    <Link className="back-link" to="/courses"><ArrowLeft size={16} /> All courses</Link>
    <header className="builder-header">
      <div>
        <span className="eyebrow">Course studio · {course.status}</span>
        <h1>{course.title}</h1>
        <p>Build a polished, learner-ready course through seven connected steps. Each saved change is stored in the course.</p>
      </div>
      <div className="builder-header-actions">
        <Button variant="secondary" onClick={() => {
          if ((contentDirty || hasUnsavedBuilderDrafts)
        && !window.confirm('Discard unsaved course changes and open the course?')) return;
          navigate(`/courses/${id}`);
        }}><Eye size={16} /> Open course</Button>
        <span className={`builder-state state-${course.status.toLowerCase()}`}>{course.status}</span>
      </div>
    </header>

    {notice && <div className="notice notice-success" role="status">{notice}</div>}
    {error && <div className="notice notice-error" role="alert">{error}</div>}

    <nav className="builder-stepper" aria-label="Course builder steps">
      {steps.map((item, index) => {
        const statusIssues = index === 6 ? issues : issuesForStep(index + 1);
        const hasErrors = statusIssues.some(({ severity }) => severity === 'ERROR');
        const hasWarnings = statusIssues.some(({ severity }) => severity === 'WARNING');
        return <button
          type="button"
          key={item.title}
          className={`builder-step${step === index ? ' is-current' : ''}${stepComplete[index] && !hasErrors ? ' is-complete' : ''}${hasErrors ? ' has-validation-errors' : ''}${hasWarnings ? ' has-validation-warnings' : ''}`}
          aria-current={step === index ? 'step' : undefined}
          onClick={() => goToStep(index)}
        >
          <span className="builder-step-number">{stepComplete[index] && !hasErrors ? <Check size={16} /> : String(index + 1).padStart(2, '0')}</span>
          <span><strong>{item.title}</strong><small>{item.caption}</small>{hasErrors
            ? <small className="builder-step-validation">Needs attention</small>
            : hasWarnings
              ? <small className="builder-step-validation">Warnings</small>
              : null}</span>
        </button>;
      })}
      <div className="builder-progress-track" aria-hidden="true"><span style={{ width: `${((step + 1) / steps.length) * 100}%` }} /></div>
    </nav>

    <section className="builder-workspace">
      <main className="builder-main">
        <div className="builder-section-heading">
          <div><span className="eyebrow">Step {step + 1} of 7</span><h2>{currentStep.title}</h2><p>{currentStep.caption}</p></div>
          <span className="builder-step-progress">{step + 1} / 7</span>
        </div>

        {step === 0 && <div className="builder-form-grid">
          <Input label="Course title" value={fields.title} onChange={(title) => updateFields({ title })} required maxLength="120" />
          <Input label="Subtitle" value={fields.subtitle} onChange={(subtitle) => updateFields({ subtitle })} />
          <Textarea className="builder-wide" label="Course description" value={fields.description} onChange={(description) => updateFields({ description })} required rows="5" />
          <Input label="Course code" value={fields.courseCode} onChange={(courseCode) => updateFields({ courseCode })} />
          <Input label="Category" value={fields.category} onChange={(category) => updateFields({ category })} />
          <Textarea label="Requirements" value={fields.requirements} onChange={(requirements) => updateFields({ requirements })} rows="3" />
          <Input label="Thumbnail image URL" type="url" value={fields.thumbnail} onChange={(thumbnail) => updateFields({ thumbnail })} placeholder="https://…" />
          <Input label="Cover image URL" type="url" value={fields.coverImage} onChange={(coverImage) => updateFields({ coverImage })} placeholder="https://…" />
          <Input label="Language" value={fields.language} onChange={(language) => updateFields({ language })} />
          <Select label="Level" value={fields.difficulty} onChange={(difficulty) => updateFields({ difficulty })} options={['Beginner', 'Intermediate', 'Advanced', 'All Levels'].map((value) => ({ value, label: value }))} />
          <Textarea className="builder-wide" label="Course introduction" value={fields.introduction} onChange={(introduction) => updateFields({ introduction })} rows="4" />
          <div className="builder-form-actions builder-wide"><Button disabled={saving} onClick={saveIdentity}><Save size={16} /> {saving ? 'Saving…' : 'Save identity'}</Button></div>
        </div>}

        {step === 1 && <div className="builder-form-grid">
          <Textarea className="builder-wide" label="Learning objectives" value={fields.learningObjectives} onChange={(learningObjectives) => updateFields({ learningObjectives })} required rows="5" placeholder="One objective per line" />
          <Textarea className="builder-wide" label="Skills and measurable outcomes" value={fields.learningOutcomes} onChange={(learningOutcomes) => updateFields({ learningOutcomes })} required rows="5" placeholder="One outcome per line" />
          <Textarea className="builder-wide" label="Target audience" value={fields.targetAudience} onChange={(targetAudience) => updateFields({ targetAudience })} required rows="3" />
          <Textarea className="builder-wide" label="Prerequisites" value={fields.prerequisites} onChange={(prerequisites) => updateFields({ prerequisites })} rows="3" />
          <Select label="Prerequisite policy" value={fields.prerequisitesMode} onChange={(prerequisitesMode) => updateFields({ prerequisitesMode })} options={[
            { value: 'none', label: 'No prerequisites' },
            { value: 'recommended', label: 'Recommended' },
            { value: 'required', label: 'Required' },
          ]} />
          <div className="builder-form-actions builder-wide"><Button disabled={saving} onClick={saveOutcomes}><Save size={16} /> {saving ? 'Saving…' : 'Save learning outcomes'}</Button></div>
        </div>}

        {step === 2 && <div className="builder-structure">
          <form className="builder-add-row" onSubmit={addModule}>
            <Input label="New module title" value={moduleDraft} onChange={setModuleDraft} required placeholder="e.g. Foundations of Travel Planning" />
            <Button type="submit" disabled={saving}><Plus size={16} /> Add module</Button>
          </form>
          {!course.modules.length && <div className="builder-empty"><BookOpen size={24} /><strong>Your curriculum starts with a module</strong><span>Group lessons into a clear, sequenced learning path.</span></div>}
          {course.modules.map((module, index) => <article className="builder-module" id={`builder-module-${module.id}`} key={module.id}>
            <header className="builder-module-heading">
              <span className="builder-index">{String(index + 1).padStart(2, '0')}</span>
              <Input aria-label={`Module ${index + 1} title`} value={moduleTitleDrafts[module.id] ?? module.title} onChange={(title) => setModuleTitleDrafts((current) => ({ ...current, [module.id]: title }))} />
              <Button variant="secondary" size="sm" disabled={saving || (moduleTitleDrafts[module.id] === undefined && moduleDescriptionDrafts[module.id] === undefined)} onClick={() => saveModuleTitle(module)}>Save</Button>
              <Button variant="ghost" size="sm" aria-label="Move module up" disabled={index === 0 || saving} onClick={() => moveModule(index, -1)}><ArrowUp size={15} /></Button>
              <Button variant="ghost" size="sm" aria-label="Move module down" disabled={index === course.modules.length - 1 || saving} onClick={() => moveModule(index, 1)}><ArrowDown size={15} /></Button>
              <Button variant="ghost" size="sm" className="action-danger" onClick={() => deleteModule(module)}><Trash2 size={15} /></Button>
            </header>
            <div className="builder-module-description">
              <Input
                aria-label={`Module ${index + 1} description`}
                value={moduleDescriptionDrafts[module.id] ?? module.description ?? ''}
                onChange={(description) => setModuleDescriptionDrafts((current) => ({ ...current, [module.id]: description }))}
                placeholder="Optional module description"
              />
            </div>
            <div className="builder-lesson-list">
              {module.lessons.map((lesson, lessonIndex) => <div className="builder-lesson-row" id={`builder-structure-lesson-${lesson.id}`} key={lesson.id}>
                <span className="builder-index">{String(lessonIndex + 1).padStart(2, '0')}</span>
                {editingLessonId === lesson.id ? <div className="builder-lesson-edit">
                  <Input aria-label="Lesson title" value={lessonEditDrafts[lesson.id]?.title || ''} onChange={(title) => setLessonEditDrafts((current) => ({ ...current, [lesson.id]: { ...current[lesson.id], title } }))} />
                  <label><input type="checkbox" checked={Boolean(lessonEditDrafts[lesson.id]?.isPublished)} onChange={(event) => setLessonEditDrafts((current) => ({ ...current, [lesson.id]: { ...current[lesson.id], isPublished: event.target.checked } }))} /> Learner visible</label>
                  <Button variant="secondary" size="sm" disabled={saving} onClick={() => saveLessonMetadata(lesson)}>Save</Button>
                  <Button variant="ghost" size="sm" onClick={() => cancelLessonMetadata(lesson)}>Cancel</Button>
                </div> : <button className="builder-lesson-name" type="button" onClick={() => { chooseLesson(lesson); setStep(3); }}>
                  <strong>{lesson.title}</strong><small>{parseLessonContentBlocks(lesson.content).length} content blocks · {lesson.isPublished ? 'Learner visible' : 'Unpublished'}</small>
                </button>}
                {editingLessonId !== lesson.id && <Button variant="ghost" size="sm" onClick={() => editLessonMetadata(lesson)}>Edit</Button>}
                <Button variant="ghost" size="sm" aria-label={`Move ${lesson.title} up`} disabled={lessonIndex === 0 || saving} onClick={() => moveLesson(module, lessonIndex, -1)}><ArrowUp size={15} /></Button>
                <Button variant="ghost" size="sm" aria-label={`Move ${lesson.title} down`} disabled={lessonIndex === module.lessons.length - 1 || saving} onClick={() => moveLesson(module, lessonIndex, 1)}><ArrowDown size={15} /></Button>
                <Button variant="ghost" size="sm" className="action-danger" aria-label={`Delete ${lesson.title}`} onClick={() => deleteLesson(lesson)}><Trash2 size={15} /></Button>
              </div>)}
            </div>
          </article>)}
          <form className="builder-add-row" onSubmit={addLesson}>
            <Input label="New lesson title" value={lessonTitleDraft} onChange={setLessonTitleDraft} required placeholder="e.g. Build a client itinerary" />
            <Select label="Module" value={lessonModuleId} onChange={setLessonModuleId} required options={course.modules.map((module) => ({ value: module.id, label: module.title }))} />
            <label className="builder-checkbox"><input type="checkbox" checked={lessonPublished} onChange={(event) => setLessonPublished(event.target.checked)} /> Include in learner course</label>
            <Button type="submit" disabled={saving || !course.modules.length}><Plus size={16} /> Add lesson</Button>
          </form>
        </div>}

        {step === 3 && <div className="builder-content">
          <div className="builder-content-sidebar">
            <h3>Lessons</h3>
            {lessons.map((lesson) => <button type="button" id={`builder-content-lesson-${lesson.id}`} key={lesson.id} className={`builder-content-lesson${selectedLessonId === lesson.id ? ' is-selected' : ''}`} onClick={() => chooseLesson(lesson)}>
              <strong>{lesson.title}</strong><small>{lesson.moduleTitle}</small>
            </button>)}
            {!lessons.length && <p className="muted small">Add lessons in Course structure first.</p>}
          </div>
          <div className="builder-content-editor">
            {!selectedLesson ? <div className="builder-empty"><BookOpen size={24} /><strong>Select a lesson to edit</strong><span>Content is saved to the selected lesson.</span></div> : <>
              <div className="builder-selected-lesson"><span className="eyebrow">{selectedLesson.moduleTitle}</span><h3>{selectedLesson.title}</h3></div>
              <LessonContentEditor
                key={selectedLesson.id}
                content={selectedLesson.content}
                resources={[...new Map([
                  ...(course.resources || []).filter((resource) => !resource.lessonId || resource.lessonId === selectedLesson.id),
                  ...(selectedLesson.resources || []),
                ].map((resource) => [resource.id, resource])).values()]}
                onSave={saveLessonContent}
                onCancel={() => {
                  setContentDirty(false);
                  setError('');
                }}
                onDirtyChange={setContentDirty}
                onSaved={() => setNotice('Lesson content saved.')}
              />
            </>}
          </div>
        </div>}

        {step === 4 && <div className="builder-resource-step">
          <div className="builder-form-grid builder-resource-panel">
            <div className="builder-resource-upload builder-wide">
              <h3>Course resources</h3>
              <p className="muted">Upload files needed for the course, such as reference PDFs, slides, or support material. These resources remain attached to this course and can be reused by lessons.</p>
              <form onSubmit={uploadCourseResource} encType="multipart/form-data">
                <label className="builder-resource-file">Select a resource file
                  <input type="file" name="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.gif,.webp,.mp4,.webm" required onChange={(event) => setResourceFileSelected(Boolean(event.target.files?.length))} />
                </label>
                <Button type="submit" disabled={saving}><Plus size={16} /> Upload resource</Button>
              </form>
            </div>
            <div className="builder-wide builder-resource-list">
              <h4>Uploaded course resources</h4>
              {courseResources.length ? <ul>{courseResources.map((resource) => (
                <li id={`builder-resource-${resource.id}`} key={resource.id}>
                  {resourceNameDrafts[resource.id] !== undefined ? <>
                    <Input
                      aria-label={`Resource name for ${resource.originalName}`}
                      value={resourceNameDrafts[resource.id]}
                      maxLength="255"
                      onChange={(originalName) => setResourceNameDrafts((current) => ({ ...current, [resource.id]: originalName }))}
                    />
                    <div className="builder-inline-actions">
                      <Button type="button" size="sm" disabled={saving} onClick={() => saveCourseResourceName(resource)}><Save size={14} /> Save name</Button>
                      <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => setResourceNameDrafts((current) => {
                        const next = { ...current };
                        delete next[resource.id];
                        return next;
                      })}>Cancel</Button>
                    </div>
                  </> : <>
                    <span>{resource.originalName}</span>
                    <small>{resource.mimeType || 'file'} · {resource.sizeBytes ? `${Math.max(1, Math.round(resource.sizeBytes / 1024))} KB` : 'file'}</small>
                    <div className="builder-inline-actions">
                      <a href={resourcesAPI.downloadUrl(resource.id)} target="_blank" rel="noreferrer">Download</a>
                      <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => setResourceNameDrafts((current) => ({ ...current, [resource.id]: resource.originalName }))}>Edit name</Button>
                      <Button type="button" variant="ghost" size="sm" className="action-danger" disabled={saving} onClick={() => deleteCourseResource(resource)}><Trash2 size={14} /> Remove</Button>
                    </div>
                  </>}
                </li>
              ))}</ul> : <p className="muted">No course resources uploaded yet.</p>}
            </div>
          </div>
        </div>}

        {step === 5 && <div className="builder-assessments">
          <form className="builder-assessment-create" onSubmit={saveAssessment}>
            <h3>Create an assessment</h3>
            <div className="builder-form-grid">
              <Input className="builder-wide" label="Title" value={assessmentDraft.title} onChange={(title) => setAssessmentDraft((current) => ({ ...current, title }))} required />
              <Textarea className="builder-wide" label="Description" value={assessmentDraft.description} onChange={(description) => setAssessmentDraft((current) => ({ ...current, description }))} />
              <Textarea className="builder-wide" label="Assessment instructions" value={assessmentDraft.instructions} onChange={(instructions) => setAssessmentDraft((current) => ({ ...current, instructions }))} />
              <Select
                className="builder-wide"
                label="Intake scope"
                value={assessmentDraft.programOfferingId}
                onChange={(programOfferingId) => setAssessmentDraft((current) => ({ ...current, programOfferingId }))}
                options={[
                  { value: '', label: intakeOfferingOptions.length ? 'Select an Intake' : 'Shared course activity' },
                  ...intakeOfferingOptions,
                ]}
                required={intakeOfferingOptions.length > 0}
              />
              <Input label="Time limit (minutes)" type="number" min="1" value={assessmentDraft.timeLimitMin} onChange={(timeLimitMin) => setAssessmentDraft((current) => ({ ...current, timeLimitMin }))} />
              <Input label="Attempt limit" type="number" min="1" value={assessmentDraft.attemptLimit} onChange={(attemptLimit) => setAssessmentDraft((current) => ({ ...current, attemptLimit }))} required />
              <Input label="Pass mark (%)" type="number" min="0" max="100" value={assessmentDraft.passMarkPercent} onChange={(passMarkPercent) => setAssessmentDraft((current) => ({ ...current, passMarkPercent }))} required />
              <Input label="Available from" type="datetime-local" value={assessmentDraft.availableFrom} onChange={(availableFrom) => setAssessmentDraft((current) => ({ ...current, availableFrom }))} />
              <Input label="Available until" type="datetime-local" value={assessmentDraft.availableTo} onChange={(availableTo) => setAssessmentDraft((current) => ({ ...current, availableTo }))} />
            </div>
            <Button type="submit" disabled={saving}><Plus size={16} /> Create assessment</Button>
          </form>
          {!course.assessments.length && <div className="builder-empty"><BookOpen size={24} /><strong>No assessments yet</strong><span>Create quizzes here and configure their scoring and availability.</span></div>}
          {course.assessments.map((assessment) => <article className="builder-assessment" id={`builder-assessment-${assessment.id}`} key={assessment.id}>
            <header className="builder-assessment-heading">
              <div><span className="eyebrow">{assessment.status} · {assessment.questions.length} questions</span><h3>{assessment.title}</h3><p>{assessment.description}</p><small>{assessment.programOffering ? `GATE ${String(assessment.programOffering.intake.gateNumber).padStart(2, '0')} — ${assessment.programOffering.intake.season} ${assessment.programOffering.intake.year}` : 'Shared across Intakes'}</small></div>
              <Button variant="secondary" size="sm" onClick={() => {
                if (assessmentSettingsDirty) {
                  setError('Save or discard the edited assessment settings before changing assessments.');
                  return;
                }
                setEditingAssessmentId((current) => current === assessment.id ? '' : assessment.id);
              }}>{editingAssessmentId === assessment.id ? 'Close editor' : 'Configure'}</Button>
            </header>
            {editingAssessmentId === assessment.id && <div className="builder-assessment-editor">
              <div className="builder-form-grid">
                <Input label="Title" value={assessment.title} onChange={(title) => patchAssessment(assessment.id, { title })} />
                <Select label="Assessment status" value={assessment.status} onChange={(status) => patchAssessment(assessment.id, { status })} options={[{ value: 'DRAFT', label: 'Draft' }, { value: 'PUBLISHED', label: 'Published' }]} />
                <Textarea className="builder-wide" label="Description" value={assessment.description || ''} onChange={(description) => patchAssessment(assessment.id, { description })} />
                <Textarea className="builder-wide" label="Instructions" value={assessment.instructions || ''} onChange={(instructions) => patchAssessment(assessment.id, { instructions })} />
                <Input label="Time limit (minutes)" type="number" min="1" value={assessment.timeLimitMin ?? ''} onChange={(timeLimitMin) => patchAssessment(assessment.id, { timeLimitMin: timeLimitMin ? Number(timeLimitMin) : null })} />
                <Input label="Attempt limit" type="number" min="1" value={assessment.attemptLimit} onChange={(attemptLimit) => patchAssessment(assessment.id, { attemptLimit: Number(attemptLimit) })} />
                <Input label="Pass mark (%)" type="number" min="0" max="100" value={assessment.passMarkPercent} onChange={(passMarkPercent) => patchAssessment(assessment.id, { passMarkPercent: Number(passMarkPercent) })} />
                <Input label="Available from" type="datetime-local" value={inputDate(assessment.availableFrom)} onChange={(availableFrom) => patchAssessment(assessment.id, { availableFrom: availableFrom ? new Date(availableFrom).toISOString() : null })} />
                <Input label="Available until" type="datetime-local" value={inputDate(assessment.availableTo)} onChange={(availableTo) => patchAssessment(assessment.id, { availableTo: availableTo ? new Date(availableTo).toISOString() : null })} />
              </div>
              <Button type="button" variant="secondary" disabled={saving} onClick={() => saveAssessmentSettings(assessment)}><Save size={15} /> Save assessment settings</Button>
              {assessmentSettingsDirty && <Button type="button" variant="ghost" disabled={saving} onClick={discardAssessmentSettings}>Discard unsaved settings</Button>}
              <h4>Questions</h4>
              {assessment.questions.map((question, index) => <div className="builder-question-row" key={question.id}>
                <span>{index + 1}. {question.prompt}</span><small>{question.type.replaceAll('_', ' ')} · {question.points} points</small>
                <div className="builder-inline-actions">
                  <Button type="button" variant="ghost" size="sm" disabled={Boolean(editingQuestionId) && editingQuestionId !== question.id} onClick={() => editingQuestionId === question.id ? cancelQuestionEdit() : editQuestion(question)}>
                    {editingQuestionId === question.id ? 'Cancel edit' : 'Edit'}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="action-danger" disabled={Boolean(editingQuestionId)} onClick={() => deleteQuestion(question)}><Trash2 size={14} /> Delete</Button>
                </div>
                {editingQuestionId === question.id && <form className="builder-question-form builder-question-edit" onSubmit={(event) => saveQuestion(event, question)}>
                  <h4>Edit question</h4>
                  <Select label="Question type" value={questionDraft.type} onChange={(type) => setQuestionDraft((current) => ({ ...current, type }))} options={[
                    { value: 'MULTIPLE_CHOICE', label: 'Multiple choice' },
                    { value: 'MULTIPLE_ANSWER', label: 'Multiple select' },
                    { value: 'SHORT_ANSWER', label: 'Short answer' },
                    { value: 'TRUE_FALSE', label: 'True / false' },
                  ]} />
                  <Textarea label="Question prompt" value={questionDraft.prompt} onChange={(prompt) => setQuestionDraft((current) => ({ ...current, prompt }))} required />
                  <Input label="Points" type="number" min="1" value={questionDraft.points} onChange={(points) => setQuestionDraft((current) => ({ ...current, points }))} required />
                  {['MULTIPLE_CHOICE', 'MULTIPLE_ANSWER'].includes(questionDraft.type) && <Textarea label="Options (one per line)" value={questionDraft.options} onChange={(options) => setQuestionDraft((current) => ({ ...current, options }))} required />}
                  {questionDraft.type === 'TRUE_FALSE'
                    ? <Select label="Correct answer" value={questionDraft.correctAnswer} onChange={(correctAnswer) => setQuestionDraft((current) => ({ ...current, correctAnswer }))} options={[{ value: 'True', label: 'True' }, { value: 'False', label: 'False' }]} required />
                    : questionDraft.type !== 'SHORT_ANSWER' && <Input label={questionDraft.type === 'MULTIPLE_ANSWER' ? 'Correct answers (comma separated)' : 'Correct answer'} value={questionDraft.correctAnswer} onChange={(correctAnswer) => setQuestionDraft((current) => ({ ...current, correctAnswer }))} required />}
                  <Textarea label="Answer explanation" value={questionDraft.explanation} onChange={(explanation) => setQuestionDraft((current) => ({ ...current, explanation }))} />
                  <div className="builder-inline-actions">
                    <Button type="submit" disabled={saving}><Save size={15} /> Save question</Button>
                    <Button type="button" variant="ghost" disabled={saving} onClick={cancelQuestionEdit}>Discard</Button>
                  </div>
                </form>}
              </div>)}
              <form className="builder-question-form" onSubmit={(event) => addQuestion(event, assessment)}>
                <h4>Add a question</h4>
                <Select label="Question type" value={questionDraft.type} disabled={Boolean(editingQuestionId)} onChange={(type) => setQuestionDraft((current) => ({ ...current, type }))} options={[
                  { value: 'MULTIPLE_CHOICE', label: 'Multiple choice' },
                  { value: 'MULTIPLE_ANSWER', label: 'Multiple select' },
                  { value: 'SHORT_ANSWER', label: 'Short answer' },
                  { value: 'TRUE_FALSE', label: 'True / false' },
                ]} />
                <Textarea label="Question prompt" value={questionDraft.prompt} disabled={Boolean(editingQuestionId)} onChange={(prompt) => setQuestionDraft((current) => ({ ...current, prompt }))} required />
                <Input label="Points" type="number" min="1" value={questionDraft.points} disabled={Boolean(editingQuestionId)} onChange={(points) => setQuestionDraft((current) => ({ ...current, points }))} required />
                {['MULTIPLE_CHOICE', 'MULTIPLE_ANSWER'].includes(questionDraft.type) && <Textarea label="Options (one per line)" value={questionDraft.options} disabled={Boolean(editingQuestionId)} onChange={(options) => setQuestionDraft((current) => ({ ...current, options }))} required />}
                {questionDraft.type === 'TRUE_FALSE'
                  ? <Select label="Correct answer" value={questionDraft.correctAnswer} disabled={Boolean(editingQuestionId)} onChange={(correctAnswer) => setQuestionDraft((current) => ({ ...current, correctAnswer }))} options={[{ value: 'True', label: 'True' }, { value: 'False', label: 'False' }]} required />
                  : questionDraft.type !== 'SHORT_ANSWER' && <Input label={questionDraft.type === 'MULTIPLE_ANSWER' ? 'Correct answers (comma separated)' : 'Correct answer'} value={questionDraft.correctAnswer} disabled={Boolean(editingQuestionId)} onChange={(correctAnswer) => setQuestionDraft((current) => ({ ...current, correctAnswer }))} required />}
                <Textarea label="Answer explanation" value={questionDraft.explanation} disabled={Boolean(editingQuestionId)} onChange={(explanation) => setQuestionDraft((current) => ({ ...current, explanation }))} />
                <Button type="submit" disabled={saving || Boolean(editingQuestionId)}><Plus size={15} /> Add question</Button>
              </form>
            </div>}
          </article>)}
        </div>}

        {step === 5 && <div className="builder-form-grid">
          <Input label="Estimated duration" value={fields.estimatedDuration} onChange={(estimatedDuration) => updateFields({ estimatedDuration })} placeholder="e.g. 6 hours" />
          {isAdmin && <Select
            className="builder-wide"
            label="Program"
            value={fields.programmeId}
            onChange={(programmeId) => updateFields({
              programmeId,
              cohortIds: fields.cohortIds.filter((cohortId) => (
                cohorts.some((cohort) => (
                  cohort.id === cohortId
                  && cohort.programmeId === programmeId
                  && Boolean(cohort.intakeProgramOfferingId)
                ))
              )),
            })}
            options={programmes.map((programme) => ({ value: programme.id, label: programme.title }))}
          />}
          <Select label="Course visibility" value={fields.visibility} onChange={(visibility) => updateFields({ visibility })} options={[
            { value: 'public', label: 'Public catalogue' },
            { value: 'cohort', label: 'Assigned Intakes' },
            { value: 'private', label: 'Private / invite only' },
          ]} />
          <Input label="Available from" type="datetime-local" value={fields.startDate} onChange={(startDate) => updateFields({ startDate })} />
          <Input label="Available until" type="datetime-local" value={fields.endDate} onChange={(endDate) => updateFields({ endDate })} />
          <Input label="Required lesson completion (%)" type="number" min="1" max="100" value={fields.minimumLessonCompletionPercent} onChange={(minimumLessonCompletionPercent) => updateFields({ minimumLessonCompletionPercent })} required />
          <label className="builder-rule-toggle"><input type="checkbox" checked={fields.requireAssessment} onChange={(event) => updateFields({ requireAssessment: event.target.checked })} /><span><strong>Require all published assessments to be passed</strong><small>Course completion waits for a passing score on every published assessment.</small></span></label>
          <label className="builder-rule-toggle"><input type="checkbox" checked={fields.requireThumbnail} onChange={(event) => updateFields({ requireThumbnail: event.target.checked })} /><span><strong>Require a course thumbnail</strong><small>Publication validation blocks until a thumbnail or cover image is set.</small></span></label>
          {isAdmin ? <>
            <fieldset className="builder-picker builder-wide">
              <legend>Assigned Tutors</legend>
              {trainers.length ? trainers.map((trainer) => <label key={trainer.id}><input type="checkbox" checked={fields.trainerIds.includes(trainer.id)} onChange={() => toggleSelection('trainerIds', trainer.id)} /> {trainer.firstName} {trainer.lastName} <small>{trainer.status === 'ACTIVE' ? trainer.email : `${trainer.email} · inactive; remove to publish`}</small></label>) : <p className="muted">No active Tutors are available.</p>}
            </fieldset>
            <fieldset className="builder-picker builder-wide">
              <legend>Assigned Intakes</legend>
              {!fields.programmeId
                ? <p className="muted">Select a Program before assigning Intakes.</p>
                : cohorts.filter((cohort) => (
                  cohort.programmeId === fields.programmeId && Boolean(cohort.intakeProgramOfferingId)
                )).length
                  ? cohorts.filter((cohort) => (
                    cohort.programmeId === fields.programmeId && Boolean(cohort.intakeProgramOfferingId)
                  )).map((cohort) => <label key={cohort.id}><input type="checkbox" checked={fields.cohortIds.includes(cohort.id)} onChange={() => toggleSelection('cohortIds', cohort.id)} /> {cohort.name}</label>)
                  : <p className="muted">No Intake offerings are configured for this Program.</p>}
            </fieldset>
          </> : <div className="builder-assignment-note builder-wide"><Check size={16} /> Course Tutor assignment is managed by an administrator.</div>}
          <div className="builder-form-actions builder-wide"><Button disabled={saving} onClick={saveSettings}><Save size={16} /> {saving ? 'Saving…' : 'Save course settings'}</Button></div>
        </div>}

        {step === 6 && <>
          <section className="builder-review-snapshot" aria-label="Course review summary">
            <article>
              <span className="eyebrow">Course information</span>
              <h3>{course.title || 'Untitled course'}</h3>
              <p>{course.description || 'No course description yet.'}</p>
              <small>{course.category || 'No category'} · {course.difficulty || 'No level selected'}</small>
              <button type="button" onClick={() => setStep(0)}>Edit course information</button>
            </article>
            <article>
              <span className="eyebrow">Learning outcomes</span>
              <strong>{parseList(course.learningObjectives).length} objectives · {parseList(course.learningOutcomes).length} outcomes</strong>
              <p>{course.targetAudience || 'Target audience not set.'}</p>
              <button type="button" onClick={() => setStep(1)}>Edit learning outcomes</button>
            </article>
            <article>
              <span className="eyebrow">Curriculum and content</span>
              <strong>{course.modules.length} modules · {lessons.length} lessons</strong>
              <p>{lessons.filter((lesson) => parseLessonContentBlocks(lesson.content).length).length} lessons have content blocks.</p>
              <button type="button" onClick={() => setStep(2)}>Edit course structure</button>
              <button type="button" onClick={() => setStep(3)}>Edit lesson content</button>
            </article>
            <article>
              <span className="eyebrow">Course resources</span>
              <strong>{courseResources.length} files</strong>
              {courseResources.length
                ? <ul>{courseResources.map((resource) => <li key={resource.id}>{resource.originalName}</li>)}</ul>
                : <p>No course-level resources added.</p>}
              <button type="button" onClick={() => setStep(4)}>Edit course resources</button>
            </article>
            <article>
              <span className="eyebrow">Settings and assessments</span>
              <strong>{course.visibility || 'Visibility not set'} · {course.status}</strong>
              <p>{course.estimatedDuration || 'Duration not set'} · {course.assessments.length} assessments</p>
              <button type="button" onClick={() => setStep(5)}>Edit settings and assessments</button>
            </article>
          </section>
          <div className="builder-review-actions">
            <p>Validation checks saved course data, lesson blocks, assessment readiness, assignments, and completion rules.</p>
            <Button variant="secondary" disabled={saving} onClick={async () => {
              setSaving(true);
              try {
                const { data } = await coursesAPI.quality(id);
                setQuality(data.data);
                setNotice('Course quality check complete.');
              } catch (requestError) {
                setError(requestError.response?.data?.message || 'Could not validate this course.');
              } finally {
                setSaving(false);
              }
            }}><Check size={16} /> Run quality check</Button>
            <Button variant="secondary" onClick={() => setPreview((current) => !current)}><Eye size={16} /> {preview ? 'Close preview' : 'Preview as learner'}</Button>
          </div>
          {quality && <section className={`builder-quality-summary${quality.valid ? ' is-ready' : ' has-errors'}`} aria-live="polite">
            <div className="builder-quality-title">
              {quality.valid ? <Check size={20} /> : <CircleAlert size={20} />}
              <div>
                <strong>{quality.valid
                  ? quality.warnings?.length ? 'Ready to publish with warnings' : 'Ready to publish'
                  : `${quality.errors.length} blocking issue${quality.errors.length === 1 ? '' : 's'} to resolve`}</strong>
                <span>{quality.summary.lessonCount} lessons · {quality.summary.moduleCount} modules · {quality.summary.readyAssessmentCount} ready assessments</span>
                <small>{quality.errors?.length || 0} errors · {quality.warnings?.length ?? quality.recommendations?.length ?? 0} warnings · {quality.info?.length || 0} info</small>
              </div>
            </div>
            {issues.length > 0 ? <ul className="builder-issue-list">{issues.map((issue, index) => <li className={issue.severity === 'ERROR' ? 'is-error' : issue.severity === 'INFO' ? 'is-info' : 'is-recommendation'} key={`${issue.code}-${issue.entityId || index}`}>
              <span>{issue.severity === 'ERROR' ? 'Blocking error' : issue.severity === 'INFO' ? 'Passed check' : 'Warning'}</span>
              <div>
                <strong>{issue.message}</strong>
                {issue.guidance && <small>{issue.guidance}</small>}
                <button type="button" onClick={() => openQualityIssue(issue)}>{steps[issue.step - 1]?.title || 'Review step'} <ChevronRight size={14} /></button>
              </div>
            </li>)}</ul> : <p>All course quality checks passed. There are no errors or warnings to resolve.</p>}
          </section>}
          {preview && <section className="builder-live-preview" aria-label="Learner course preview">
            <div className="course-hero">
              <div>{(course.coverImage || course.thumbnail || course.thumbnailUrl) && <img className="builder-preview-image" src={course.coverImage || course.thumbnail || course.thumbnailUrl} alt="" />}
                <span className="eyebrow eyebrow-light">{course.category || 'REO Travel Academy'}</span><h2>{course.title}</h2><p>{course.description}</p></div>
              <span className="badge badge-draft">Preview</span>
            </div>
            {course.introduction && <p className="builder-preview-intro">{course.introduction}</p>}
            {parseList(course.learningObjectives).length > 0 && <section className="builder-preview-module">
              <h3>What you will learn</h3>
              <ul>{parseList(course.learningObjectives).map((objective, index) => <li key={`${objective}-${index}`}>{objective}</li>)}</ul>
              {course.targetAudience && <p><strong>Designed for:</strong> {course.targetAudience}</p>}
            </section>}
            <div className="builder-preview-meta">
              {course.estimatedDuration && <span>{course.estimatedDuration}</span>}
              {course.language && <span>{course.language}</span>}
              {course.difficulty && <span>{course.difficulty}</span>}
              {course.startDate && <span>Available from {new Date(course.startDate).toLocaleDateString()}</span>}
              {course.endDate && <span>Available until {new Date(course.endDate).toLocaleDateString()}</span>}
            </div>
            {course.modules.map((module) => <section className="builder-preview-module" key={module.id}>
              <h3>{module.title}</h3>
              {module.description && <p>{module.description}</p>}
              {module.lessons.filter((lesson) => lesson.isPublished).map((lesson) => <article className="builder-preview-lesson" key={lesson.id}>
                <h4>{lesson.title}</h4>
                <LessonContentRenderer
                  content={lesson.content}
                  resources={[...(course.resources || []), ...(lesson.resources || [])]}
                />
              </article>)}
            </section>)}
            {course.assessments.length > 0 && <section className="builder-preview-module">
              <h3>Assessments</h3>
              {course.assessments.map((assessment) => <article className="builder-preview-lesson" key={assessment.id}>
                <h4>{assessment.title}</h4><p>{assessment.instructions || assessment.description}</p>
                <span>{assessment.questions.length} questions · {assessment.attemptLimit} attempts · {assessment.passMarkPercent}% to pass</span>
                  {(assessment.availableFrom || assessment.availableTo) && <small className="builder-assessment-dates">
                    {assessment.availableFrom && `From ${new Date(assessment.availableFrom).toLocaleString()}`}
                    {assessment.availableFrom && assessment.availableTo && ' · '}
                    {assessment.availableTo && `Until ${new Date(assessment.availableTo).toLocaleString()}`}
                  </small>}
                {assessment.questions.map((question, index) => <div className="builder-preview-question" key={question.id}>
                  <strong>{index + 1}. {question.prompt}</strong>
                  {Array.isArray(question.options) && <ul>{question.options.map((option, optionIndex) => <li key={`${option}-${optionIndex}`}>{option}</li>)}</ul>}
                </div>)}
              </article>)}
            </section>}
          </section>}
          <div className="builder-publication-panel">
            <div><strong>Publication state: {course.status}</strong><p>Publishing does not remove existing enrollment, lesson progress, or assessment history.</p></div>
            <div className="builder-publication-buttons">
              <Button variant="secondary" disabled={saving} onClick={saveDraft}><Save size={15} /> {course.status === 'DRAFT' ? 'Save as draft' : 'Save changes'}</Button>
              {course.status !== 'PUBLISHED' && course.status !== 'ARCHIVED' && <Button disabled={!quality?.valid || saving} onClick={publish}>Publish course</Button>}
              {course.status === 'PUBLISHED' && <Button variant="secondary" disabled={saving} onClick={unpublish}>Return to draft</Button>}
              {isAdmin && course.status !== 'ARCHIVED' && <Button variant="ghost" disabled={saving} onClick={archive}>Archive</Button>}
            </div>
          </div>
        </>}

        <footer className="builder-footer">
          <Button variant="ghost" disabled={step === 0 || saving} onClick={() => goToStep(step - 1)}><ChevronLeft size={16} /> Previous</Button>
          <span>{currentStep.title} <small>{step + 1} of {steps.length}</small></span>
          {step < steps.length - 1
            ? <Button disabled={saving} onClick={() => goToStep(step + 1)}>Continue <ChevronRight size={16} /></Button>
            : <Link className="btn btn-secondary" to={`/courses/${id}`}><BookOpen size={16} /> Open course</Link>}
        </footer>
      </main>
      <aside className="builder-aside">
        <div className="builder-aside-card"><span className="eyebrow">Course health</span><strong>{quality?.valid ? 'On track' : 'In progress'}</strong><p>{quality?.errors?.length || 0} blocking issues · {quality?.warnings?.length ?? quality?.recommendations?.length ?? 0} warnings</p><div className="builder-aside-meter"><span style={{ width: `${Math.round((stepComplete.filter(Boolean).length / steps.length) * 100)}%` }} /></div><small>{stepComplete.filter(Boolean).length} of 7 steps have saved content</small></div>
        <div className="builder-aside-card"><span className="eyebrow">Helpful guidance</span><p>Course structure and lesson content save directly to the course. Save the current step before moving on.</p><Link to={`/courses/${id}`}><Eye size={15} /> View current course</Link></div>
      </aside>
    </section>
  </div>;
}
