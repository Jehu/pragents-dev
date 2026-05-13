import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/agents/')({
  component: AgentsPage,
});

function AgentsPage() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold tracking-tight text-zinc-100">Agents</h1>
      <p className="text-sm text-zinc-500 mt-1">Coming soon — agent list and session management.</p>
    </div>
  );
}
