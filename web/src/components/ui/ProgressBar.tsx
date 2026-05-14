import React from 'react';

interface ProgressBarProps {
  value: number; // 0–100
  color?: string;
  className?: string;
}

export function ProgressBar({ value, color = '#6366f1', className = '' }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className={`h-0.5 w-full bg-zinc-800 rounded-full overflow-hidden ${className}`}>
      <div
        className="h-full rounded-full transition-all duration-300"
        style={{ width: `${clamped}%`, backgroundColor: color }}
      />
    </div>
  );
}
