// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import StudentCoursePlayer from './StudentCoursePlayer.jsx';

const course = {
  id: 'course-1',
  title: 'Travel Operations',
  description: 'Learn to plan journeys.',
  estimatedDuration: '4 hours',
  learningOutcomes: JSON.stringify(['Plan itineraries', 'Support travelers']),
  programme: { title: 'Travel Services' },
  trainers: [{ trainer: { id: 'tutor-1', firstName: 'Ada', lastName: 'Tutor', email: 'ada@example.test' } }],
  resources: [{ id: 'resource-1', originalName: 'route-guide.pdf', mimeType: 'application/pdf', lessonId: null }],
  modules: [{
    id: 'module-1',
    title: 'Planning',
    description: 'Start with the journey.',
    lessons: [
      { id: 'lesson-1', title: 'Route basics', type: 'TEXT', isPublished: true, isCompleted: true, content: '[]' },
      { id: 'lesson-2', title: 'Build an itinerary', type: 'TEXT', isPublished: true, isCompleted: false, content: '[]' },
    ],
  }],
};

const renderPlayer = (props) => render(
  <MemoryRouter><StudentCoursePlayer course={course} {...props} /></MemoryRouter>,
);

afterEach(cleanup);

describe('StudentCoursePlayer', () => {
  it('shows course overview details and resumes the most recently accessed lesson', () => {
    const onOpenLesson = vi.fn();
    renderPlayer({
      selectedLesson: null,
      studentProgress: [{
        lessonId: 'lesson-1',
        lesson: { module: { course: { id: 'course-1' } } },
      }],
      onOpenLesson,
    });

    expect(screen.getByRole('heading', { name: 'Travel Operations' })).toBeTruthy();
    expect(screen.getByText('Travel Services')).toBeTruthy();
    expect(screen.getByText('4 hours')).toBeTruthy();
    expect(screen.getByText('Plan itineraries')).toBeTruthy();
    expect(screen.getAllByText('Ada Tutor')).toHaveLength(2);
    expect(screen.getByTitle('route-guide.pdf')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /route-guide\.pdf/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Continue learning' }));
    expect(onOpenLesson).toHaveBeenCalledWith(course.modules[0].lessons[0]);
  });

  it('shows course videos in an in-platform player without a download link', () => {
    const courseWithVideo = {
      ...course,
      resources: [
        ...course.resources,
        { id: 'video-1', originalName: 'route-briefing.mp4', mimeType: 'video/mp4', lessonId: null },
      ],
    };
    const { container } = renderPlayer({ course: courseWithVideo, selectedLesson: null });
    const video = container.querySelector('video');

    expect(video).toBeTruthy();
    expect(video.getAttribute('src')).toBe('/api/resources/video-1/download');
    expect(video.getAttribute('controlslist')).toBe('nodownload');
    expect(screen.queryByRole('link', { name: /route-briefing\.mp4/ })).toBeNull();
  });

  it('navigates lessons, exposes completion state, and retries failed resume writes', () => {
    const onOpenLesson = vi.fn();
    const onCompleteLesson = vi.fn();
    const onRetryAccess = vi.fn();
    renderPlayer({
      selectedLesson: {
        ...course.modules[0].lessons[0],
        isCompleted: false,
        module: { title: 'Planning' },
        progress: { completed: false },
      },
      studentProgress: [],
      onOpenLesson,
      onCompleteLesson,
      completingLesson: false,
      accessError: 'Could not save your place.',
      accessSaving: false,
      onRetryAccess,
    });

    expect(screen.getByRole('heading', { name: 'Route basics' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Previous lesson' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Next lesson/ }));
    expect(onOpenLesson).toHaveBeenCalledWith(course.modules[0].lessons[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Mark lesson complete' }));
    expect(onCompleteLesson).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetryAccess).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Course lessons' }));
    expect(screen.getByRole('button', { name: /Route basics/ }).getAttribute('aria-current')).toBe('page');
  });

  it('shows a loading state while the requested lesson is being fetched', () => {
    renderPlayer({ selectedLesson: null, lessonLoading: true });
    expect(screen.getByRole('status').textContent).toContain('Opening lesson');
  });

  it('lets students retry a lesson request that failed', () => {
    const onRetryLesson = vi.fn();
    renderPlayer({
      selectedLesson: null,
      lessonLoadError: 'The lesson could not be loaded.',
      onRetryLesson,
    });

    expect(screen.getByRole('alert').textContent).toContain('could not be loaded');
    fireEvent.click(screen.getByRole('button', { name: 'Retry opening lesson' }));
    expect(onRetryLesson).toHaveBeenCalledOnce();
  });
});
