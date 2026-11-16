import test from 'node:test';
import assert from 'node:assert/strict';
import { getAttemptView } from '../src/utils/assessmentAttemptView.js';

const attempt = {
  submittedAt: null,
  score: null,
  answers: [{ questionId: 'question-1', answer: 'A', isCorrect: null, points: null }],
  assessment: {
    questions: [{ id: 'question-1', prompt: 'Question', correctAnswer: 'A' }],
  },
};

test('student attempt view includes saved answers without grading fields or correct answers', () => {
  const view = getAttemptView(attempt, 'STUDENT');
  assert.deepEqual(view.answers, [{ questionId: 'question-1', answer: 'A' }]);
  assert.equal('correctAnswer' in view.assessment.questions[0], false);
  assert.equal(view.assessment.questions[0].prompt, 'Question');
});

test('trainer attempt view retains question keys and grading data', () => {
  const view = getAttemptView(attempt, 'TRAINER');
  assert.equal(view, attempt);
});

test('submitted student attempts still hide correct answers', () => {
  const view = getAttemptView({
    ...attempt,
    submittedAt: new Date(),
    answers: [{ questionId: 'question-1', answer: 'A', isCorrect: true, points: 1 }],
  }, 'STUDENT');
  assert.deepEqual(view.answers[0], { questionId: 'question-1', answer: 'A', isCorrect: true, points: 1 });
  assert.equal('correctAnswer' in view.assessment.questions[0], false);
});

test('withholds submitted examination results and question review until release', () => {
  const view = getAttemptView({
    ...attempt,
    submittedAt: new Date(),
    score: 8,
    maxScore: 10,
    passed: true,
    answers: [{ questionId: 'question-1', answer: 'A', isCorrect: true, points: 8, feedback: 'Correct' }],
    assessment: {
      ...attempt.assessment,
      type: 'EXAMINATION',
      resultsReleased: false,
    },
  }, 'STUDENT');

  assert.equal(view.score, null);
  assert.equal(view.maxScore, null);
  assert.equal(view.passed, null);
  assert.deepEqual(view.answers, []);
  assert.deepEqual(view.assessment.questions, []);
});

test('never returns examination score fields before release, including during an active attempt', () => {
  const view = getAttemptView({
    ...attempt,
    score: 2,
    maxScore: 10,
    assessment: {
      ...attempt.assessment,
      type: 'EXAMINATION',
      resultsReleased: false,
    },
  }, 'STUDENT');

  assert.equal(view.score, null);
  assert.equal(view.maxScore, null);
  assert.equal(view.passed, null);
  assert.equal(view.assessment.questions.length, 1);
});

test('shows examination results after an administrator releases them', () => {
  const view = getAttemptView({
    ...attempt,
    submittedAt: new Date(),
    score: 8,
    maxScore: 10,
    answers: [{ questionId: 'question-1', answer: 'A', isCorrect: true, points: 8 }],
    assessment: {
      ...attempt.assessment,
      type: 'EXAMINATION',
      resultsReleased: true,
    },
  }, 'STUDENT');

  assert.equal(view.score, 8);
  assert.equal(view.maxScore, 10);
  assert.equal(view.answers[0].points, 8);
  assert.equal(view.assessment.questions.length, 1);
});

test('shows an individually released examination result while other attempts remain held', () => {
  const view = getAttemptView({
    ...attempt,
    submittedAt: new Date(),
    resultsReleasedAt: new Date(),
    score: 8,
    maxScore: 10,
    answers: [{ questionId: 'question-1', answer: 'A', isCorrect: true, points: 8 }],
    assessment: {
      ...attempt.assessment,
      type: 'EXAMINATION',
      resultsReleased: false,
    },
  }, 'STUDENT');

  assert.equal(view.score, 8);
  assert.equal(view.maxScore, 10);
  assert.equal(view.answers[0].points, 8);
});
