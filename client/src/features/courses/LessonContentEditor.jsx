import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown, ArrowUp, CircleHelp, Dumbbell, FileText, Image, Link2,
  ListChecks, Play, Plus, Copy, Save, Trash2, Type, Eye, Pencil,
} from 'lucide-react';
import { Button } from '../../components/common/Button';
import { Input, Select, Textarea } from '../../components/forms/Input';
import LessonContentRenderer from './LessonContentRenderer.jsx';

export const lessonContentBlockTypes = [
  { type: 'rich_text', label: 'Rich text', Icon: Type },
  { type: 'video', label: 'Video', Icon: Play },
  { type: 'image', label: 'Image', Icon: Image },
  { type: 'document', label: 'Document', Icon: FileText },
  { type: 'link', label: 'Link', Icon: Link2 },
  { type: 'exercise', label: 'Exercise', Icon: Dumbbell },
  { type: 'knowledge_check', label: 'Knowledge check', Icon: CircleHelp },
  { type: 'summary', label: 'Summary', Icon: ListChecks },
];

export const parseLessonContentBlocks = (content) => {
  if (Array.isArray(content)) return content;
  if (typeof content !== 'string' || !content.trim()) return [];
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed;
    return [{ type: 'rich_text', content }];
  } catch {
    return [{ type: 'rich_text', content }];
  }
};

const makeBlock = (type) => ({
  type,
  content: '',
  ...(type === 'image' ? { altText: '', caption: '' } : {}),
  ...(type === 'video' ? { caption: '' } : {}),
  ...(type === 'document' || type === 'link' || type === 'exercise' || type === 'summary' ? { title: '' } : {}),
  ...(type === 'exercise' ? { instructions: '' } : {}),
  ...(type === 'knowledge_check' ? { options: ['', ''], correctAnswer: '', explanation: '' } : {}),
});

const isNonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;
const isHttpUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
};

export const validateLessonContentBlocks = (blocks, resources = []) => {
  const resourceIds = new Set(resources.map(({ id }) => id));
  const errors = [];
  blocks.forEach((block, index) => {
    const prefix = `Block ${index + 1}`;
    if (!block || typeof block !== 'object' || Array.isArray(block)
      || !lessonContentBlockTypes.some(({ type }) => type === block.type)) {
      errors.push({ index, message: `${prefix}: Choose a supported content type.` });
      return;
    }

    const canUseResource = ['video', 'image', 'document'].includes(block.type)
      && resourceIds.has(block.resourceId);
    if (!isNonEmpty(block.content) && !canUseResource) {
      errors.push({ index, message: `${prefix}: Add content before saving.` });
      return;
    }

    if (['video', 'image', 'document', 'link'].includes(block.type)
      && !canUseResource && !isHttpUrl(block.content)) {
      errors.push({ index, message: `${prefix}: Use an HTTP(S) URL or select a course resource.` });
    }

    if (block.type === 'knowledge_check') {
      const options = Array.isArray(block.options) ? block.options.filter(isNonEmpty) : [];
      if (options.length < 2) {
        errors.push({ index, message: `${prefix}: Add at least two answer options.` });
      } else {
        const answers = Array.isArray(block.correctAnswer)
          ? block.correctAnswer
          : [block.correctAnswer];
        if (!answers.length || answers.some((answer) => !options.includes(answer))) {
          errors.push({ index, message: `${prefix}: Select a correct answer from the options.` });
        }
      }
    }
  });
  return errors;
};

function RichTextEditor({ value, onChange }) {
  const editorRef = useRef(null);
  const insertMarkdown = (before, after = '') => {
    const textarea = editorRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.slice(start, end) || 'text';
    const updated = `${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`;
    onChange(updated);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + before.length, end + before.length);
    });
  };
  return <>
    <div className="rich-text-toolbar" role="toolbar" aria-label="Text formatting">
      <button type="button" onClick={() => insertMarkdown('**', '**')} aria-label="Bold">Bold</button>
      <button type="button" onClick={() => insertMarkdown('*', '*')} aria-label="Italic">Italic</button>
      <button type="button" onClick={() => insertMarkdown('\n- ')} aria-label="Add bullet">Bulleted list</button>
    </div>
    <Textarea label="Lesson text" value={value || ''} onChange={onChange} rows="8" placeholder="Write the lesson content." />
  </>;
}

