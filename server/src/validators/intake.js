import {
  localDateInTimezone,
  parseIntakeStartDateTime,
} from '../utils/intakeDateTime.js';

const seasonsByGate = {
  1: 'WINTER',
  2: 'SPRING',
  3: 'SUMMER',
  4: 'FALL',
};

const monthsBySeason = {
  WINTER: [1, 2, 3],
  SPRING: [4, 5, 6],
  SUMMER: [7, 8, 9],
  FALL: [10, 11, 12],
};

const intakeStatuses = new Set(['UPCOMING', 'ACTIVE', 'COMPLETED', 'ARCHIVED']);
const intakeSeasons = new Set(Object.values(seasonsByGate));
const dateFields = [
  'academicStartDate',
  'academicEndDate',
];
const dateOnlyFields = ['academicEndDate'];

const parseDateOnly = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
};

export const validateIntake = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'An intake object is required.' };
  }

  const allowedFields = new Set([
    'gateNumber',
    'season',
    'year',
    ...dateFields,
    'timezone',
    'admissionsOpen',
    'status',
  ]);
  if (Object.keys(input).some((field) => !allowedFields.has(field))) {
    return { error: 'The request contains an unsupported intake field.' };
  }

  const data = { ...input };
  for (const field of ['gateNumber', 'season', 'year', ...dateFields]) {
    if (data[field] === undefined) return { error: `${field} is required.` };
  }

  if (data.gateNumber !== undefined &&
      (!Number.isInteger(data.gateNumber) || data.gateNumber < 1 || data.gateNumber > 4)) {
    return { error: 'Gate number must be an integer from 1 to 4.' };
  }
  if (data.season !== undefined && !intakeSeasons.has(data.season)) {
    return { error: 'Season must be Winter, Spring, Summer, or Fall.' };
  }
  if (data.gateNumber !== undefined && data.season !== undefined &&
      seasonsByGate[data.gateNumber] !== data.season) {
    return { error: 'The gate number does not match the selected season.' };
  }
  if (data.year !== undefined &&
      (!Number.isInteger(data.year) || data.year < 2000 || data.year > 9999)) {
    return { error: 'Year must be an integer between 2000 and 9999.' };
  }
  if (data.timezone !== undefined) {
    if (typeof data.timezone !== 'string' || data.timezone.trim().length === 0 || data.timezone.length > 100) {
      return { error: 'Timezone must be a valid IANA timezone.' };
    }
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: data.timezone.trim() }).format();
    } catch (error) {
      if (error instanceof RangeError) return { error: 'Timezone must be a valid IANA timezone.' };
      throw error;
    }
    data.timezone = data.timezone.trim();
  }
  const timeZone = data.timezone || 'UTC';

  for (const field of dateOnlyFields) {
    const parsedDate = parseDateOnly(data[field]);
    if (!parsedDate) return { error: `${field} must be a valid YYYY-MM-DD date.` };
    data[field] = parsedDate;
  }
  const parsedStart = parseIntakeStartDateTime(data.academicStartDate, timeZone);
  if (parsedStart.error === 'ambiguous') {
    return { error: 'Academic start is ambiguous in this timezone; choose a different local time.' };
  }
  if (!parsedStart.date) {
    return { error: 'Academic start must be a valid local date and time in the selected timezone.' };
  }
  data.academicStartDate = parsedStart.date;

  const academicStartLocalDate = localDateInTimezone(data.academicStartDate, timeZone);
  const academicEndDate = data.academicEndDate.toISOString().slice(0, 10);
  if (academicStartLocalDate >= academicEndDate) {
    return { error: 'Academic end date must be after the academic start date.' };
  }
  if (data.season && data.year) {
    for (const field of dateFields) {
      const localDate = field === 'academicStartDate'
        ? academicStartLocalDate
        : data[field].toISOString().slice(0, 10);
      const [year, month] = localDate.split('-').map(Number);
      if (year !== data.year || !monthsBySeason[data.season].includes(month)) {
        return { error: `${field} falls outside the selected GATE period.` };
      }
    }
  }
  if (data.admissionsOpen !== undefined && typeof data.admissionsOpen !== 'boolean') {
    return { error: 'Admissions open must be true or false.' };
  }
  if (data.status !== undefined && !intakeStatuses.has(data.status)) {
    return { error: 'Status must be Upcoming, Active, Completed, or Archived.' };
  }
  if ((data.status === 'ARCHIVED' || data.status === 'COMPLETED') && data.admissionsOpen) {
    return { error: 'Completed or archived intakes cannot accept applications.' };
  }

  return { data };
};

export const intakeDateFields = dateFields;
