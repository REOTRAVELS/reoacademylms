import test from 'node:test';
import assert from 'node:assert/strict';
import { isAssessmentOpen, isAttemptWithinTimeLimit } from '../src/utils/assessmentAvailability.js';
import { getSubmissionAction, hideUnreleasedGrades } from '../src/utils/submissionPolicy.js';

const now = new Date('2026-11-09T12:00:00Z');

test('assessment windows include both configured boundaries', () => {
  assert.equal(isAssessmentOpen({
    availableFrom: new Date('2026-11-09T12:00:00Z'),
    availableTo: new Date('2026-11-09T12:00:00Z'),
  }, now), true);
});

test('assessment outside its window is unavailable', () => {
  assert.equal(isAssessmentOpen({
    availableFrom: new Date('2026-11-09T12:01:00Z'),
    availableTo: null,
  }, now), false);
  assert.equal(isAssessmentOpen({
    availableFrom: null,
    availableTo: new Date('2026-11-09T11:59:00Z'),
  }, now), false);
});

test('assessment attempt time limit is enforced from its start time', () => {
  const attempt = {
    startedAt: new Date('2026-11-09T11:30:00Z'),
    assessment: { timeLimitMin: 30 },
  };
  assert.equal(isAttemptWithinTimeLimit(attempt, now), true);
  assert.equal(isAttemptWithinTimeLimit(attempt, new Date(now.getTime() + 1)), false);
  assert.equal(isAttemptWithinTimeLimit({ ...attempt, assessment: { timeLimitMin: null } }, now), true);
});

test('ungraded submissions can be revised but graded submissions cannot', () => {
  assert.equal(getSubmissionAction(null), 'create');
  assert.equal(getSubmissionAction({ grade: null }), 'update');
  assert.equal(getSubmissionAction({ grade: { released: false } }), 'reject');
});

test('unreleased grade and graded status are not shown to students', () => {
  const [unreleased, released, pending] = hideUnreleasedGrades([
    { status: 'GRADED', grade: { score: 9, released: false } },
    { status: 'GRADED', grade: { score: 9, released: true } },
    { status: 'SUBMITTED', grade: null },
  ]);
  assert.equal(unreleased.status, 'SUBMITTED');
  assert.equal(unreleased.grade, null);
  assert.equal(unreleased.canResubmit, false);
  assert.equal(released.grade.score, 9);
  assert.equal(released.canResubmit, false);
  assert.equal(pending.status, 'SUBMITTED');
  assert.equal(pending.canResubmit, true);
});
