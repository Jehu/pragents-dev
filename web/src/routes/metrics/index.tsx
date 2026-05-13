import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/metrics/')({
  component: MetricsPage,
});

function MetricsPage() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold tracking-tight text-zinc-100">Metrics</h1>
      <p className="text-sm text-zinc-500 mt-1">Coming soon — event throughput and task metrics.</p>
    </div>
  );
}
