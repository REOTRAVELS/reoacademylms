export const getSubmissionAction = (existingSubmission) => {
  if (!existingSubmission) return 'create';
  return existingSubmission.grade ? 'reject' : 'update';
};

export const hideUnreleasedGrades = (submissions) => submissions.map((submission) => {
  if (!submission.grade) return { ...submission, canResubmit: true };
  if (submission.grade.released) return { ...submission, canResubmit: false };
  return { ...submission, grade: null, status: 'SUBMITTED', canResubmit: false };
});
