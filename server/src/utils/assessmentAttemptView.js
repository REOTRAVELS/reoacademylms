export const getAttemptView = (attempt, role) => {
  if (role !== 'STUDENT') return attempt;
  const examinationResultsPending = attempt.assessment.type === 'EXAMINATION'
    && !attempt.assessment.resultsReleased
    && !attempt.resultsReleasedAt;
  if (examinationResultsPending && attempt.submittedAt) {
    return {
      ...attempt,
      score: null,
      maxScore: null,
      passed: null,
      answers: [],
      assessment: { ...attempt.assessment, questions: [] },
    };
  }

  const questions = attempt.assessment.questions.map(({ correctAnswer, ...question }) => question);
  const answers = attempt.submittedAt
    ? attempt.answers
    : attempt.answers.map(({ isCorrect, points, feedback, ...answer }) => answer);
  const scored = attempt.score !== null && attempt.score !== undefined
    && attempt.maxScore > 0
    && !attempt.assessment.questions.some((question) => question.type === 'SHORT_ANSWER'
      && attempt.answers.some((answer) => answer.questionId === question.id && answer.points === null));

  return {
    ...attempt,
    score: examinationResultsPending ? null : attempt.score,
    maxScore: examinationResultsPending ? null : attempt.maxScore,
    passed: !examinationResultsPending && scored
      ? (attempt.score / attempt.maxScore) * 100 >= attempt.assessment.passMarkPercent
      : null,
    answers,
    assessment: { ...attempt.assessment, questions },
  };
};
