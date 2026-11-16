import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessmentCompletionFilter,
  countExaminationsAwaitingResults,
  getScoreableAssessmentIds,
} from '../src/utils/assessmentCompletion.js';

test('unreleased examinations remain required but cannot expose a pass result', () => {
  const assessments = [
    { id: 'quiz-1', type: 'ASSESSMENT', resultsReleased: false },
    { id: 'exam-pending', type: 'EXAMINATION', resultsReleased: false },
  ];

  assert.deepEqual(getScoreableAssessmentIds(assessments), ['quiz-1']);
  assert.equal(countExaminationsAwaitingResults(assessments), 1);
  assert.deepEqual(assessmentCompletionFilter.OR[1], {
    type: 'EXAMINATION',
    status: { in: ['PUBLISHED', 'CLOSED'] },
  });
});

test('released examinations count toward completion after publication closes', () => {
  const assessments = [
    { id: 'quiz-1', type: 'ASSESSMENT', resultsReleased: false },
    { id: 'exam-released', type: 'EXAMINATION', resultsReleased: true },
  ];

  assert.deepEqual(getScoreableAssessmentIds(assessments), ['quiz-1', 'exam-released']);
  assert.equal(countExaminationsAwaitingResults(assessments), 0);
});