function ContentBlockFields({ block, resources, onChange }) {
  const set = (key, value) => onChange({
    ...block,
    [key]: value,
    ...(key === 'content' && value ? { resourceId: undefined } : {}),
  });
  const resourceOptions = resources.map((resource) => ({
    value: resource.id,
    label: `${resource.originalName}${resource.mimeType ? ` · ${resource.mimeType}` : ''}`,
  }));
  const isMedia = ['video', 'image', 'document'].includes(block.type);
  const contentLabel = {
    video: 'Video URL',
    image: 'Image URL',
    document: 'Document URL',
    link: 'Link URL',
    exercise: 'Exercise prompt',
    knowledge_check: 'Question',
    summary: 'Summary text',
  }[block.type] || 'Content';

  return <>
    {block.type === 'rich_text'
      ? <RichTextEditor value={block.content || ''} onChange={(value) => set('content', value)} />
      : <Textarea
        label={contentLabel}
        value={block.content || ''}
        onChange={(value) => set('content', value)}
        rows={['exercise', 'knowledge_check', 'summary'].includes(block.type) ? 4 : 2}
        placeholder={isMedia || block.type === 'link' ? 'https://…' : ''}
      />}
    {isMedia && resourceOptions.length > 0 && <Select
      label="Or use a course resource"
      value={block.resourceId || ''}
      onChange={(resourceId) => onChange({
        ...block,
        resourceId: resourceId || undefined,
        ...(resourceId ? { content: '' } : {}),
      })}
      options={resourceOptions}
    />}
    {block.type === 'video' && <Input label="Caption" value={block.caption || ''} onChange={(value) => set('caption', value)} />}
    {block.type === 'image' && <>
      <Input label="Alternative text" value={block.altText || ''} onChange={(value) => set('altText', value)} />
      <Input label="Caption" value={block.caption || ''} onChange={(value) => set('caption', value)} />
    </>}
    {['document', 'link', 'exercise', 'summary'].includes(block.type)
      && <Input label="Title (optional)" value={block.title || ''} onChange={(value) => set('title', value)} />}
    {block.type === 'exercise' && <Textarea label="Learner instructions" value={block.instructions || ''} onChange={(value) => set('instructions', value)} />}
    {block.type === 'knowledge_check' && <>
      <Textarea
        label="Answer options (one per line)"
        value={(Array.isArray(block.options) ? block.options : []).join('\n')}
        onChange={(raw) => set('options', raw.split('\n').map((option) => option.trim()).filter(Boolean))}
        rows={4}
      />
      {Array.isArray(block.correctAnswer) ? (
        <fieldset className="lesson-check-editor">
          <legend>Correct answers</legend>
          {(block.options || []).filter(isNonEmpty).map((option) => (
            <label key={option}>
              <input
                type="checkbox"
                checked={block.correctAnswer.includes(option)}
                onChange={(event) => set('correctAnswer', event.target.checked
                  ? [...new Set([...block.correctAnswer, option])]
                  : block.correctAnswer.filter((answer) => answer !== option))}
              />
              {option}
            </label>
          ))}
        </fieldset>
      ) : <Select
        label="Correct answer"
        value={typeof block.correctAnswer === 'string' ? block.correctAnswer : ''}
        onChange={(value) => set('correctAnswer', value)}
        options={(block.options || []).filter(isNonEmpty).map((option) => ({ value: option, label: option }))}
      />}
      <Textarea label="Explanation (optional)" value={block.explanation || ''} onChange={(value) => set('explanation', value)} rows={3} />
    </>}
  </>;
}

