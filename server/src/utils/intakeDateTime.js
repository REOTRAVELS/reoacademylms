const formatters = new Map();
const minute = 60 * 1000;

const getFormatter = (timeZone) => {
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }));
  }
  return formatters.get(timeZone);
};

const partsInTimezone = (date, timeZone) => {
  const parts = Object.fromEntries(
    getFormatter(timeZone).formatToParts(date).map(({ type, value }) => [type, value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
};

const sameLocalMinute = (parts, expected) => (
  parts.year === expected.year
  && parts.month === expected.month
  && parts.day === expected.day
  && parts.hour === expected.hour
  && parts.minute === expected.minute
  && parts.second === 0
);

export const localDateInTimezone = (date, timeZone) => {
  const { year, month, day } = partsInTimezone(date, timeZone);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

export const localDateTimeInputInTimezone = (date, timeZone) => {
  const { year, month, day, hour, minute: localMinute } = partsInTimezone(date, timeZone);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(localMinute).padStart(2, '0')}`;
};

export const parseLocalDateTimeInTimezone = (value, timeZone) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(value);
  if (!match) return { error: 'invalid' };
  const expected = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4] || 0),
    minute: Number(match[5] || 0),
  };
  if (expected.hour > 23 || expected.minute > 59) return { error: 'invalid' };
  const localEpoch = Date.UTC(
    expected.year,
    expected.month - 1,
    expected.day,
    expected.hour,
    expected.minute,
  );
  const checkDate = new Date(localEpoch);
  if (
    checkDate.getUTCFullYear() !== expected.year
    || checkDate.getUTCMonth() + 1 !== expected.month
    || checkDate.getUTCDate() !== expected.day
  ) return { error: 'invalid' };

  const offsets = new Set();
  for (let hours = -36; hours <= 36; hours += 6) {
    const sample = new Date(localEpoch + hours * 60 * minute);
    const parts = partsInTimezone(sample, timeZone);
    const representedAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    offsets.add(representedAsUtc - Math.floor(sample.getTime() / 1000) * 1000);
  }

  const candidates = [...offsets]
    .map((offset) => new Date(localEpoch - offset))
    .filter((candidate) => sameLocalMinute(partsInTimezone(candidate, timeZone), expected))
    .sort((left, right) => left - right);
  if (candidates.length !== 1) {
    return { error: candidates.length ? 'ambiguous' : 'invalid' };
  }
  return { date: candidates[0] };
};

export const parseIntakeStartDateTime = (value, timeZone) => {
  if (typeof value !== 'string') return { error: 'invalid' };
  if (/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/.test(value)) {
    return parseLocalDateTimeInTimezone(value, timeZone);
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return { error: 'invalid' };
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minuteValue = Number(minuteText);
  const second = Number(secondText || 0);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarDate.getUTCFullYear() !== year
    || calendarDate.getUTCMonth() + 1 !== month
    || calendarDate.getUTCDate() !== day
    || hour > 23
    || minuteValue > 59
    || second > 59
    || (offsetHourText && (Number(offsetHourText) > 23 || Number(offsetMinuteText) > 59))
  ) return { error: 'invalid' };
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? { error: 'invalid' } : { date };
};
