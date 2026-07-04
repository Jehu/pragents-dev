import React from 'react';

export type ApprovalVariant = 'plan' | 'gate' | 'skill';

const VARIANT_STYLES: Record<ApprovalVariant, string> = {
  plan:  'bg-purple-500/20 text-purple-300',
  gate:  'bg-amber-500/20 text-amber-300',
  skill: 'bg-sky-500/20 text-sky-300',
};

export type ApprovalStatus = 'pending' | 'approving' | 'approved' | 'cancelled';

const STATUS_LABEL: Record<Exclude<ApprovalStatus, 'pending'>, string> = {
  approving: 'Approving…',
  approved: 'Approved',
  cancelled: 'Cancelled',
};

const STATUS_STYLE: Record<Exclude<ApprovalStatus, 'pending'>, string> = {
  approving: 'bg-zinc-700 text-zinc-300',
  approved: 'bg-emerald-500/20 text-emerald-300',
  cancelled: 'bg-zinc-700 text-zinc-400',
};

interface ApprovalCardProps {
  variant: ApprovalVariant;
  /** Plain text or a node — pass a router Link when the entry has a detail page. */
  title: React.ReactNode;
  body: React.ReactNode;
  onApprove?: () => void;
  onReject?: () => void;
  onTertiary?: () => void;
  tertiaryLabel?: string;
  disabled?: boolean;
  isLoading?: boolean;
  /** When set to anything other than 'pending' (or undefined), the Approve / Reject
   *  buttons are replaced by a resolved-state pill. */
  status?: ApprovalStatus;
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
  isLoading = false,
  status,
}: ApprovalCardProps) {
  const resolved = status && status !== 'pending';
  return (
    <div aria-busy={isLoading} className="bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-lg p-3">
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
          {resolved ? (
            <span
              className={`text-[11px] uppercase tracking-wider font-semibold px-2 py-1 rounded ${STATUS_STYLE[status as Exclude<ApprovalStatus, 'pending'>]}`}
            >
              {STATUS_LABEL[status as Exclude<ApprovalStatus, 'pending'>]}
            </span>
          ) : (
            <>
              {onTertiary && (
                <button
                  onClick={onTertiary}
                  disabled={disabled}
                  className="text-xs px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40"
                >
                  {tertiaryLabel}
                </button>
              )}
              {onReject && (
                <button
                  onClick={onReject}
                  disabled={disabled}
                  className="text-xs px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40"
                >
                  Reject
                </button>
              )}
              {onApprove && (
                <button
                  onClick={onApprove}
                  disabled={disabled}
                  className="btn-approve text-xs px-2.5 py-1 rounded font-medium disabled:opacity-40"
                >
                  Approve
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
