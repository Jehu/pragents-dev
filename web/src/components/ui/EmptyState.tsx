import React from 'react';

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  /** Optional call-to-action (button/link) rendered under the description. */
  action?: React.ReactNode;
  className?: string;
}

/**
 * Word icons (e.g. icon="Tasks") render as a subtle small-caps kicker;
 * glyph/emoji icons (e.g. "🧠", "✓") keep the large treatment.
 */
function isWordIcon(icon: React.ReactNode): icon is string {
  return typeof icon === 'string' && /^[A-Za-z][A-Za-z ]{2,}$/.test(icon);
}

export function EmptyState({ icon, title, description, action, className = '' }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center py-16 px-8 text-center ${className}`}>
      {isWordIcon(icon) ? (
        <div className="text-[11px] uppercase tracking-widest text-zinc-600 mb-2">{icon}</div>
      ) : (
        <div className="text-4xl text-zinc-600 mb-4">{icon}</div>
      )}
      <h3 className="text-sm font-semibold text-zinc-300 mb-1">{title}</h3>
      <p className="text-xs text-zinc-500 max-w-xs">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
