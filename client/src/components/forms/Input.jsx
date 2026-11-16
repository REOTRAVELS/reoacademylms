import { forwardRef, useId } from 'react';

export const Input = forwardRef(({ label, className = '', type = 'text', placeholder, value, onChange, error, disabled, required, ...props }, ref) => {
  const generatedId = useId().replaceAll(':', '');
  const id = props.id || `field-${generatedId}`;
  return (
    <div className={`field ${className}`}>
      {label && <label className="label" htmlFor={id}>{label}{required ? ' *' : ''}</label>}
      <input
        ref={ref}
        id={id}
        type={type}
        placeholder={placeholder}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className={`input ${error ? 'border-red-500' : ''}`}
        disabled={disabled}
        required={required}
        {...props}
      />
    </div>
  );
});
Input.displayName = 'Input';

export const Select = forwardRef(({ label, options, className = '', value, onChange, error, disabled, required, ...props }, ref) => {
  const generatedId = useId().replaceAll(':', '');
  const id = props.id || `field-${generatedId}`;
  return (
    <div className={`field ${className}`}>
      {label && <label className="label" htmlFor={id}>{label}{required ? ' *' : ''}</label>}
      <select
        ref={ref}
        id={id}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className={`select ${error ? 'border-red-500' : ''}`}
        disabled={disabled}
        required={required}
        {...props}
      >
        <option value="">Select an option</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
});
Select.displayName = 'Select';

export const Textarea = forwardRef(({ label, className = '', placeholder, value, onChange, error, disabled, required, ...props }, ref) => {
  const generatedId = useId().replaceAll(':', '');
  const id = props.id || `field-${generatedId}`;
  return (
    <div className={`field ${className}`}>
      {label && <label className="label" htmlFor={id}>{label}{required ? ' *' : ''}</label>}
      <textarea
        ref={ref}
        id={id}
        placeholder={placeholder}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className={`textarea ${error ? 'border-red-500' : ''}`}
        disabled={disabled}
        required={required}
        {...props}
      />
    </div>
  );
});
Textarea.displayName = 'Textarea';
