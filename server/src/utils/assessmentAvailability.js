export const isAssessmentOpen = (assessment, now = new Date()) => (
  (!assessment.availableFrom || assessment.availableFrom <= now)
  && (!assessment.availableTo || assessment.availableTo >= now)
);

export const isAttemptWithinTimeLimit = (attempt, now = new Date()) => (
  !attempt.assessment.timeLimitMin
  || now.getTime() <= attempt.startedAt.getTime() + attempt.assessment.timeLimitMin * 60_000
);
