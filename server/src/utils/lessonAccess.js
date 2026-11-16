export const isStudentLessonAvailable = (lesson, now = new Date()) => {
  const course = lesson?.module?.course;
  if (!lesson?.isPublished || course?.status !== 'PUBLISHED') return false;
  if (course.startDate && new Date(course.startDate) > now) return false;
  if (course.endDate && new Date(course.endDate) < now) return false;
  return course.visibility === 'public' || Boolean(course.programmeId) || Boolean(course.cohorts?.length);
};
