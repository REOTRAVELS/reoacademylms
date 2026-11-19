import { useRef, useState } from 'react';
import { ExternalLink, FileText } from 'lucide-react';
import { resourcesAPI } from '../../services/api';

const isHttpUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
};

const contentBlocks = (content) => {
  if (Array.isArray(content)) return content;
  if (typeof content !== 'string' || !content.trim()) return [];
  try {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [{ type: 'rich_text', content }];
  } catch {
    return [{ type: 'rich_text', content }];
  }
};

function KnowledgeCheck({ block, index }) {
  const [answer, setAnswer] = useState(Array.isArray(block.correctAnswer) ? [] : '');
  const [checked, setChecked] = useState(false);
  const options = Array.isArray(block.options) ? block.options : [];
  const correct = checked && (Array.isArray(block.correctAnswer)
    ? JSON.stringify([...answer].sort()) === JSON.stringify([...block.correctAnswer].sort())
    : answer === String(block.correctAnswer));

  return (
    <fieldset className="lesson-check">
      <legend>{block.content}</legend>
      {options.map((option) => (
        <label className="lesson-check-option" key={option}>
          <input
            type={Array.isArray(block.correctAnswer) ? 'checkbox' : 'radio'}
            name={`check-${block.id || 'block'}-${index}`}
            checked={Array.isArray(block.correctAnswer) ? answer.includes(option) : answer === option}
            onChange={(event) => {
              setChecked(false);
              if (Array.isArray(block.correctAnswer)) {
                setAnswer((current) => event.target.checked
                  ? [...new Set([...current, option])]
                  : current.filter((value) => value !== option));
              } else {
                setAnswer(option);
              }
            }}
          />
          {option}
        </label>
      ))}
      <button className="btn btn-secondary btn-sm" type="button" disabled={!answer.length} onClick={() => setChecked(true)}>Check answer</button>
      {checked && <p className={correct ? 'lesson-check-result is-correct' : 'lesson-check-result is-incorrect'} role="status">
        {correct ? 'Correct.' : `Not quite. ${block.explanation || 'Review the lesson and try again.'}`}
      </p>}
    </fieldset>
  );
}

const renderInlineMarkdown = (text, keyPrefix) => text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, index) => {
  if (part.startsWith('**') && part.endsWith('**')) return <strong key={`${keyPrefix}-${index}`}>{part.slice(2, -2)}</strong>;
  if (part.startsWith('*') && part.endsWith('*')) return <em key={`${keyPrefix}-${index}`}>{part.slice(1, -1)}</em>;
  return part;
});

function RichText({ content }) {
  const lines = String(content || '').split('\n');
  const rendered = [];
  let bullets = [];
  const flushBullets = () => {
    if (!bullets.length) return;
    rendered.push(<ul key={`list-${rendered.length}`}>{bullets.map((line, index) => <li key={index}>{renderInlineMarkdown(line, `list-${rendered.length}-${index}`)}</li>)}</ul>);
    bullets = [];
  };
  lines.forEach((line, index) => {
    if (line.startsWith('- ')) {
      bullets.push(line.slice(2));
      return;
    }
    flushBullets();
    rendered.push(line ? <p key={`line-${index}`}>{renderInlineMarkdown(line, `line-${index}`)}</p> : <br key={`break-${index}`} />);
  });
  flushBullets();
  return <div className="lesson-rich-text">{rendered}</div>;
}

function LessonImage({ url, alt }) {
  const [unavailable, setUnavailable] = useState(false);
  if (unavailable) {
    return <p className="lesson-resource-unavailable" role="note">This image could not be loaded. Contact your Tutor.</p>;
  }
  return <img src={url} alt={alt} loading="lazy" onError={() => setUnavailable(true)} />;
}

function LessonVideo({ url }) {
  const [unavailable, setUnavailable] = useState(false);
  if (unavailable) {
    return <p className="lesson-resource-unavailable" role="note">This video could not be loaded. Contact your Tutor.</p>;
  }
  return <video controls controlsList="nodownload" playsInline preload="metadata" src={url} onError={() => setUnavailable(true)}>
    Your browser cannot play this video.
  </video>;
}

