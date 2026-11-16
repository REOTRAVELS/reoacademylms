export const flattenCourseLessons = (modules = []) => (
  modules.flatMap((module) => module.lessons || [])
);

export const getCourseLessonProgress = (lessons) => {
  const completed = lessons.filter((lesson) => lesson.isCompleted).length;
  return {
    completed,
    total: lessons.length,
    percentage: lessons.length ? Math.round((completed / lessons.length) * 100) : 0,
  };
};
