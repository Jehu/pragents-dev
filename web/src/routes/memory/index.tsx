import { createFileRoute } from '@tanstack/react-router';
import { MemoryExplorer } from '../../components/MemoryExplorer';

export const Route = createFileRoute('/memory/')({
  component: MemoryExplorer,
});
