import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/inbox/')({
  component: InboxPage,
});

function InboxPage() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold tracking-tight text-zinc-100">Inbox</h1>
      <p className="text-sm text-zinc-500 mt-1">Coming soon — pending gates, draft plans, and proposed skills.</p>
    </div>
  );
}
