import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/plans/$planId')({
  component: PlanDetailPage,
});

function PlanDetailPage() {
  const { planId } = Route.useParams();
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold tracking-tight text-zinc-100">Plan: {planId}</h1>
      <p className="text-sm text-zinc-500 mt-1">Coming soon — plan detail and step viewer.</p>
    </div>
  );
}
