export const assessmentCompletionFilter = {
  OR: [
    { type: 'ASSESSMENT', status: 'PUBLISHED' },
    { type: 'EXAMINATION', status: { in: ['PUBLISHED', 'CLOSED'] } },
  ],
};

export const getScoreableAssessmentIds = (assessments) => assessments
  .filter((assessment) => assessment.type !== 'EXAMINATION' || assessment.resultsReleased)
  .map(({ id }) => id);

export const countExaminationsAwaitingResults = (assessments) => assessments
  .filter((assessment) => assessment.type === 'EXAMINATION' && !assessment.resultsReleased)
  .length;
