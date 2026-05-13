import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/plans/')({
  component: PlansPage,
});

function PlansPage() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold tracking-tight text-zinc-100">Plans</h1>
      <p className="text-sm text-zinc-500 mt-1">Coming soon — plan list and approval workflow.</p>
    </div>
  );
}
