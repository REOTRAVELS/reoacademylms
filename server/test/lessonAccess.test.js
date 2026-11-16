import test from 'node:test';
import assert from 'node:assert/strict';
import { isStudentLessonAvailable } from '../src/utils/lessonAccess.js';

const availableLesson = {
  isPublished: true,
  module: {
    course: {
      status: 'PUBLISHED',
      cohorts: [{ id: 'enrolled-cohort' }],
    },
  },
};

test('allows published lessons from published courses assigned to an enrolled cohort', () => {
  assert.equal(isStudentLessonAvailable(availableLesson), true);
});

test('rejects unpublished lessons', () => {
  assert.equal(isStudentLessonAvailable({
    ...availableLesson,
    isPublished: false,
  }), false);
});

test('rejects lessons from unpublished courses', () => {
  assert.equal(isStudentLessonAvailable({
    ...availableLesson,
    module: { course: { ...availableLesson.module.course, status: 'DRAFT' } },
  }), false);
});

test('rejects lessons not assigned to a cohort the student belongs to', () => {
  assert.equal(isStudentLessonAvailable({
    ...availableLesson,
    module: { course: { ...availableLesson.module.course, cohorts: [] } },
  }), false);
});

test('allows published lessons from public courses without cohort enrollment', () => {
  assert.equal(isStudentLessonAvailable({
    ...availableLesson,
    module: { course: { ...availableLesson.module.course, visibility: 'public', cohorts: [] } },
  }), true);
});

test('rejects lessons before the course availability window', () => {
  assert.equal(isStudentLessonAvailable({
    ...availableLesson,
    module: { course: { ...availableLesson.module.course, startDate: '2027-03-01T00:00:00.000Z' } },
  }, new Date('2027-02-28T23:59:59.999Z')), false);
});

test('rejects lessons after the course availability window', () => {
  assert.equal(isStudentLessonAvailable({
    ...availableLesson,
    module: { course: { ...availableLesson.module.course, endDate: '2027-02-28T23:59:59.999Z' } },
  }, new Date('2027-03-01T00:00:00.000Z')), false);
});
