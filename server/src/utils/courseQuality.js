import fs from 'node:fs';
import path from 'node:path';

const contentBlockTypes = new Set([
  'rich_text',
  'video',
  'image',
  'document',
  'link',
  'exercise',
  'knowledge_check',
  'summary',
]);

const parseJson = (value) => {
  if (typeof value !== 'string') return { value, valid: true };
  try {
    return { value: JSON.parse(value), valid: true };
  } catch {
    return { value: null, valid: false };
  }
};

const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;
const isMeaningful = (value) => nonEmpty(value) && value.trim().length >= 3;
const isHttpUrl = (value) => {
  if (!nonEmpty(value)) return false;
  try {
    const url = new URL(value.trim());
    return ['https:', 'http:'].includes(url.protocol)
      && Boolean(url.hostname)
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
};

const makeIssue = (
  severity,
  code,
  message,
  step,
  entityId = null,
  entityType = null,
  guidance = message,
) => ({
  severity,
  code,
  message,
  entityType: entityType || (step === 3 && entityId
    ? 'Module'
    : step === 4
      ? 'Lesson'
      : step === 5
        ? 'Resource'
        : step === 6 && entityId
          ? 'Assessment'
          : 'Course'),
  entityId,
  step,
  guidance,
});

const normalizeContentBlocks = (content) => {
  if (Array.isArray(content)) return { blocks: content, legacy: false };
  if (typeof content !== 'string' || !content.trim()) return { blocks: [], legacy: false };
  const parsed = parseJson(content);
  if (parsed.valid && Array.isArray(parsed.value)) return { blocks: parsed.value, legacy: false };
  if (!parsed.valid && !/^\s*[\[{]/.test(content)) {
    return { blocks: [{ type: 'rich_text', content }], legacy: true };
  }
  return { blocks: [], legacy: false, malformed: true };
};

const getCompletionSettings = (value) => {
  const parsed = parseJson(value ?? '{}');
  if (!parsed.valid || !parsed.value || Array.isArray(parsed.value) || typeof parsed.value !== 'object') {
    return { settings: {}, valid: false };
  }
  return { settings: parsed.value, valid: true };
};

const validateBlock = (block, resources, lesson, index) => {
  const issues = [];
  const label = `${lesson.title}: content block ${index + 1}`;
  if (!block || typeof block !== 'object' || Array.isArray(block)) {
    return [makeIssue('ERROR', 'invalid_content_block', `${label} is not a valid content block.`, 4, lesson.id, 'Lesson')];
  }
  if (!contentBlockTypes.has(block.type)) {
    return [makeIssue('ERROR', 'unsupported_content_block', `${label} has an unsupported type.`, 4, lesson.id, 'Lesson')];
  }
  const usesResource = ['video', 'image', 'document'].includes(block.type)
    && nonEmpty(block.resourceId);
  const resourceExists = usesResource && resources.has(block.resourceId);
  if (usesResource && !resourceExists) {
    issues.push(makeIssue(
      'ERROR',
      'invalid_content_reference',
      `${label} references a resource that is unavailable for this course.`,
      4,
      lesson.id,
      'Lesson',
      'Select an available course resource or replace it with a valid HTTP(S) URL.',
    ));
  }
  if (!nonEmpty(block.content) && !resourceExists) {
    issues.push(makeIssue('ERROR', 'empty_content_block', `${label} needs content.`, 4, lesson.id, 'Lesson'));
    return issues;
  }
  if (['video', 'image', 'document', 'link'].includes(block.type)) {
    if (!resourceExists && !isHttpUrl(block.content)) {
      issues.push(makeIssue(
        'ERROR',
        'invalid_content_reference',
        `${label} needs a valid HTTP(S) URL or a resource attached to this course.`,
        4,
        lesson.id,
        'Lesson',
        'Use an HTTP(S) address with a host name, or select an available course resource.',
      ));
    }
    if (block.type === 'image' && !nonEmpty(block.altText)) {
      issues.push(makeIssue(
        'WARNING',
        'missing_image_alt',
        `${label} should include descriptive alt text.`,
        4,
        lesson.id,
        'Lesson',
        'Add alternative text that explains the image for learners using assistive technology.',
      ));
    }
  }
  if (block.type === 'knowledge_check') {
    const options = Array.isArray(block.options) ? block.options.filter(nonEmpty) : [];
    const uniqueOptions = new Set(options.map((option) => option.trim()));
    if (!isMeaningful(block.content)) {
      issues.push(makeIssue('ERROR', 'invalid_knowledge_check', `${label} needs a meaningful question.`, 4, lesson.id, 'Lesson'));
    }
    if (options.length < 2 || uniqueOptions.size !== options.length) {
      issues.push(makeIssue(
        'ERROR',
        'invalid_knowledge_check',
        `${label} needs at least two distinct, non-empty answer options.`,
        4,
        lesson.id,
        'Lesson',
      ));
    }
    if (block.correctAnswer === undefined || block.correctAnswer === null || block.correctAnswer === '') {
      issues.push(makeIssue(
        'ERROR',
        'missing_knowledge_check_answer',
        `${label} needs a correct answer.`,
        4,
        lesson.id,
        'Lesson',
      ));
    } else {
      const answers = Array.isArray(block.correctAnswer) ? block.correctAnswer : [block.correctAnswer];
      if (!answers.length || new Set(answers).size !== answers.length
        || answers.some((answer) => !options.includes(answer))) {
        issues.push(makeIssue(
          'ERROR',
          'invalid_knowledge_check_answer',
          `${label} correct answer must match one or more distinct answer options.`,
          4,
          lesson.id,
          'Lesson',
        ));
      }
    }
  }
  return issues;
};

const validDate = (value) => value === undefined || value === null
  || Number.isFinite(new Date(value).getTime());

const isAssessmentReady = (assessment) => {
  if (assessment.status !== 'PUBLISHED') return false;
  if (!nonEmpty(assessment.title) || !Number.isInteger(assessment.attemptLimit) || assessment.attemptLimit < 1) return false;
  if (assessment.timeLimitMin !== null && assessment.timeLimitMin !== undefined
    && (!Number.isInteger(assessment.timeLimitMin) || assessment.timeLimitMin < 1)) return false;
  if (typeof assessment.passMarkPercent !== 'number' || assessment.passMarkPercent < 0 || assessment.passMarkPercent > 100) return false;
  if (!validDate(assessment.availableFrom) || !validDate(assessment.availableTo)) return false;
  if (assessment.availableFrom && assessment.availableTo && new Date(assessment.availableTo) < new Date(assessment.availableFrom)) return false;
  if (!Array.isArray(assessment.questions) || assessment.questions.length === 0) return false;
  return assessment.questions.every((question) => {
    if (!isMeaningful(question.prompt) || !Number.isInteger(question.points) || question.points < 1) return false;
    if (question.type === 'SHORT_ANSWER') return true;
    if (question.type === 'MULTIPLE_CHOICE' || question.type === 'MULTIPLE_ANSWER') {
      if (!Array.isArray(question.options)) return false;
      const options = question.options.filter(nonEmpty);
      if (options.length < 2 || new Set(options).size !== options.length) return false;
      const answers = Array.isArray(question.correctAnswer) ? question.correctAnswer : [question.correctAnswer];
      if (!answers.length || answers.some((answer) => !options.includes(answer))) return false;
      return question.type !== 'MULTIPLE_CHOICE' || answers.length === 1;
    }
    return question.type === 'TRUE_FALSE'
      && [true, false, 'True', 'False'].includes(question.correctAnswer);
  });
};

const hasAvailableResource = (resource) => {
  if (!nonEmpty(resource.storagePath)) return false;
  if (resource.storagePath.startsWith('course-resources/')) return true;
  const filePath = path.resolve(resource.storagePath);
  if (!fs.existsSync(filePath)) return false;
  try {
    return fs.statSync(filePath).isFile();
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
};

const validPosition = (items) => items.every(({ position }) => (
  Number.isInteger(position) && position >= 0
)) && new Set(items.map(({ position }) => position)).size === items.length;

const duplicateByTitle = (items) => {
  const seen = new Set();
  return items.filter((item) => {
    const title = nonEmpty(item.title) ? item.title.trim().toLocaleLowerCase() : '';
    if (!title || !seen.has(title)) {
      if (title) seen.add(title);
      return false;
    }
    return true;
  });
};

export const validateCourseQuality = (course) => {
  const errors = [];
  const warnings = [];
  const info = [];
  const settingsResult = getCompletionSettings(course.completionRequirements);
  const settings = settingsResult.settings;
  const push = (issue) => {
    const normalized = {
      ...issue,
      entityId: issue.entityId || course.id || null,
      entityType: issue.entityType || 'Course',
    };
    if (normalized.severity === 'ERROR') errors.push(normalized);
    else if (normalized.severity === 'INFO') info.push(normalized);
    else warnings.push(normalized);
  };

  if (!isMeaningful(course.title)) {
    push(makeIssue('ERROR', 'missing_title', 'Enter a meaningful course title of at least 3 characters.', 1));
  } else if (course.title.trim().length > 120) {
    push(makeIssue('ERROR', 'invalid_title', 'Enter a meaningful course title between 3 and 120 characters.', 1));
  }
  if (!nonEmpty(course.description)) {
    push(makeIssue('ERROR', 'missing_description', 'Add a course description for learners.', 1));
  } else if (course.description.trim().length < 20) {
    push(makeIssue(
      'ERROR',
      'insufficient_description',
      'Write a more informative course description (at least 20 characters).',
      1,
    ));
  }
  if (!nonEmpty(course.category)) {
    push(makeIssue(
      'WARNING',
      'missing_category',
      'Add a course category to help learners understand the subject.',
      1,
      null,
      'Course',
      'Choose a relevant category in Course identity.',
    ));
  }
  if (!nonEmpty(course.difficulty)) {
    push(makeIssue('ERROR', 'missing_difficulty', 'Set the course difficulty level.', 1));
  }
  if (!nonEmpty(course.language)) {
    push(makeIssue('ERROR', 'missing_language', 'Set the course language.', 1));
  }
  if (!nonEmpty(course.thumbnail) && !nonEmpty(course.coverImage) && !nonEmpty(course.thumbnailUrl)) {
    push(makeIssue(
      settings.requireThumbnail ? 'ERROR' : 'WARNING',
      'missing_thumbnail',
      'Add a course thumbnail or cover image.',
      1,
      null,
      'Course',
      'Add a valid HTTP(S) image URL in Course identity.',
    ));
  }
  for (const [field, value] of [['thumbnail', course.thumbnail || course.thumbnailUrl], ['cover image', course.coverImage]]) {
    if (nonEmpty(value) && !isHttpUrl(value)) {
      push(makeIssue(
        settings.requireThumbnail ? 'ERROR' : 'WARNING',
        'invalid_course_image_reference',
        `Provide a valid HTTP(S) URL for the course ${field}.`,
        1,
      ));
    }
  }
  if (!course.programmeId || !course.programme?.id || course.programme.id !== course.programmeId) {
    push(makeIssue(
      'ERROR',
      'missing_programme',
      'Assign this course to a valid Program.',
      6,
      null,
      'Course',
      'Choose a Program in Course settings before publishing.',
    ));
  } else if (course.programme.status !== 'ACTIVE') {
    push(makeIssue(
      'ERROR',
      'inactive_programme',
      'The course Program must be active before this course can be published.',
      6,
      null,
      'Course',
      'Ask an administrator to activate the Program or choose an active Program.',
    ));
  }
  if (!nonEmpty(course.targetAudience)) {
    push(makeIssue('ERROR', 'missing_target_audience', 'Describe who this course is for.', 2));
  }

  const objectives = parseJson(course.learningObjectives ?? '[]');
  if (!objectives.valid || !Array.isArray(objectives.value) || !objectives.value.some(isMeaningful)) {
    push(makeIssue('ERROR', 'missing_objectives', 'Add at least one meaningful learning objective.', 2));
  }
  const outcomes = parseJson(course.learningOutcomes ?? '[]');
  if (!outcomes.valid || !Array.isArray(outcomes.value) || !outcomes.value.some(isMeaningful)) {
    push(makeIssue('ERROR', 'missing_outcomes', 'Add at least one measurable learning outcome.', 2));
  }
  if (!settingsResult.valid) {
    push(makeIssue('ERROR', 'invalid_completion_requirements', 'Review the completion requirements; they must be a valid settings object.', 6));
  }
  if (settings.minimumLessonCompletionPercent !== undefined
    && (!Number.isInteger(settings.minimumLessonCompletionPercent)
      || settings.minimumLessonCompletionPercent < 1
      || settings.minimumLessonCompletionPercent > 100)) {
    push(makeIssue('ERROR', 'invalid_lesson_completion_threshold', 'Set the required lesson completion threshold to a whole percentage from 1 to 100.', 6));
  }
  if (settings.requireAssessment !== undefined && typeof settings.requireAssessment !== 'boolean') {
    push(makeIssue('ERROR', 'invalid_assessment_completion_rule', 'Assessment completion must be enabled or disabled.', 6));
  }
  if (settings.requireThumbnail !== undefined && typeof settings.requireThumbnail !== 'boolean') {
    push(makeIssue('ERROR', 'invalid_thumbnail_rule', 'Thumbnail requirement must be enabled or disabled.', 6));
  }

  if (!validDate(course.startDate) || !validDate(course.endDate)
    || (course.startDate && course.endDate && new Date(course.endDate) < new Date(course.startDate))) {
    push(makeIssue('ERROR', 'invalid_availability_dates', 'Provide a valid course availability range with the end date after the start date.', 6));
  }
  if (!['public', 'private', 'cohort'].includes(course.visibility)) {
    push(makeIssue('ERROR', 'invalid_course_visibility', 'Choose a supported course visibility setting.', 6));
  }
  if (!Array.isArray(course.trainers) || course.trainers.length === 0
    || course.trainers.every(({ trainer }) => trainer?.status !== 'ACTIVE')) {
    push(makeIssue(
      'WARNING',
      'missing_trainer',
      'No active Tutor is assigned to this course.',
      6,
      null,
      'Course',
      'Assign an active Tutor before scheduled teaching begins.',
    ));
  }

  const modules = Array.isArray(course.modules) ? course.modules : [];
  if (!modules.length) {
    push(makeIssue('ERROR', 'missing_modules', 'Add at least one module to the course structure.', 3));
  } else if (!validPosition(modules)) {
    push(makeIssue(
      'ERROR',
      'invalid_module_order',
      'Correct the module order; positions must be unique non-negative integers.',
      3,
      null,
      'Course',
      'Reorder the modules in Course structure and save the order.',
    ));
  }
  for (const module of duplicateByTitle(modules)) {
    push(makeIssue(
      'ERROR',
      'duplicate_module_title',
      `The module title “${module.title}” is duplicated.`,
      3,
      module.id,
      'Module',
      'Rename the duplicate module to describe its distinct content.',
    ));
  }
  const resources = new Set();
  const resourceRecords = new Map(
    (Array.isArray(course.resources) ? course.resources : []).map((resource) => [resource.id, resource]),
  );
  for (const module of modules) {
    for (const lesson of module.lessons || []) {
      for (const resource of lesson.resources || []) {
        if (!resourceRecords.has(resource.id)) resourceRecords.set(resource.id, resource);
      }
    }
  }
  for (const resource of resourceRecords.values()) {
    const validMetadata = nonEmpty(resource.originalName)
      && /^[\w.+-]+\/[\w.+-]+$/.test(resource.mimeType || '')
      && Number.isSafeInteger(resource.sizeBytes)
      && resource.sizeBytes > 0
      && hasAvailableResource(resource);
    if (!validMetadata) {
      push(makeIssue(
        'ERROR',
        'invalid_course_resource',
        `The resource “${resource.originalName || 'Unnamed resource'}” is incomplete or unavailable.`,
        5,
        resource.id,
        'Resource',
        'Re-upload the resource or remove it from this course.',
      ));
    } else {
      resources.add(resource.id);
    }
  }
  const cohorts = Array.isArray(course.cohorts)
    ? course.cohorts.map(({ cohort }) => cohort).filter(Boolean)
    : [];
  const validProgramCohorts = cohorts.filter((cohort) => (
    cohort.programmeId === course.programmeId && Boolean(cohort.intakeProgramOfferingId)
  ));
  if (cohorts.some((cohort) => cohort.programmeId !== course.programmeId)) {
    push(makeIssue(
      'ERROR',
      'cohort_programme_mismatch',
      'Every cohort assigned to this course must belong to the same Program.',
      6,
      null,
      'Course',
      'Remove cohorts from another Program or select matching cohorts in Course settings.',
    ));
  }
  if (!validProgramCohorts.length) {
    push(makeIssue(
      'ERROR',
      'missing_program_cohort',
      'Assign at least one cohort with a Program Offering so enrolled learners can access the course.',
      6,
      null,
      'Course',
      'Select an eligible cohort in Course settings.',
    ));
  }
  if (modules.length && modules.flatMap((module) => module.lessons || []).every((lesson) => !lesson.isPublished)) {
    push(makeIssue('ERROR', 'no_learner_visible_lessons', 'Publish at least one lesson so learners can access course content.', 3));
  }
  for (const module of modules) {
    if (!isMeaningful(module.title)) {
      push(makeIssue('ERROR', 'missing_module_title', 'Give each module a meaningful title.', 3, module.id, 'Module'));
    }
    const lessons = Array.isArray(module.lessons) ? module.lessons : [];
    if (!lessons.length) {
      push(makeIssue('ERROR', 'empty_module', `Add at least one lesson to “${module.title || 'Untitled module'}”.`, 3, module.id, 'Module'));
      continue;
    }
    if (!validPosition(lessons)) {
      push(makeIssue(
        'ERROR',
        'invalid_lesson_order',
        `Correct the lesson order in “${module.title || 'Untitled module'}”; positions must be unique non-negative integers.`,
        3,
        module.id,
        'Module',
        'Reorder the lessons in Course structure and save the order.',
      ));
    }
    for (const lesson of duplicateByTitle(lessons)) {
      push(makeIssue(
        'ERROR',
        'duplicate_lesson_title',
        `The lesson title “${lesson.title}” is duplicated in “${module.title || 'Untitled module'}”.`,
        3,
        lesson.id,
        'Lesson',
        'Rename the duplicate lesson to describe its distinct content.',
      ));
    }
    for (const lesson of lessons) {
      if (!lesson.isPublished) {
        push(makeIssue(
          'WARNING',
          'lesson_not_published',
          `“${lesson.title || 'Untitled lesson'}” is hidden from learners.`,
          3,
          lesson.id,
          'Lesson',
          'Publish the lesson if it should be included in the learner experience.',
        ));
      }
      if (!isMeaningful(lesson.title)) {
        push(makeIssue('ERROR', 'missing_lesson_title', 'Give each lesson a meaningful title.', 3, lesson.id, 'Lesson'));
      }
      if (!lesson.isPublished) continue;

      const { blocks, legacy, malformed } = normalizeContentBlocks(lesson.content);
      if (!blocks.length) {
        push(makeIssue(
          'ERROR',
          'empty_lesson_content',
          `Add meaningful content to “${lesson.title || 'Untitled lesson'}”.`,
          4,
          lesson.id,
          'Lesson',
        ));
      } else {
        if (legacy) {
          push(makeIssue(
            'WARNING',
            'legacy_lesson_content',
            `Convert “${lesson.title}” to structured content blocks for richer playback.`,
            4,
            lesson.id,
            'Lesson',
            'Open Lesson content and save this lesson using supported content blocks.',
          ));
        }
        blocks.forEach((block, index) => validateBlock(block, resources, lesson, index).forEach(push));
      }
      if (malformed) {
        push(makeIssue('ERROR', 'invalid_lesson_content', `Repair the content blocks in “${lesson.title || 'Untitled lesson'}”.`, 4, lesson.id, 'Lesson'));
      }
    }
  }

  const assessments = Array.isArray(course.assessments) ? course.assessments : [];
  const readyAssessments = assessments.filter(isAssessmentReady);
  for (const assessment of assessments) {
    if (!nonEmpty(assessment.instructions)) {
      push(makeIssue(
        'WARNING',
        'assessment_missing_instructions',
        `Assessment “${assessment.title || 'Untitled assessment'}” has no instructions.`,
        6,
        assessment.id,
        'Assessment',
        'Add learner-facing instructions if this assessment needs special guidance.',
      ));
    }
    if (!isAssessmentReady(assessment)) {
      push(makeIssue(
        settings.requireAssessment ? 'ERROR' : 'WARNING',
        'assessment_not_ready',
        `Complete the settings and questions for assessment “${assessment.title || 'Untitled assessment'}”.`,
        6,
        assessment.id,
        'Assessment',
        'Set valid assessment settings, publish it, and ensure all questions have valid prompts, points, options, and correct answers.',
      ));
    }
  }
  if (settings.requireAssessment && readyAssessments.length === 0 && assessments.length === 0) {
    push(makeIssue('ERROR', 'missing_assessment', 'Add and configure at least one assessment as required by the completion rules.', 6));
  }

  const issues = [...errors, ...warnings, ...info];
  return {
    valid: errors.length === 0,
    issues,
    errors,
    warnings,
    info,
    recommendations: warnings,
    checkedAt: new Date().toISOString(),
    summary: {
      errorCount: errors.length,
      warningCount: warnings.length,
      infoCount: info.length,
      recommendationCount: warnings.length,
      moduleCount: modules.length,
      lessonCount: modules.reduce((count, module) => count + (module.lessons?.length || 0), 0),
      assessmentCount: assessments.length,
      readyAssessmentCount: readyAssessments.length,
    },
  };
};

export const isValidContentBlockArray = (content) => {
  const parsed = parseJson(content);
  return parsed.valid && Array.isArray(parsed.value)
    && parsed.value.every((block) => block && typeof block === 'object'
      && !Array.isArray(block)
      && contentBlockTypes.has(block.type)
      && (nonEmpty(block.content)
        || (['video', 'image', 'document'].includes(block.type) && nonEmpty(block.resourceId))));
};
