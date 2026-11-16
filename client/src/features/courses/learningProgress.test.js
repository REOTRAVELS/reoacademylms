import { describe, expect, it } from 'vitest';
import { flattenCourseLessons, getCourseLessonProgress } from './learningProgress.js';

describe('course lesson progress', () => {
  it('flattens lessons in module order', () => {
    expect(flattenCourseLessons([
      { lessons: [{ id: 'lesson-1' }, { id: 'lesson-2' }] },
      { lessons: [{ id: 'lesson-3' }] },
      {},
    ]).map(({ id }) => id)).toEqual(['lesson-1', 'lesson-2', 'lesson-3']);
  });

  it('calculates completed lessons and rounds the percentage', () => {
    expect(getCourseLessonProgress([
      { isCompleted: true },
      { isCompleted: false },
      { isCompleted: true },
    ])).toEqual({ completed: 2, total: 3, percentage: 67 });
  });

  it('returns zero progress for courses without lessons', () => {
    expect(getCourseLessonProgress([])).toEqual({ completed: 0, total: 0, percentage: 0 });
  });
});
