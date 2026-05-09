import { createFileRoute } from '@tanstack/react-router';
import { FeedView } from '../../components/FeedView';

export const Route = createFileRoute('/feed/')({
  component: FeedView,
});
