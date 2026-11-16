import { useEffect, useRef } from 'react';

export default function ConfirmDialog({
  title, body, confirmLabel, danger = false, busy = false, onConfirm, onCancel,
}) {
  const cancelRef = useRef(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (event) => { if (event.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="rt-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="rt-modal rt-modal--sm" role="alertdialog" aria-modal="true" aria-labelledby="rt-confirm-title">
        <div className="rt-modal-body">
          <h2 id="rt-confirm-title">{title}</h2>
          <p>{body}</p>
          <div className="rt-modal-actions">
            <button type="button" className="rt-btn" ref={cancelRef} onClick={onCancel}>Cancel</button>
            <button type="button" className={`rt-btn ${danger ? 'rt-btn--danger' : 'rt-btn--primary'}`} onClick={onConfirm} disabled={busy}>
              {busy ? 'Working…' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
