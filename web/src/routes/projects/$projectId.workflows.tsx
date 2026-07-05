import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/projects/$projectId/workflows')({
  component: WorkflowsLayout,
});

function WorkflowsLayout() {
  return <Outlet />;
}
