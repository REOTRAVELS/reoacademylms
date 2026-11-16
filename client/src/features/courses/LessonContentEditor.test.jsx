// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import LessonContentEditor, { lessonContentBlockTypes } from './LessonContentEditor.jsx';

beforeEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

afterEach(cleanup);

describe('LessonContentEditor', () => {
  it('adds editable blocks for all eight supported content types', () => {
    render(<LessonContentEditor content="[]" onSave={vi.fn()} />);
    lessonContentBlockTypes.forEach(({ label }) => {
      expect(screen.getByRole('button', { name: `Add ${label} block` })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: `Add ${label} block` }));
    });
    expect(document.querySelectorAll('.lesson-editor-block')).toHaveLength(8);
    lessonContentBlockTypes.forEach(({ label }) => {
      expect(screen.getByText(label, { selector: 'strong' })).toBeTruthy();
    });
    expect(screen.getByLabelText('Lesson text')).toBeTruthy();
    expect(screen.getByLabelText('Video URL')).toBeTruthy();
    expect(screen.getByLabelText('Image URL')).toBeTruthy();
    expect(screen.getByLabelText('Document URL')).toBeTruthy();
    expect(screen.getByLabelText('Link URL')).toBeTruthy();
    expect(screen.getByLabelText('Exercise prompt')).toBeTruthy();
    expect(screen.getByLabelText('Question')).toBeTruthy();
    expect(screen.getByLabelText('Summary text')).toBeTruthy();
  });

  it('adds and edits content blocks without changing their type', async () => {
    const onSave = vi.fn().mockResolvedValue({});
    render(<LessonContentEditor content="[]" onSave={onSave} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add Rich text block' }));
    fireEvent.change(screen.getByLabelText('Lesson text'), { target: { value: 'Plan the route.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save lesson content' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith([
      { type: 'rich_text', content: 'Plan the route.' },
    ]));
    expect((await screen.findByRole('status')).textContent).toContain('Lesson content saved.');
  });

  it('duplicates blocks independently and persists the actual reordered sequence', async () => {
    const onSave = vi.fn().mockResolvedValue({});
    render(<LessonContentEditor
      content={JSON.stringify([
        { type: 'rich_text', content: 'Original' },
        { type: 'summary', title: 'Key point', content: 'Second block' },
      ])}
      onSave={onSave}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate block 1' }));
    const textAreas = screen.getAllByLabelText('Lesson text');
    fireEvent.change(textAreas[1], { target: { value: 'Independent copy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move block 3 up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save lesson content' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith([
      { type: 'rich_text', content: 'Original' },
      { type: 'summary', title: 'Key point', content: 'Second block' },
      { type: 'rich_text', content: 'Independent copy' },
    ]));
  });

  it('keeps duplicated knowledge checks independently answerable', () => {
    render(<LessonContentEditor
      content={JSON.stringify([{
        id: 'existing-check',
        type: 'knowledge_check',
        content: 'Choose a route.',
        options: ['Direct', 'Scenic'],
        correctAnswer: 'Direct',
      }])}
      onSave={vi.fn()}
    />);
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate block 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview lesson' }));
    const answers = screen.getAllByRole('radio');
    fireEvent.click(answers[0]);
    fireEvent.click(answers[2]);
    expect(answers[0].checked).toBe(true);
    expect(answers[2].checked).toBe(true);
  });

  it('requires confirmation to delete and then saves the removal', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onSave = vi.fn().mockResolvedValue({});
    render(<LessonContentEditor
      content={JSON.stringify([{ type: 'summary', content: 'Keep or remove me.' }])}
      onSave={onSave}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete block 1' }));
    expect(confirm).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save lesson content' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith([]));
  });

  it('validates required block content before calling the API', async () => {
    const onSave = vi.fn();
    render(<LessonContentEditor content="[]" onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Link block' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save lesson content' }));

    expect((await screen.findAllByRole('alert')).map((element) => element.textContent).join(' '))
      .toContain('Add content before saving.');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('validates knowledge-check options and requires a correct option', async () => {
    const onSave = vi.fn();
    render(<LessonContentEditor content="[]" onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Knowledge check block' }));
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'Which route?' } });
    fireEvent.change(screen.getByLabelText('Answer options (one per line)'), {
      target: { value: 'Direct\nScenic' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save lesson content' }));

    expect((await screen.findAllByRole('alert')).map((element) => element.textContent).join(' '))
      .toContain('Select a correct answer from the options.');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('supports cancel and discards unsaved edits after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onSave = vi.fn().mockResolvedValue({});
    const onCancel = vi.fn();
    render(<LessonContentEditor
      content={JSON.stringify([{ type: 'rich_text', content: 'Original text' }])}
      onSave={onSave}
      onCancel={onCancel}
    />);

    fireEvent.change(screen.getByLabelText('Lesson text'), { target: { value: 'Unsaved text' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Save lesson content' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith([
      { type: 'rich_text', content: 'Original text' },
    ]));
  });

  it('warns before browser navigation when content has unsaved changes', () => {
    render(<LessonContentEditor content="[]" onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Summary block' }));
    fireEvent.change(screen.getByLabelText('Summary text'), { target: { value: 'Unsaved.' } });

    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('shows API errors and keeps the unsaved draft available', async () => {
    const onSave = vi.fn().mockRejectedValue({
      response: { data: { message: 'Server rejected this lesson.' } },
    });
    render(<LessonContentEditor
      content={JSON.stringify([{ type: 'summary', content: 'Draft summary' }])}
      onSave={onSave}
    />);
    fireEvent.change(screen.getByLabelText('Summary text'), { target: { value: 'Updated summary' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save lesson content' }));

    expect((await screen.findAllByRole('alert')).map((element) => element.textContent).join(' '))
      .toContain('Server rejected this lesson.');
    expect(screen.getByLabelText('Summary text').value).toBe('Updated summary');
  });

  it('prevents duplicate submissions while the save request is pending', async () => {
    let finishSave;
    const onSave = vi.fn(() => new Promise((resolve) => { finishSave = resolve; }));
    render(<LessonContentEditor
      content={JSON.stringify([{ type: 'summary', content: 'Ready to save.' }])}
      onSave={onSave}
    />);
    fireEvent.change(screen.getByLabelText('Summary text'), { target: { value: 'Updated and ready.' } });
    const saveButton = screen.getByRole('button', { name: 'Save lesson content' });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    expect(onSave).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Saving…' }).disabled).toBe(true);
    finishSave({});
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Lesson content saved.'));
  });

  it('rejects unsafe URLs before saving', async () => {
    const onSave = vi.fn();
    render(<LessonContentEditor
      content={JSON.stringify([{ type: 'link', content: 'javascript:alert(1)' }])}
      onSave={onSave}
    />);
    fireEvent.click(screen.getByRole('button', { name: 'Save lesson content' }));

    expect((await screen.findAllByRole('alert')).map((element) => element.textContent).join(' '))
      .toContain('Use an HTTP(S) URL');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('previews all eight block types with the student renderer', () => {
    render(<LessonContentEditor
      content={JSON.stringify([
        { type: 'rich_text', content: 'A **formatted** paragraph.' },
        { type: 'video', content: 'https://academy.example/video.mp4', caption: 'Route briefing' },
        { type: 'image', content: 'https://academy.example/map.png', altText: 'Travel map', caption: 'Map' },
        { type: 'document', content: 'https://academy.example/guide.pdf', title: 'Travel guide' },
        { type: 'link', content: 'https://academy.example/reference', title: 'Reference link' },
        { type: 'exercise', title: 'Practice', content: 'Draft a route.', instructions: 'Use the map.' },
        {
          type: 'knowledge_check',
          content: 'Which source is current?',
          options: ['Official notice', 'Old forum'],
          correctAnswer: 'Official notice',
        },
        { type: 'summary', title: 'Takeaway', content: 'Check the latest guidance.' },
      ])}
      onSave={vi.fn()}
    />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview lesson' }));

    expect(screen.getByText('formatted')).toBeTruthy();
    expect(screen.getByText('Route briefing')).toBeTruthy();
    expect(screen.getByAltText('Travel map')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Travel guide/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Reference link/ })).toBeTruthy();
    expect(document.querySelector('video')).toBeTruthy();
    expect(screen.getByText('Draft a route.')).toBeTruthy();
    expect(screen.getByText('Which source is current?')).toBeTruthy();
    expect(screen.getByText('Check the latest guidance.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back to editing' })).toBeTruthy();
  });
});
