import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCourseQuality } from '../src/utils/courseQuality.js';

const readyCourse = (overrides = {}) => ({
  id: 'course-1',
  title: 'Travel Operations',
  description: 'Learn to plan safe and effective travel.',
  category: 'Travel',
  difficulty: 'All Levels',
  language: 'English',
  thumbnail: 'https://academy.example/course.jpg',
  programmeId: 'programme-1',
  programme: { id: 'programme-1', status: 'ACTIVE' },
  visibility: 'public',
  learningObjectives: JSON.stringify(['Plan a client itinerary']),
  learningOutcomes: JSON.stringify(['Create an accessible itinerary']),
  targetAudience: 'Entry-level travel professionals',
  completionRequirements: '{}',
  trainers: [{ trainer: { status: 'ACTIVE' } }],
  cohorts: [{
    cohort: {
      id: 'cohort-1',
      programmeId: 'programme-1',
      intakeProgramOfferingId: 'offering-1',
    },
  }],
  resources: [],
  modules: [{
    id: 'module-1',
    title: 'Core skills',
    position: 0,
    lessons: [{
      id: 'lesson-1',
      title: 'Planning',
      position: 0,
      isPublished: true,
      content: JSON.stringify([{ type: 'rich_text', content: 'Start with the client brief.' }]),
    }],
  }],
  assessments: [],
  ...overrides,
});

test('course quality accepts a learner-ready course and reports measurable counts', () => {
  const result = validateCourseQuality(readyCourse());

  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.summary.moduleCount, 1);
  assert.equal(result.summary.lessonCount, 1);
});

test('course quality blocks missing essentials, empty modules, and unpublished-only curriculum', () => {
  const result = validateCourseQuality(readyCourse({
    title: ' ',
    description: '',
    targetAudience: '',
    learningObjectives: 'not valid json',
    modules: [{ id: 'empty-module', title: '', position: 0, lessons: [] }],
    trainers: [],
  }));
  const codes = new Set(result.errors.map(({ code }) => code));

  assert.equal(result.valid, false);
  assert.ok(codes.has('missing_title'));
  assert.ok(codes.has('missing_description'));
  assert.ok(codes.has('missing_target_audience'));
  assert.ok(codes.has('missing_objectives'));
  assert.ok(codes.has('empty_module'));
  assert.ok(result.warnings.some(({ code }) => code === 'missing_trainer'));
});

test('a course can be published without a Tutor while clearly warning administrators', () => {
  const result = validateCourseQuality(readyCourse({ trainers: [] }));
  const issue = result.warnings.find(({ code }) => code === 'missing_trainer');

  assert.equal(result.valid, true);
  assert.equal(issue.severity, 'WARNING');
  assert.equal(issue.step, 6);
  assert.equal(issue.entityType, 'Course');
  assert.equal(issue.entityId, 'course-1');
  assert.ok(issue.guidance);
});

test('course quality validates media references and separates image accessibility recommendations', () => {
  const result = validateCourseQuality(readyCourse({
    modules: [{
      id: 'module-1',
      title: 'Core skills',
      position: 0,
      lessons: [{
        id: 'lesson-1',
        title: 'Planning',
        position: 0,
        isPublished: true,
        content: JSON.stringify([
          { type: 'video', content: 'javascript:alert(1)' },
          { type: 'image', content: 'https://academy.example/map.png' },
        ]),
      }],
    }],
  }));

  assert.equal(result.valid, false);
  assert.ok(result.errors.some(({ code }) => code === 'invalid_content_reference'));
  assert.ok(result.recommendations.some(({ code }) => code === 'missing_image_alt'));
});

test('course quality accepts multiple correct knowledge-check answers when each matches an option', () => {
  const result = validateCourseQuality(readyCourse({
    modules: [{
      id: 'module-1',
      title: 'Core skills',
      position: 0,
      lessons: [{
        id: 'lesson-1',
        title: 'Planning',
        position: 0,
        isPublished: true,
        content: JSON.stringify([{
          type: 'knowledge_check',
          content: 'Which sources are current?',
          options: ['Official notice', 'Current airline site', 'Old forum'],
          correctAnswer: ['Official notice', 'Current airline site'],
        }]),
      }],
    }],
  }));

  assert.equal(result.valid, true);
});

