interface LoadingStateProps {
  label?: string;
}

export function LoadingState({ label = 'Loading' }: LoadingStateProps) {
  return (
    <div className="flex items-center justify-center py-8 text-xs text-zinc-500" role="status">
      {label}…
    </div>
  );
}
