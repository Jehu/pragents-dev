import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/overview/')({
  component: OverviewPage,
});

function OverviewPage() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold tracking-tight text-zinc-100">Overview</h1>
      <p className="text-sm text-zinc-500 mt-1">Coming soon — system-wide summary.</p>
    </div>
  );
}
