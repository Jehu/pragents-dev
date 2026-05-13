import React from 'react';

export type StatusType =
  | 'idle'
  | 'busy'
  | 'running'
  | 'complete'
  | 'failed'
  | 'needs_review'
  | 'proposed'
  | 'cold';

const STATUS_STYLES: Record<StatusType, string> = {
  idle:         'bg-zinc-500/20 text-zinc-300',
  cold:         'bg-zinc-700/30 text-zinc-400',
  busy:         'bg-amber-500/20 text-amber-300',
  running:      'bg-sky-500/20 text-sky-300',
  complete:     'bg-emerald-500/20 text-emerald-300',
  failed:       'bg-red-500/20 text-red-400',
  needs_review: 'bg-amber-500/20 text-amber-300',
  proposed:     'bg-purple-500/20 text-purple-300',
};

const STATUS_LABELS: Record<StatusType, string> = {
  idle:         'idle',
  cold:         'cold',
  busy:         'busy',
  running:      'running',
  complete:     'complete',
  failed:       'failed',
  needs_review: 'needs review',
  proposed:     'proposed',
};

interface StatusPillProps {
  status: StatusType;
  className?: string;
}

export function StatusPill({ status, className = '' }: StatusPillProps) {
  return (
    <span
      aria-label={status}
      className={`inline-flex items-center text-[11px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded ${STATUS_STYLES[status]} ${className}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
