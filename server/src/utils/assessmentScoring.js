export const scoreAssessmentAttempt = (attempt, manualGrades = []) => {
  const answersByQuestionId = new Map(attempt.answers.map((answer) => [answer.questionId, answer]));
  const manualGradesByQuestionId = new Map(manualGrades.map((grade) => [grade.questionId, grade]));
  const answerUpdates = [];
  let score = 0;
  let maxScore = 0;
  let needsManualGrading = false;

  for (const question of attempt.assessment.questions) {
    maxScore += question.points;
    const answer = answersByQuestionId.get(question.id);
    if (!answer) continue;

    if (question.type === 'SHORT_ANSWER') {
      const manualGrade = manualGradesByQuestionId.get(question.id);
      const points = manualGrade?.points ?? answer.points;
      const feedback = manualGrade ? manualGrade.feedback ?? null : answer.feedback ?? null;
      if (points === null || points === undefined) {
        needsManualGrading = true;
        continue;
      }
      score += points;
      if (manualGrade) {
        answerUpdates.push({
          answerId: answer.id,
          points,
          feedback,
          isCorrect: points === question.points,
        });
      }
      continue;
    }

    const isCorrect = question.type === 'MULTIPLE_ANSWER'
      ? JSON.stringify(Array.isArray(answer.answer) ? [...answer.answer].sort() : answer.answer)
        === JSON.stringify(Array.isArray(question.correctAnswer) ? [...question.correctAnswer].sort() : question.correctAnswer)
      : JSON.stringify(answer.answer) === JSON.stringify(question.correctAnswer);
    const points = isCorrect ? question.points : 0;
    score += points;
    answerUpdates.push({ answerId: answer.id, points, feedback: null, isCorrect });
  }

  return {
    answerUpdates,
    score,
    maxScore,
    status: needsManualGrading ? 'SUBMITTED' : 'GRADED',
  };
};
