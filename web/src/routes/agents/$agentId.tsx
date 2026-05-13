import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/agents/$agentId')({
  component: AgentDetailPage,
});

function AgentDetailPage() {
  const { agentId } = Route.useParams();
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold tracking-tight text-zinc-100">Agent: {agentId}</h1>
      <p className="text-sm text-zinc-500 mt-1">Coming soon — agent detail view.</p>
    </div>
  );
}
