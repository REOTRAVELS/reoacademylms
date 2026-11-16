import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreAssessmentAttempt } from '../src/utils/assessmentScoring.js';

const attempt = {
  answers: [
    { id: 'a1', questionId: 'q1', answer: 'yes' },
    { id: 'a2', questionId: 'q2', answer: 'free response' },
    { id: 'a3', questionId: 'q3', answer: ['B', 'A'] },
  ],
  assessment: {
    questions: [
      { id: 'q1', type: 'MULTIPLE_CHOICE', correctAnswer: 'yes', points: 2 },
      { id: 'q2', type: 'SHORT_ANSWER', points: 5 },
      { id: 'q3', type: 'MULTIPLE_ANSWER', correctAnswer: ['A', 'B'], points: 3 },
    ],
  },
};

test('scores objective questions but leaves manual responses pending', () => {
  assert.deepEqual(scoreAssessmentAttempt(attempt), {
    answerUpdates: [
      { answerId: 'a1', points: 2, feedback: null, isCorrect: true },
      { answerId: 'a3', points: 3, feedback: null, isCorrect: true },
    ],
    score: 5,
    maxScore: 10,
    status: 'SUBMITTED',
  });
});

test('publishes the final score and feedback after all manual answers are graded', () => {
  const result = scoreAssessmentAttempt(attempt, [
    { questionId: 'q2', points: 4, feedback: 'Clear explanation.' },
  ]);
  assert.equal(result.score, 9);
  assert.equal(result.maxScore, 10);
  assert.equal(result.status, 'GRADED');
  assert.deepEqual(result.answerUpdates.find(({ answerId }) => answerId === 'a2'), {
    answerId: 'a2',
    points: 4,
    feedback: 'Clear explanation.',
    isCorrect: false,
  });
});

test('retains previously graded manual points and does not mark unanswered questions pending', () => {
  const withExistingGrade = {
    ...attempt,
    answers: attempt.answers.map((answer) => answer.questionId === 'q2'
      ? { ...answer, points: 5, feedback: 'Excellent.' }
      : answer),
    assessment: {
      questions: [...attempt.assessment.questions, { id: 'q4', type: 'SHORT_ANSWER', points: 2 }],
    },
  };
  const result = scoreAssessmentAttempt(withExistingGrade);
  assert.equal(result.score, 10);
  assert.equal(result.maxScore, 12);
  assert.equal(result.status, 'GRADED');
});
