import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/skills/')({
  component: SkillsPage,
});

function SkillsPage() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold tracking-tight text-zinc-100">Skills</h1>
      <p className="text-sm text-zinc-500 mt-1">Coming soon — skill library and proposal review.</p>
    </div>
  );
}
