const formatter = (timeZone, includeTime) => new Intl.DateTimeFormat('en-CA', {
  timeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  ...(includeTime ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : {}),
});

export const toDateTimeLocal = (value, timeZone = 'UTC') => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  try {
    const parts = Object.fromEntries(
      formatter(timeZone, true).formatToParts(date).map(({ type, value: part }) => [type, part]),
    );
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  } catch (error) {
    if (error instanceof RangeError) return '';
    throw error;
  }
};

export const formatIntakeDate = (value) => {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
};

export const formatIntakeStart = (value, timeZone = 'UTC') => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Start date unavailable';
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'long',
      timeStyle: 'short',
      timeZone,
    }).format(date);
  } catch (error) {
    if (error instanceof RangeError) return 'Start date unavailable';
    throw error;
  }
};