test('required assessments must be published and fully configured', () => {
  const question = {
    type: 'MULTIPLE_CHOICE',
    prompt: 'Choose a safe option.',
    points: 2,
    options: ['A', 'B'],
    correctAnswer: 'A',
  };
  const readyAssessment = {
    id: 'assessment-1',
    title: 'Safety check',
    status: 'PUBLISHED',
    attemptLimit: 2,
    passMarkPercent: 70,
    timeLimitMin: 10,
    questions: [question],
  };
  const valid = validateCourseQuality(readyCourse({
    completionRequirements: JSON.stringify({ requireAssessment: true }),
    assessments: [readyAssessment],
  }));
  const invalid = validateCourseQuality(readyCourse({
    completionRequirements: JSON.stringify({ requireAssessment: true }),
    assessments: [{ ...readyAssessment, status: 'DRAFT' }],
  }));

  assert.equal(valid.valid, true);
  assert.equal(valid.summary.readyAssessmentCount, 1);
  assert.equal(invalid.valid, false);
  const assessmentIssue = invalid.errors.find(({ code }) => code === 'assessment_not_ready');
  assert.ok(assessmentIssue);
  assert.equal(assessmentIssue.step, 6);
});

test('course quality blocks invalid completion rules and date ranges', () => {
  const result = validateCourseQuality(readyCourse({
    startDate: new Date('2027-03-01T00:00:00.000Z'),
    endDate: new Date('2027-02-01T00:00:00.000Z'),
    completionRequirements: JSON.stringify({ minimumLessonCompletionPercent: 101 }),
  }));
  const codes = new Set(result.errors.map(({ code }) => code));

  assert.ok(codes.has('invalid_availability_dates'));
  assert.ok(codes.has('invalid_lesson_completion_threshold'));
});

test('quality issues contain stable structured fields and a valid Program is required', () => {
  const result = validateCourseQuality(readyCourse({
    programmeId: null,
    programme: null,
  }));
  const issue = result.errors.find(({ code }) => code === 'missing_programme');

  assert.equal(result.valid, false);
  assert.equal(issue.severity, 'ERROR');
  assert.equal(issue.entityType, 'Course');
  assert.equal(issue.entityId, 'course-1');
  assert.equal(issue.step, 6);
  assert.ok(issue.guidance);
  assert.equal(result.issues.includes(issue), true);
});

test('duplicate curriculum titles and ambiguous ordering block publication', () => {
  const result = validateCourseQuality(readyCourse({
    modules: [
      {
        id: 'module-1',
        title: 'Core skills',
        position: 0,
        lessons: [
          { id: 'lesson-1', title: 'Planning', position: 0, isPublished: true, content: '[{"type":"rich_text","content":"Learn to plan."}]' },
          { id: 'lesson-2', title: ' planning ', position: 0, isPublished: true, content: '[{"type":"rich_text","content":"Learn to plan well."}]' },
        ],
      },
      {
        id: 'module-2',
        title: 'Core skills',
        position: 0,
        lessons: [{ id: 'lesson-3', title: 'Routing', position: 0, isPublished: true, content: '[{"type":"rich_text","content":"Learn routing."}]' }],
      },
    ],
  }));
  const codes = new Set(result.errors.map(({ code }) => code));

  assert.ok(codes.has('duplicate_module_title'));
  assert.ok(codes.has('duplicate_lesson_title'));
  assert.ok(codes.has('invalid_module_order'));
  assert.ok(codes.has('invalid_lesson_order'));
});

test('short descriptions, malformed knowledge checks, and unsafe URLs are blocking', () => {
  const result = validateCourseQuality(readyCourse({
    description: 'Too brief.',
    modules: [{
      id: 'module-1',
      title: 'Core skills',
      position: 0,
      lessons: [{
        id: 'lesson-1',
        title: 'Planning',
        position: 0,
        isPublished: true,
        content: JSON.stringify([
          { type: 'link', content: 'javascript:alert(1)' },
          { type: 'knowledge_check', content: 'Pick an answer', options: ['A', 'A'], correctAnswer: ['A', 'A'] },
        ]),
      }],
    }],
  }));
  const codes = new Set(result.errors.map(({ code }) => code));

  assert.ok(codes.has('insufficient_description'));
  assert.ok(codes.has('invalid_content_reference'));
  assert.ok(codes.has('invalid_knowledge_check'));
  assert.ok(codes.has('invalid_knowledge_check_answer'));
});

test('missing lesson content is only blocking when the lesson is learner-visible', () => {
  const result = validateCourseQuality(readyCourse({
    modules: [{
      id: 'module-1',
      title: 'Core skills',
      position: 0,
      lessons: [{
        id: 'lesson-1',
        title: 'Planning draft',
        position: 0,
        isPublished: false,
        content: '[]',
      }, {
        id: 'lesson-2',
        title: 'Published introduction',
        position: 1,
        isPublished: true,
        content: '[{"type":"rich_text","content":"Learn to plan."}]',
      }],
    }],
  }));

  assert.equal(result.errors.some(({ code }) => code === 'empty_lesson_content'), false);
  assert.ok(result.warnings.some(({ code }) => code === 'lesson_not_published'));
  assert.equal(result.valid, true);
});

