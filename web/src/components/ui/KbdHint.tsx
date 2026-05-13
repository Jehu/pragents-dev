import React from 'react';

interface KbdHintProps {
  keys: string[];
  className?: string;
}

export function KbdHint({ keys, className = '' }: KbdHintProps) {
  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`}>
      {keys.map((key, i) => (
        <kbd
          key={i}
          className="inline-flex items-center justify-center text-[10px] font-mono font-medium px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-400 leading-none"
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}
