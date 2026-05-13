import React from 'react';

export type ApprovalVariant = 'plan' | 'gate' | 'skill';

const VARIANT_STYLES: Record<ApprovalVariant, string> = {
  plan:  'bg-purple-500/20 text-purple-300',
  gate:  'bg-amber-500/20 text-amber-300',
  skill: 'bg-sky-500/20 text-sky-300',
};

interface ApprovalCardProps {
  variant: ApprovalVariant;
  title: string;
  body: React.ReactNode;
  onApprove: () => void;
  onReject: () => void;
  onTertiary?: () => void;
  tertiaryLabel?: string;
  disabled?: boolean;
}

export function ApprovalCard({
  variant,
  title,
  body,
  onApprove,
  onReject,
  onTertiary,
  tertiaryLabel = 'Review',
  disabled = false,
}: ApprovalCardProps) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-lg p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <span
            className={`mt-0.5 text-[11px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded ${VARIANT_STYLES[variant]}`}
          >
            {variant}
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-zinc-100">{title}</div>
            <div className="text-[11px] text-zinc-500 mt-0.5">{body}</div>
          </div>
        </div>
        <div className="flex gap-1.5 flex-shrink-0">
          {onTertiary && (
            <button
              onClick={onTertiary}
              disabled={disabled}
              className="text-xs px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40"
            >
              {tertiaryLabel}
            </button>
          )}
          <button
            onClick={onReject}
            disabled={disabled}
            className="text-xs px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40"
          >
            Reject
          </button>
          <button
            onClick={onApprove}
            disabled={disabled}
            className="btn-approve text-xs px-2.5 py-1 rounded font-medium disabled:opacity-40"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}
