import { forwardRef, useState } from 'react';

export const Modal = forwardRef(({ isOpen, onClose, title, children, footer, closeOnEsc = true, closeOnOverlayClick = true }, ref) => {
  const handleKeyDown = (e) => {
    if (closeOnEsc && e.key === 'Escape') onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={closeOnOverlayClick ? onClose : undefined} onKeyDown={handleKeyDown} role="dialog" aria-modal="true">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {title && (
          <div className="modal-header">
            <h3 style={{ margin: 0 }}>{title}</h3>
            <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        )}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
});
Modal.displayName = 'Modal';

export const Toast = ({ message, type = 'success', onRemove, id }) => {
  return (
    <div className={`toast ${type}`} role="alert" aria-live="polite">
      {message}
      <button className="btn btn-ghost btn-sm" style={{ float: 'right', marginLeft: 12 }} onClick={onRemove}>
        ✕
      </button>
    </div>
  );
};

export const Badge = ({ status }) => {
  const map = {
    active: 'badge-active',
    pending: 'badge-pending',
    suspended: 'badge-suspended',
    rejected: 'badge-rejected',
    draft: 'badge-draft',
    published: 'badge-active',
    planned: 'badge-pending',
    completed: 'badge-active',
  };
  const cls = map[status] || 'badge-draft';
  return <span className={`badge ${cls}`}>{status.charAt(0).toUpperCase() + status.slice(1)}</span>;
};

export const EmptyState = ({ title, description, action, actionLabel }) => {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action && actionLabel && (
        <button className="btn btn-primary btn-sm" onClick={action}>
          {actionLabel}
        </button>
      )}
    </div>
  );
};

export const Card = ({ children, className = '', header, ...props }) => {
  return (
    <div className={`card ${className}`} {...props}>
      {header && <div className="card-header">{header}</div>}
      {children}
    </div>
  );
};
