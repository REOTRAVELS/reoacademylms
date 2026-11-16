export const getAttendanceSummary = (enrolments, attendanceDraft) => {
  const total = enrolments.length;
  const present = enrolments.filter(({ studentId }) => attendanceDraft[studentId] !== false).length;
  return { total, present, absent: total - present };
};
