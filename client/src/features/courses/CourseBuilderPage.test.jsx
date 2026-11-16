// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { coursesAPI, resourcesAPI } = vi.hoisted(() => ({
  coursesAPI: {
    builder: vi.fn(),
    quality: vi.fn(),
    update: vi.fn(),
    publish: vi.fn(),
  },
  resourcesAPI: {
    upload: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    downloadUrl: vi.fn((id) => `/api/resources/${id}/download`),
  },
}));

vi.mock('../../services/api', () => ({
  assessmentsAPI: {},
  cohortsAPI: { list: vi.fn() },
  coursesAPI,
  resourcesAPI,
  usersAPI: { list: vi.fn() },
}));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'trainer-1', role: 'TRAINER' } }),
}));

import CourseBuilderPage from './CourseBuilderPage.jsx';

const resource = {
  id: 'resource-1',
  courseId: 'course-1',
  lessonId: null,
  originalName: 'travel-guide.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 1200,
};

const course = () => ({
  id: 'course-1',
  title: 'Travel Operations',
  description: 'Learn travel planning.',
  category: 'Travel',
  difficulty: 'Beginner',
  status: 'DRAFT',
  completionRequirements: '{}',
  visibility: 'public',
  learningObjectives: '["Plan a route"]',
  learningOutcomes: '["Build an itinerary"]',
  targetAudience: 'Travel students',
  modules: [],
  trainers: [{ trainerId: 'trainer-1', trainer: { id: 'trainer-1', status: 'ACTIVE' } }],
  cohorts: [],
  resources: [resource],
  assessments: [],
});

const renderBuilder = () => render(
  <MemoryRouter initialEntries={['/courses/course-1/builder']}>
    <Routes>
      <Route path="/courses/:id/builder" element={<CourseBuilderPage />} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  coursesAPI.builder.mockResolvedValue({ data: { data: course() } });
  coursesAPI.quality.mockResolvedValue({
    data: { data: { valid: false, errors: [], recommendations: [], summary: { lessonCount: 0, moduleCount: 0, readyAssessmentCount: 0 } } },
  });
  resourcesAPI.update.mockResolvedValue({ data: { data: { ...resource, originalName: 'Updated guide.pdf' } } });
  resourcesAPI.upload.mockResolvedValue({
    data: { data: { ...resource, id: 'resource-2', originalName: 'new-guide.pdf' } },
  });
  resourcesAPI.delete.mockResolvedValue({ data: { data: null } });
  coursesAPI.update.mockResolvedValue({ data: { data: course() } });
  coursesAPI.publish.mockResolvedValue({ data: { data: { course: { ...course(), status: 'PUBLISHED' } } } });
});

