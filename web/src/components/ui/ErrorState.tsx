interface ErrorStateProps {
  title?: string;
  error?: unknown;
  actionLabel?: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = 'Something went wrong',
  error,
  actionLabel = 'Retry',
  onRetry,
}: ErrorStateProps) {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'The request failed.';

  return (
    <div className="rounded-lg border border-red-500/30 bg-red-950/20 px-4 py-4 text-sm" role="alert">
      <div className="font-medium text-red-200">{title}</div>
      <p className="mt-1 text-xs text-red-300/80">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-100 hover:bg-red-500/20"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