test('warnings do not block publication and missing resource files do', () => {
  const warningOnly = validateCourseQuality(readyCourse({ category: '' }));
  assert.equal(warningOnly.valid, true);
  assert.ok(warningOnly.warnings.some(({ code }) => code === 'missing_category'));

  const result = validateCourseQuality(readyCourse({
    category: '',
    resources: [{
      id: 'resource-1',
      originalName: 'missing.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 120,
      storagePath: 'C:\\missing-course-quality-resource.pdf',
    }],
    modules: [{
      id: 'module-1',
      title: 'Core skills',
      position: 0,
      lessons: [{
        id: 'lesson-1',
        title: 'Planning',
        position: 0,
        isPublished: true,
        content: JSON.stringify([{ type: 'document', resourceId: 'resource-1', content: '' }]),
      }],
    }],
  }));

  assert.equal(result.valid, false);
  assert.ok(result.errors.some(({ code }) => code === 'invalid_course_resource'));
  assert.ok(result.errors.some(({ code }) => code === 'invalid_content_reference'));
});

test('course quality accepts resources stored in the private object bucket', () => {
  const result = validateCourseQuality(readyCourse({
    resources: [{
      id: 'resource-1',
      originalName: 'course-guide.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 120,
      storagePath: 'course-resources/user-1/123e4567-e89b-12d3-a456-426614174000.pdf',
    }],
    modules: [{
      id: 'module-1',
      title: 'Core skills',
      position: 0,
      lessons: [{
        id: 'lesson-1',
        title: 'Planning',
        position: 0,
        isPublished: true,
        content: JSON.stringify([{ type: 'document', resourceId: 'resource-1', content: '' }]),
      }],
    }],
  }));

  assert.equal(result.valid, true);
  assert.equal(result.errors.some(({ code }) => code === 'invalid_course_resource'), false);
  assert.equal(result.errors.some(({ code }) => code === 'invalid_content_reference'), false);
});

test('lesson-only resource references are included in availability validation', () => {
  const result = validateCourseQuality(readyCourse({
    modules: [{
      id: 'module-1',
      title: 'Core skills',
      position: 0,
      lessons: [{
        id: 'lesson-1',
        title: 'Planning',
        position: 0,
        isPublished: true,
        content: JSON.stringify([{ type: 'document', resourceId: 'lesson-resource', content: '' }]),
        resources: [{
          id: 'lesson-resource',
          originalName: 'lesson-handout.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 120,
          storagePath: 'C:\\missing-course-quality-lesson-resource.pdf',
        }],
      }],
    }],
  }));

  assert.equal(result.valid, false);
  assert.ok(result.errors.some(({ code, entityId }) => code === 'invalid_course_resource' && entityId === 'lesson-resource'));
  assert.ok(result.errors.some(({ code }) => code === 'invalid_content_reference'));
});

test('optional incomplete assessments are warnings, but required invalid answers block', () => {
  const optional = validateCourseQuality(readyCourse({
    assessments: [{
      id: 'assessment-optional',
      title: 'Optional quiz',
      status: 'DRAFT',
      attemptLimit: 1,
      passMarkPercent: 50,
      timeLimitMin: null,
      questions: [],
    }],
  }));
  const required = validateCourseQuality(readyCourse({
    completionRequirements: JSON.stringify({ requireAssessment: true }),
    assessments: [{
      id: 'assessment-required',
      title: 'Required quiz',
      instructions: 'Select the best answer.',
      status: 'PUBLISHED',
      attemptLimit: 1,
      passMarkPercent: 50,
      timeLimitMin: null,
      questions: [{
        type: 'MULTIPLE_CHOICE',
        prompt: 'Choose a safe option.',
        points: 1,
        options: ['A', 'B'],
        correctAnswer: ['A', 'B'],
      }],
    }],
  }));

  assert.equal(optional.valid, true);
  assert.ok(optional.warnings.some(({ code }) => code === 'assessment_not_ready'));
  const assessmentIssue = required.errors.find(({ code }) => code === 'assessment_not_ready');
  assert.equal(assessmentIssue.entityType, 'Assessment');
  assert.equal(assessmentIssue.entityId, 'assessment-required');
  assert.equal(assessmentIssue.step, 6);
});
