import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/chat/')({
  component: ChatPage,
});

function ChatPage() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold tracking-tight text-zinc-100">Chat</h1>
      <p className="text-sm text-zinc-500 mt-1">Coming soon — natural language conversation with agents.</p>
    </div>
  );
}
