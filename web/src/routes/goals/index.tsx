import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/goals/')({
  component: GoalsPage,
});

function GoalsPage() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold tracking-tight text-zinc-100">Goals</h1>
      <p className="text-sm text-zinc-500 mt-1">Coming soon — scheduled goals and run history.</p>
    </div>
  );
}
