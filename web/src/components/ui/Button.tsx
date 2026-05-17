import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'approve' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
  children: ReactNode;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'border-indigo-500/40 bg-indigo-500/20 text-indigo-100 hover:bg-indigo-500/30',
  secondary: 'border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700',
  danger: 'border-red-500/40 bg-red-600 text-white hover:bg-red-500',
  approve: 'border-emerald-500/40 bg-emerald-600 text-white hover:bg-emerald-500',
  ghost: 'border-transparent bg-transparent text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100',
};

export function Button({
  variant = 'secondary',
  loading = false,
  disabled,
  className = '',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center rounded border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
    >
      {loading ? 'Working…' : children}
    </button>
  );
}