function ContentBlock({ block, index, resources }) {
  if (!block || typeof block !== 'object') return null;
  const resource = resources.find((item) => item.id === block.resourceId);
  const url = block.resourceId
    ? resource ? resourcesAPI.downloadUrl(resource.id) : null
    : isHttpUrl(block.content) ? block.content : null;
  const hasUrl = Boolean(url);
  const unavailable = block.resourceId && !resource;

  if (block.type === 'video') {
    const isVideoFile = resource?.mimeType?.startsWith('video/')
      || (isHttpUrl(url) && /\.(mp4|webm|ogg)(\?.*)?$/i.test(url));
    return <figure className="lesson-block lesson-block-media">
      {isVideoFile
        ? <LessonVideo url={url} />
        : hasUrl
          ? <a className="lesson-content-link" href={url} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Open lesson video</a>
          : <p className="lesson-resource-unavailable" role="note">{unavailable ? 'This video is no longer available. Contact your Tutor.' : 'No video is available for this lesson.'}</p>}
      {block.caption && <figcaption>{block.caption}</figcaption>}
    </figure>;
  }
  if (block.type === 'image') {
    return <figure className="lesson-block lesson-block-media">
      {hasUrl
        ? <LessonImage url={url} alt={block.altText || block.caption || ''} />
        : <p className="lesson-resource-unavailable" role="note">{unavailable ? 'This image is no longer available. Contact your Tutor.' : 'No image is available for this lesson.'}</p>}
      {block.caption && <figcaption>{block.caption}</figcaption>}
    </figure>;
  }
  if (block.type === 'document') {
    const isPdf = resource?.mimeType === 'application/pdf'
      || (isHttpUrl(url) && /\.pdf(\?.*)?$/i.test(url));
    if (hasUrl && isPdf) {
      return <figure className="lesson-block lesson-block-media">
        <iframe
          className="lesson-resource-pdf"
          title={block.title || resource?.originalName || 'Course PDF'}
          src={`${url}#toolbar=0&navpanes=0`}
          loading="lazy"
        />
        {block.caption && <figcaption>{block.caption}</figcaption>}
      </figure>;
    }
    return <p className="lesson-block">{hasUrl
      ? <a className="lesson-content-link" href={url} target="_blank" rel="noreferrer"><FileText size={16} /> {block.title || 'Open course document'}</a>
      : <span className="lesson-resource-unavailable" role="note">{unavailable ? 'This document is no longer available. Contact your Tutor.' : 'No document is available for this lesson.'}</span>}</p>;
  }
  if (block.type === 'link') {
    return <p className="lesson-block">{hasUrl
      ? <a className="lesson-content-link" href={url} target="_blank" rel="noreferrer"><ExternalLink size={16} /> {block.title || block.content}</a>
      : <span className="lesson-resource-unavailable" role="note">{unavailable ? 'This link resource is no longer available. Contact your Tutor.' : 'This lesson link is unavailable.'}</span>}</p>;
  }
  if (block.type === 'knowledge_check') return <KnowledgeCheck key={`${block.id || 'check'}-${index}`} block={block} index={index} />;
  if (block.type === 'exercise') {
    return <section className="lesson-block lesson-exercise"><strong>{block.title || 'Exercise'}</strong><p>{block.content}</p>{block.instructions && <p>{block.instructions}</p>}</section>;
  }
  if (block.type === 'summary') {
    return <section className="lesson-block lesson-summary"><strong>{block.title || 'Summary'}</strong><p>{block.content}</p></section>;
  }
  if (block.type === 'rich_text') return <div className="lesson-block"><RichText content={block.content} /></div>;
  return null;
}

export default function LessonContentRenderer({ content, resources = [] }) {
  const blocks = contentBlocks(content);
  if (!blocks.length) return <p className="muted">No lesson content has been added.</p>;
  return <div className="lesson-content-blocks">{blocks.map((block, index) => <ContentBlock key={`${block.id || block.type}-${index}`} block={block} index={index} resources={resources} />)}</div>;
}
