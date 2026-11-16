// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import LessonContentRenderer from './LessonContentRenderer.jsx';
import { resourcesAPI } from '../../services/api';

afterEach(cleanup);

describe('LessonContentRenderer', () => {
  it('renders all eight lesson content types in their saved order', () => {
    const blocks = [
      { type: 'rich_text', content: 'Read **the route map**.' },
      { type: 'video', resourceId: 'video-1', caption: 'Route briefing' },
      { type: 'image', resourceId: 'image-1', altText: 'Route map', caption: 'North route' },
      { type: 'document', resourceId: 'document-1', title: 'Travel checklist' },
      { type: 'link', content: 'https://example.com/guide', title: 'External guide' },
      { type: 'exercise', title: 'Practice', content: 'Plan a route.', instructions: 'Use the map.' },
      {
        type: 'knowledge_check',
        content: 'Which choices are safe?',
        options: ['A', 'B', 'C'],
        correctAnswer: ['A', 'C'],
      },
      { type: 'summary', title: 'Key point', content: 'Check the route twice.' },
    ];
    const resources = [
      { id: 'video-1', mimeType: 'video/mp4' },
      { id: 'image-1', mimeType: 'image/png' },
      { id: 'document-1', mimeType: 'application/pdf' },
    ];
    const { container } = render(<LessonContentRenderer content={JSON.stringify(blocks)} resources={resources} />);

    expect(screen.getByText('the route map').tagName).toBe('STRONG');
    expect(container.querySelector('video').getAttribute('src')).toBe(resourcesAPI.downloadUrl('video-1'));
    expect(screen.getByRole('img', { name: 'Route map' }).getAttribute('src')).toBe(resourcesAPI.downloadUrl('image-1'));
    expect(screen.getByRole('link', { name: /Travel checklist/ }).getAttribute('href')).toBe(resourcesAPI.downloadUrl('document-1'));
    const externalGuide = screen.getByRole('link', { name: /External guide/ });
    expect(externalGuide.getAttribute('href')).toBe('https://example.com/guide');
    expect(externalGuide.getAttribute('rel')).toBe('noreferrer');
    expect(screen.getByText('Plan a route.')).toBeTruthy();
    expect(screen.getByText('Key point')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('A'));
    fireEvent.click(screen.getByLabelText('C'));
    fireEvent.click(screen.getByRole('button', { name: 'Check answer' }));
    expect(screen.getByRole('status').textContent).toBe('Correct.');

    const renderedTypes = [...container.querySelectorAll('.lesson-content-blocks > *')];
    expect(renderedTypes).toHaveLength(8);
  });

  it('shows missing resource messages and ignores unknown block structures', () => {
    render(<LessonContentRenderer content={JSON.stringify([
      { type: 'document', resourceId: 'removed-resource', title: 'Old handout' },
      { type: 'link', content: 'javascript:alert(1)', title: 'Unsafe link' },
      { type: 'private_internal_type', content: 'Do not expose block internals' },
    ])} />);

    expect(screen.getByText('This document is no longer available. Contact your Tutor.')).toBeTruthy();
    expect(screen.getByText('This lesson link is unavailable.')).toBeTruthy();
    expect(screen.queryByText('Do not expose block internals')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('replaces broken media with a useful unavailable message', () => {
    render(<LessonContentRenderer content={JSON.stringify([
      { type: 'image', content: 'https://example.com/missing.png', altText: 'Missing map' },
      { type: 'video', content: 'https://example.com/missing.mp4' },
    ])} />);

    fireEvent.error(screen.getByRole('img', { name: 'Missing map' }));
    fireEvent.error(document.querySelector('video'));
    expect(screen.getAllByText('This image could not be loaded. Contact your Tutor.')).toHaveLength(1);
    expect(screen.getAllByText('This video could not be loaded. Contact your Tutor.')).toHaveLength(1);
  });
});
