export const hasCompletedCourseRequirements = ({
  lessonCount,
  completedLessonCount,
  assessmentCount,
  submittedAssessmentCount,
  minimumLessonCompletionPercent = 100,
  requireAssessment = true,
}) => (
  lessonCount > 0
  && (requireAssessment ? assessmentCount > 0 : true)
  && (completedLessonCount / lessonCount) * 100 >= minimumLessonCompletionPercent
  && (!requireAssessment || submittedAssessmentCount === assessmentCount)
);