export default function LessonContentEditor({
  content,
  resources = [],
  onSave,
  onCancel,
  onDirtyChange,
  externalDirty = false,
  saveLabel = 'Save lesson content',
  initiallyDirty = false,
  onSaved,
}) {
  const [blocks, setBlocks] = useState(() => parseLessonContentBlocks(content));
  const [dirty, setDirty] = useState(initiallyDirty);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [validationErrors, setValidationErrors] = useState([]);
  const [savedNotice, setSavedNotice] = useState('');
  const savingRef = useRef(false);
  const hasUnsavedChanges = dirty || externalDirty || initiallyDirty;

  useEffect(() => {
    onDirtyChange?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, onDirtyChange]);

  useEffect(() => {
    if (!hasUnsavedChanges) return undefined;
    const warnBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const confirmInternalNavigation = (event) => {
      const anchor = event.target.closest?.('a[href]');
      if (!anchor || anchor.target || anchor.origin !== window.location.origin) return;
      if (!window.confirm('Discard unsaved lesson changes and leave this page?')) {
        event.preventDefault();
      }
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    document.addEventListener('click', confirmInternalNavigation, true);
    return () => {
      window.removeEventListener('beforeunload', warnBeforeUnload);
      document.removeEventListener('click', confirmInternalNavigation, true);
    };
  }, [hasUnsavedChanges]);

  const updateBlocks = (updater) => {
    setBlocks((current) => (typeof updater === 'function' ? updater(current) : updater));
    setDirty(true);
    setSavedNotice('');
    setError('');
    setValidationErrors([]);
  };

  const save = async () => {
    if (savingRef.current) return;
    const issues = validateLessonContentBlocks(blocks, resources);
    if (issues.length) {
      setValidationErrors(issues);
      setError('Review the highlighted content blocks before saving.');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError('');
    setValidationErrors([]);
    setSavedNotice('');
    try {
      const saved = await onSave(blocks.map((block) => JSON.parse(JSON.stringify(block))));
      if (saved?.content !== undefined) setBlocks(parseLessonContentBlocks(saved.content));
      setDirty(false);
      setSavedNotice('Lesson content saved.');
      onDirtyChange?.(Boolean(externalDirty));
      onSaved?.(saved);
    } catch (requestError) {
      setError(requestError.response?.data?.message || requestError.message || 'Could not save lesson content.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const cancel = () => {
    if (hasUnsavedChanges && !window.confirm('Discard unsaved lesson changes?')) return;
    setBlocks(parseLessonContentBlocks(content));
    setDirty(false);
    setError('');
    setValidationErrors([]);
    setSavedNotice('');
    setPreview(false);
    onDirtyChange?.(false);
    onCancel?.();
  };

  const blockError = (index) => validationErrors.find((issue) => issue.index === index)?.message;
  const activeResources = resources.filter(({ id }) => id);

  return <section className="lesson-content-editor" aria-label="Lesson content editor">
    <div className="lesson-editor-toolbar">
      <div>
        <span className="eyebrow">Content blocks</span>
        <h4>Add to this lesson</h4>
      </div>
      <div className="lesson-editor-preview-actions">
        <Button type="button" variant={preview ? 'secondary' : 'ghost'} size="sm" disabled={saving} onClick={() => setPreview((current) => !current)}>
          {preview ? <><Pencil size={15} /> Back to editing</> : <><Eye size={15} /> Preview lesson</>}
        </Button>
      </div>
    </div>

    {!preview && <div className="lesson-block-toolbar" role="toolbar" aria-label="Add a content block">
      {lessonContentBlockTypes.map(({ type, label, Icon }) => (
        <Button
          type="button"
          key={type}
          variant="secondary"
          size="sm"
          aria-label={`Add ${label} block`}
          disabled={saving}
          onClick={() => updateBlocks((current) => [...current, makeBlock(type)])}
        >
          <Icon size={15} /> {label}
        </Button>
      ))}
    </div>}

    {preview ? (
      <div className="lesson-editor-preview" aria-label="Student preview">
        <div className="lesson-editor-preview-heading"><Eye size={16} /><strong>Student preview</strong><span>Unsaved changes are shown here.</span></div>
        <LessonContentRenderer content={blocks} resources={activeResources} />
      </div>
    ) : blocks.length ? (
      <div className="lesson-editor-blocks">
        {blocks.map((block, index) => {
          const typeInfo = lessonContentBlockTypes.find(({ type }) => type === block.type);
          const Icon = typeInfo?.Icon || FileText;
          return <article className="lesson-editor-block" key={`${block.id || block.type}-${index}`}>
            <header className="lesson-editor-block-heading">
              <div><span className="builder-index">{String(index + 1).padStart(2, '0')}</span><Icon size={16} /><strong>{typeInfo?.label || 'Unsupported block'}</strong></div>
              <div className="lesson-editor-block-actions">
                <Button type="button" variant="ghost" size="sm" aria-label={`Move block ${index + 1} up`} disabled={index === 0 || saving} onClick={() => updateBlocks((current) => {
                  const next = [...current];
                  [next[index - 1], next[index]] = [next[index], next[index - 1]];
                  return next;
                })}><ArrowUp size={15} /></Button>
                <Button type="button" variant="ghost" size="sm" aria-label={`Move block ${index + 1} down`} disabled={index === blocks.length - 1 || saving} onClick={() => updateBlocks((current) => {
                  const next = [...current];
                  [next[index], next[index + 1]] = [next[index + 1], next[index]];
                  return next;
                })}><ArrowDown size={15} /></Button>
                <Button type="button" variant="ghost" size="sm" aria-label={`Duplicate block ${index + 1}`} disabled={saving} onClick={() => updateBlocks((current) => {
                  const copy = JSON.parse(JSON.stringify(current[index]));
                  return [...current.slice(0, index + 1), copy, ...current.slice(index + 1)];
                })}><Copy size={15} /></Button>
                <Button type="button" variant="ghost" size="sm" className="action-danger" aria-label={`Delete block ${index + 1}`} disabled={saving} onClick={() => {
                  if (window.confirm(`Delete content block ${index + 1}? Save the lesson to persist this change.`)) {
                    updateBlocks((current) => current.filter((_, blockIndex) => blockIndex !== index));
                  }
                }}><Trash2 size={15} /></Button>
              </div>
            </header>
            <fieldset className="lesson-editor-fields" disabled={saving}>
              <ContentBlockFields
                block={block}
                resources={activeResources}
                onChange={(updated) => updateBlocks((current) => current.map((item, blockIndex) => (
                  blockIndex === index ? updated : item
                )))}
              />
            </fieldset>
            {blockError(index) && <p className="lesson-editor-field-error" role="alert">{blockError(index)}</p>}
          </article>;
        })}
      </div>
    ) : <div className="lesson-editor-empty">
      <Plus size={19} />
      <strong>No content blocks yet</strong>
      <span>Add a block above to start building this lesson.</span>
    </div>}

    {error && <div className="notice notice-error" role="alert">{error}</div>}
    {savedNotice && <div className="notice notice-success" role="status">{savedNotice}</div>}
    <div className="lesson-editor-actions">
      <Button type="button" disabled={saving} onClick={save}><Save size={15} /> {saving ? 'Saving…' : saveLabel}</Button>
      <Button type="button" variant="ghost" disabled={saving} onClick={cancel}>Cancel</Button>
    </div>
  </section>;
}
