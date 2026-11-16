const monthsBySeason = {
  WINTER: [1, 2, 3],
  SPRING: [4, 5, 6],
  SUMMER: [7, 8, 9],
  FALL: [10, 11, 12],
};

const dateLabels = {
  admissionStartDate: 'Admission start',
  admissionEndDate: 'Admission end',
  academicStartDate: 'Academic start',
  academicEndDate: 'Academic end',
};

export const validateIntakePeriod = ({ season, year, ...dates }) => {
  const months = monthsBySeason[season];
  if (!months) return 'Choose a valid GATE season.';

  for (const [field, label] of Object.entries(dateLabels)) {
    const value = dates[field];
    const pattern = field === 'academicStartDate'
      ? /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}))?$/
      : /^(\d{4}-\d{2}-\d{2})$/;
    const match = pattern.exec(value || '');
    if (!match) return `${label} must be a valid ${field === 'academicStartDate' ? 'date and time' : 'date'}.`;
    const [dateYear, dateMonth, dateDay] = match[1].split('-').map(Number);
    const date = new Date(Date.UTC(dateYear, dateMonth - 1, dateDay));
    if (
      date.getUTCFullYear() !== dateYear
      || date.getUTCMonth() + 1 !== dateMonth
      || date.getUTCDate() !== dateDay
      || (match[2] !== undefined && (Number(match[2]) > 23 || Number(match[3]) > 59))
    ) return `${label} must be a valid ${field === 'academicStartDate' ? 'date and time' : 'date'}.`;
    if (dateYear !== Number(year) || !months.includes(dateMonth)) {
      return `${label} must fall within the selected GATE period and year.`;
    }
  }
  return '';
};
