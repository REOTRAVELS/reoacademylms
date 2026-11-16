export const getAssessmentAvailability = (assessment, now = new Date()) => {
  const availableFrom = assessment.availableFrom ? new Date(assessment.availableFrom) : null;
  const availableTo = assessment.availableTo ? new Date(assessment.availableTo) : null;

  if (availableFrom && availableFrom > now) {
    return { available: false, message: `Opens ${availableFrom.toLocaleString()}` };
  }
  if (availableTo && availableTo < now) {
    return { available: false, message: 'Availability window closed' };
  }
  return { available: true, message: 'Available now' };
};
