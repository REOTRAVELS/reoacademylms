import { forwardRef } from 'react';

export const Button = forwardRef(({ children, className = '', type = 'button', variant = 'primary', size = 'md', disabled, onClick, ...props }, ref) => {
  const variants = {
    primary: 'btn btn-primary',
    secondary: 'btn btn-secondary',
    danger: 'btn btn-danger',
    ghost: 'btn btn-ghost',
    outline: 'btn btn-outline',
  };
  const sizes = {
    sm: 'btn-sm',
    md: '',
    lg: 'btn-lg',
  };
  return (
    <button
      ref={ref}
      type={type}
      className={`${variants[variant]} ${sizes[size]} ${className}`.trim()}
      disabled={disabled}
      onClick={onClick}
      {...props}
    >
      {children}
    </button>
  );
});
Button.displayName = 'Button';
