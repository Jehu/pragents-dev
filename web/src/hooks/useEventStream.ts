import { useEventBus, type SseEvent } from '../stores/eventBus';

/**
 * Returns filtered events from the SSE event bus store.
 * Re-renders only when matching events change.
 */
export function useEventStream(
  filter: Partial<Pick<SseEvent, 'type' | 'agentId' | 'projectId' | 'taskId'>> = {},
): SseEvent[] {
  return useEventBus(filter);
}
