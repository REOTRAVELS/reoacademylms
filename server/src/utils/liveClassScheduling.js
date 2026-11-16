const asSet = (items, key) => new Set((items || []).map((item) => item[key]));

const intersects = (left, right) => [...left].some((value) => right.has(value));

const classTrainerIds = (liveClass) => new Set([
  ...(liveClass.course?.trainers || []).map(({ trainerId }) => trainerId),
  ...(liveClass.cohort?.trainers || []).map(({ trainerId }) => trainerId),
  ...(liveClass.createdBy?.role?.name === 'TRAINER' ? [liveClass.createdById] : []),
]);

export const findLiveClassConflicts = (candidate, existingClasses, excludedClassId) => {
  const start = new Date(candidate.startsAt).getTime();
  const end = start + candidate.durationMins * 60_000;
  const candidateTrainers = new Set(candidate.trainerIds || []);
  const candidateStudents = new Set(candidate.studentIds || []);

  return existingClasses.flatMap((liveClass) => {
    if (liveClass.id === excludedClassId || liveClass.status === 'CANCELLED') return [];
    const existingStart = new Date(liveClass.startsAt).getTime();
    const existingEnd = existingStart + liveClass.durationMins * 60_000;
    if (start >= existingEnd || existingStart >= end) return [];

    const reasons = [];
    if (candidate.cohortId === liveClass.cohortId) reasons.push('cohort');
    if (intersects(candidateTrainers, classTrainerIds(liveClass))) reasons.push('trainer');
    if (intersects(candidateStudents, asSet(liveClass.cohort?.enrolments, 'studentId'))) {
      reasons.push('student');
    }

    return reasons.length ? [{ id: liveClass.id, title: liveClass.title, reasons }] : [];
  });
};

export const getLiveClassConflictSearchRange = (startsAt, durationMins) => {
  const start = new Date(startsAt);
  const end = new Date(start.getTime() + durationMins * 60_000);
  return {
    gte: new Date(start.getTime() - 8 * 60 * 60_000),
    lt: end,
  };
};

export const getLiveClassJoinWindowStart = (startsAt) => new Date(new Date(startsAt).getTime() - 40 * 60_000);

export const LIVEKIT_JOIN_TOKEN_TTL_SECONDS = 5 * 60;
export const getJoinTokenTtlSeconds = () => LIVEKIT_JOIN_TOKEN_TTL_SECONDS;

export const isLiveClassJoinable = (liveClass, now = new Date()) => {
  if (!liveClass) return false;
  if (liveClass.status === 'CANCELLED' || liveClass.status === 'ENDED') return false;
  if (liveClass.status === 'LIVE') return true;
  if (!liveClass.startsAt) return false;

  const start = new Date(liveClass.startsAt);
  const classEnd = new Date(start.getTime() + Number(liveClass.durationMins || 60) * 60_000);
  const joinWindowStart = getLiveClassJoinWindowStart(start);
  const current = new Date(now);
  return current >= joinWindowStart && current < classEnd;
};

export const parseCohortSchedule = (scheduleText) => {
  if (typeof scheduleText !== 'string' || !scheduleText.trim()) {
    return { days: [], startMinutes: null, durationMins: 60 };
  }

  const text = scheduleText.trim();
  const lower = text.toLowerCase();
  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const dayMatches = [...lower.matchAll(/mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?/g)];
  const days = [...new Set(dayMatches.map((match) => dayNames.indexOf(match[0].slice(0, 3))))].filter((value) => value >= 0).sort((a, b) => a - b);

  if (!days.length) {
    return { days: [], startMinutes: null, durationMins: 60 };
  }

  const rangeMatch = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|to|–)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  const singleTimeMatch = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);

  let startMinutes = null;
  let durationMins = 60;

  const toMinutes = (hour, minute = '0', meridiem = '') => {
    let total = Number(hour) % 12;
    if (meridiem) {
      if (meridiem.toLowerCase() === 'pm' && Number(hour) !== 12) total += 12;
      if (meridiem.toLowerCase() === 'am' && Number(hour) === 12) total = 0;
    }
    return total * 60 + Number(minute || 0);
  };

  if (rangeMatch) {
    const [, startHour, startMinute, startMeridiem, endHour, endMinute, endMeridiem] = rangeMatch;
    startMinutes = toMinutes(startHour, startMinute || '0', startMeridiem);
    const endMinutes = toMinutes(endHour, endMinute || '0', endMeridiem);
    durationMins = Math.max(15, endMinutes - startMinutes);
  } else if (singleTimeMatch) {
    const [, hour, minute, meridiem] = singleTimeMatch;
    startMinutes = toMinutes(hour, minute || '0', meridiem);
  }

  return { days, startMinutes, durationMins };
};

export const generateRecurringClassDates = ({ schedule, startDate, endDate, now = new Date() }) => {
  if (typeof schedule !== 'string' || !schedule.trim()) return [];

  const parsed = parseCohortSchedule(schedule);
  if (!parsed.days.length || parsed.startMinutes === null) return [];

  const rangeStart = startDate ? new Date(startDate) : new Date(now);
  const rangeEnd = endDate ? new Date(endDate) : new Date(rangeStart.getTime() + 12 * 7 * 24 * 60 * 60_000);
  const cursor = new Date(rangeStart);
  cursor.setUTCHours(0, 0, 0, 0);

  const result = [];
  while (cursor <= rangeEnd) {
    if (parsed.days.includes(cursor.getUTCDay())) {
      const candidate = new Date(cursor);
      candidate.setUTCHours(Math.floor(parsed.startMinutes / 60), parsed.startMinutes % 60, 0, 0);
      if (candidate >= rangeStart && candidate <= rangeEnd) {
        result.push(candidate);
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return result;
};

export const formatLiveClassIcs = (liveClass) => {
  const escape = (value = '') => String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
  const formatDate = (date) => new Date(date)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const start = new Date(liveClass.startsAt);
  const end = new Date(start.getTime() + liveClass.durationMins * 60_000);

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//REO Travel Academy//Live Classes//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${escape(liveClass.id)}@reoacademy`,
    `DTSTAMP:${formatDate(new Date())}`,
    `DTSTART:${formatDate(start)}`,
    `DTEND:${formatDate(end)}`,
    `SUMMARY:${escape(liveClass.title)}`,
    `DESCRIPTION:${escape(liveClass.description || '')}`,
    `STATUS:${liveClass.status === 'CANCELLED' ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
};
