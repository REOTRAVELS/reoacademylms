import { useEffect, useRef } from 'react';

export default function MoreMenu({ items, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const first = ref.current?.querySelector('button:not([disabled])');
    first?.focus();
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const buttons = [...ref.current.querySelectorAll('button:not([disabled])')];
        const index = buttons.indexOf(document.activeElement);
        const next = event.key === 'ArrowDown' ? index + 1 : index - 1;
        buttons[(next + buttons.length) % buttons.length]?.focus();
        event.preventDefault();
      }
    };
    const onDown = (event) => {
      if (ref.current && !ref.current.contains(event.target) && !event.target.closest('[data-more-trigger]')) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [onClose]);

  return (
    <div className="rt-menu" role="menu" ref={ref} aria-label="More options">
      {items.filter((item) => !item.hidden).map((item, index) => {
        const Icon = item.icon;
        return (
          <div key={item.key}>
            {item.separator && index > 0 && <hr />}
            <button
              type="button"
              role="menuitem"
              className={`${item.danger ? 'is-danger' : ''}${item.mobileOnly ? ' rt-sm-only' : ''}`}
              onClick={() => { onClose(); item.onClick(); }}
            >
              <Icon size={17} /> {item.label}
            </button>
          </div>
        );
      })}
    </div>
  );
}
