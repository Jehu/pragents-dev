import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/health/')({
  component: HealthPage,
});

function HealthPage() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold tracking-tight text-zinc-100">Health</h1>
      <p className="text-sm text-zinc-500 mt-1">Coming soon — server and agent health status.</p>
    </div>
  );
}
