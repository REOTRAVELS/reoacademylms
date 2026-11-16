export const MAX_LIST_LIMIT = 100;
export const MAX_ATTENDANCE_STUDENTS = 200;
export const MAX_ANNOUNCEMENT_TITLE_LENGTH = 160;
export const MAX_ANNOUNCEMENT_BODY_LENGTH = 10000;

export const parseListOptions = (query, defaultLimit = 50) => {
  const rawLimit = query.limit;
  const limit = rawLimit === undefined
    ? defaultLimit
    : typeof rawLimit === 'string' && /^\d+$/.test(rawLimit)
      ? Number(rawLimit)
      : NaN;
  const cursor = query.cursor;

  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) return null;
  if (cursor !== undefined && (
    typeof cursor !== 'string'
    || cursor.trim() !== cursor
    || cursor.length < 1
    || cursor.length > 191
  )) return null;

  return {
    take: limit,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  };
};

export const parseOptionalId = (value) => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.trim() !== value || value.length > 191 || !value) {
    return undefined;
  }
  return value;
};

export const studentNotificationAudienceWhere = ({ programmeId, programOfferingId } = {}) => ({
  audienceStatus: 'CLASSIFIED',
  OR: [
    { isGlobal: true },
    ...(programmeId ? [{ isGlobal: false, programmeId, programOfferingId: null }] : []),
    ...(programmeId && programOfferingId
      ? [{ isGlobal: false, programmeId, programOfferingId }]
      : []),
  ],
});

export const parseAttendanceDate = (value, now = new Date()) => {
  if (typeof value !== 'string' || value.length > 40) return null;

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const isoDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value);
  if (!dateOnly && !isoDateTime) return null;

  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarDate.getUTCFullYear() !== year
    || calendarDate.getUTCMonth() !== month - 1
    || calendarDate.getUTCDate() !== day
  ) return null;

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) return null;

  const date = new Date(Date.UTC(
    parsedDate.getUTCFullYear(),
    parsedDate.getUTCMonth(),
    parsedDate.getUTCDate(),
  ));
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return date <= today ? date : null;
};

export const normalizeStudentIds = (studentIds) => {
  if (
    !Array.isArray(studentIds)
    || studentIds.length === 0
    || studentIds.length > MAX_ATTENDANCE_STUDENTS
    || studentIds.some((id) => typeof id !== 'string' || !id.trim() || id.trim() !== id || id.length > 191)
  ) return null;
  return [...new Set(studentIds)];
};

export const normalizeAttendanceRecords = (records, studentIds, present) => {
  if (records === undefined) {
    const ids = normalizeStudentIds(studentIds);
    if (!ids || (present !== undefined && typeof present !== 'boolean')) return null;
    return ids.map((studentId) => ({ studentId, present: present !== false }));
  }
  if (
    !Array.isArray(records)
    || records.length === 0
    || records.length > MAX_ATTENDANCE_STUDENTS
    || records.some((record) => !record
      || typeof record !== 'object'
      || typeof record.studentId !== 'string'
      || !record.studentId.trim()
      || record.studentId.trim() !== record.studentId
      || record.studentId.length > 191
      || typeof record.present !== 'boolean')
  ) return null;
  const uniqueIds = new Set(records.map(({ studentId }) => studentId));
  if (uniqueIds.size !== records.length) return null;
  return records;
};

export const announcementAudienceFilter = ({ programmeId, cohortId, courseId }) => {
  if (courseId) return { cohort: { courses: { some: { courseId, course: { status: 'PUBLISHED' } } } } };
  if (cohortId) return { cohortId };
  if (programmeId) return { cohort: { programmeId } };
  return null;
};

export const restrictProgrammeAudienceToCohorts = (audience, cohortIds) => ({
  ...audience,
  cohort: { ...audience.cohort, id: { in: cohortIds } },
});
