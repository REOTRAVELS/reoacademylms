import { forwardRef } from 'react';

// One toolbar/menu button with a CSS tooltip. The aria-label is the accessible name,
// the tooltip is a visual duplicate so it is hidden from assistive tech.
const ToolButton = forwardRef(({
  label, tip, active = false, danger = false, disabled = false, badge, pressed, className = '', children, ...props
}, ref) => (
  <span className={`rt-toolwrap ${className}`}>
    <button
      ref={ref}
      type="button"
      className={`rt-tool${active ? ' is-active' : ''}${danger ? ' is-danger' : ''}`}
      aria-label={label}
      aria-pressed={pressed}
      aria-disabled={disabled || undefined}
      {...props}
      onClick={disabled ? undefined : props.onClick}
    >
      {children}
      {badge ? <span className="rt-tool-badge" aria-hidden="true">{badge}</span> : null}
    </button>
    <span className="rt-tip" aria-hidden="true">{tip || label}</span>
  </span>
));
ToolButton.displayName = 'ToolButton';
export default ToolButton;