describe('CourseBuilderPage', () => {
  it('exposes seven steps and persists resource metadata through the resource API', async () => {
    renderBuilder();
    await screen.findByRole('heading', { name: 'Travel Operations' });

    for (const step of [
      'Course identity',
      'Learning outcomes',
      'Course structure',
      'Lesson content',
      'Course resources',
      'Course settings',
      'Review & publish',
    ]) {
      expect(screen.getByRole('button', { name: new RegExp(step) })).toBeTruthy();
    }

    fireEvent.click(screen.getByRole('button', { name: /Course resources/ }));
    expect(await screen.findByText('travel-guide.pdf')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit name' }));
    fireEvent.change(screen.getByLabelText('Resource name for travel-guide.pdf'), {
      target: { value: 'Updated guide.pdf' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));

    await waitFor(() => expect(resourcesAPI.update).toHaveBeenCalledWith(
      'resource-1',
      { originalName: 'Updated guide.pdf' },
    ));
    expect(await screen.findByText('Updated guide.pdf')).toBeTruthy();
  });

  it('keeps invalid course information in the form and does not send it to the API', async () => {
    renderBuilder();
    await screen.findByRole('heading', { name: 'Travel Operations' });
    fireEvent.change(screen.getByLabelText(/Course title/), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save identity' }));

    expect((await screen.findByRole('alert')).textContent).toContain('between 3 and 120 characters');
    expect(screen.getByLabelText(/Course title/).value).toBe('x');
    expect(coursesAPI.update).not.toHaveBeenCalled();
  });

  it('preserves the resource name draft when the server rejects an update', async () => {
    resourcesAPI.update.mockRejectedValue({
      response: { data: { message: 'Resource update rejected.' } },
    });
    renderBuilder();
    await screen.findByRole('heading', { name: 'Travel Operations' });
    fireEvent.click(screen.getByRole('button', { name: /Course resources/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit name' }));
    fireEvent.change(screen.getByLabelText('Resource name for travel-guide.pdf'), {
      target: { value: 'Draft name.pdf' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Resource update rejected.');
    expect(screen.getByLabelText('Resource name for travel-guide.pdf').value).toBe('Draft name.pdf');
  });

  it('uploads and removes course resources only after server confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { container } = renderBuilder();
    await screen.findByRole('heading', { name: 'Travel Operations' });
    fireEvent.click(screen.getByRole('button', { name: /Course resources/ }));
    await screen.findByRole('heading', { name: 'Course resources', level: 3 });

    const file = new File(['%PDF-1.7'], 'new-guide.pdf', { type: 'application/pdf' });
    const fileInput = container.querySelector('input[type="file"]');
    fireEvent.change(fileInput, { target: { files: [file] } });
    fireEvent.submit(fileInput.closest('form'));
    await waitFor(() => expect(resourcesAPI.upload).toHaveBeenCalledOnce());
    const uploadForm = resourcesAPI.upload.mock.calls[0][0];
    expect(uploadForm.get('courseId')).toBe('course-1');
    expect(await screen.findByText('new-guide.pdf')).toBeTruthy();

    const uploadedResource = screen.getByText('new-guide.pdf').closest('li');
    fireEvent.click(within(uploadedResource).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(resourcesAPI.delete).toHaveBeenCalledWith('resource-2'));
    expect(screen.queryByText('new-guide.pdf')).toBeNull();
  });

  it('validates learning outcomes before sending an update', async () => {
    renderBuilder();
    await screen.findByRole('heading', { name: 'Travel Operations' });
    fireEvent.click(screen.getByRole('button', { name: /Learning outcomes/ }));
    await screen.findByRole('heading', { name: 'Learning outcomes' });
    coursesAPI.update.mockClear();
    fireEvent.change(screen.getByRole('textbox', { name: /Skills and measurable outcomes/ }), { target: { value: '  \n  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save learning outcomes' }));

    expect((await screen.findByRole('alert')).textContent).toContain('one measurable outcome');
    expect(coursesAPI.update).not.toHaveBeenCalled();
  });

  it('shows non-blocking warnings in Review and allows publication', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const warning = {
      severity: 'WARNING',
      code: 'missing_category',
      message: 'Add a course category to help learners understand the subject.',
      entityType: 'Course',
      entityId: 'course-1',
      step: 1,
      guidance: 'Choose a relevant category in Course identity.',
    };
    coursesAPI.quality.mockResolvedValue({
      data: { data: {
        valid: true,
        issues: [warning],
        errors: [],
        warnings: [warning],
        info: [],
        recommendations: [warning],
        summary: { lessonCount: 0, moduleCount: 0, readyAssessmentCount: 0 },
      } },
    });

    renderBuilder();
    await screen.findByRole('heading', { name: 'Travel Operations' });
    fireEvent.click(screen.getByRole('button', { name: /Review & publish/ }));
    expect(await screen.findByText('Ready to publish with warnings')).toBeTruthy();
    expect(screen.getByText('Warning')).toBeTruthy();
    expect(screen.getByText(warning.guidance)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Publish course' }).disabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Publish course' }));
    await waitFor(() => expect(coursesAPI.publish).toHaveBeenCalledWith('course-1'));
  });
});
