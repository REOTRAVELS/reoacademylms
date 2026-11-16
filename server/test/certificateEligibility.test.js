import test from 'node:test';
import assert from 'node:assert/strict';
import { hasCompletedCourseRequirements } from '../src/utils/certificateEligibility.js';

test('requires every published lesson and assessment to be completed or submitted', () => {
  assert.equal(hasCompletedCourseRequirements({
    lessonCount: 2,
    completedLessonCount: 2,
    assessmentCount: 1,
    submittedAssessmentCount: 1,
  }), true);
  assert.equal(hasCompletedCourseRequirements({
    lessonCount: 2,
    completedLessonCount: 1,
    assessmentCount: 1,
    submittedAssessmentCount: 1,
  }), false);
  assert.equal(hasCompletedCourseRequirements({
    lessonCount: 2,
    completedLessonCount: 2,
    assessmentCount: 1,
    submittedAssessmentCount: 0,
  }), false);
});

test('does not issue a certificate for a course without published learning requirements', () => {
  assert.equal(hasCompletedCourseRequirements({
    lessonCount: 0,
    completedLessonCount: 0,
    assessmentCount: 0,
    submittedAssessmentCount: 0,
  }), false);
});

test('respects completion thresholds and only requires assessments when configured', () => {
  assert.equal(hasCompletedCourseRequirements({
    lessonCount: 4,
    completedLessonCount: 3,
    assessmentCount: 0,
    submittedAssessmentCount: 0,
    minimumLessonCompletionPercent: 75,
    requireAssessment: false,
  }), true);
  assert.equal(hasCompletedCourseRequirements({
    lessonCount: 4,
    completedLessonCount: 3,
    assessmentCount: 1,
    submittedAssessmentCount: 1,
    minimumLessonCompletionPercent: 80,
    requireAssessment: true,
  }), false);
  assert.equal(hasCompletedCourseRequirements({
    lessonCount: 4,
    completedLessonCount: 4,
    assessmentCount: 0,
    submittedAssessmentCount: 0,
    requireAssessment: true,
  }), false);
});
