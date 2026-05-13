import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

export interface SseEvent {
  id?: string;
  type: string;
  agentId?: string;
  projectId?: string;
  taskId?: string;
  data: unknown;
  ts: number;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

const MAX_EVENTS = 200;
const RATE_WINDOW_MS = 10_000;

interface EventBusState {
  events: SseEvent[];
  connectionStatus: ConnectionStatus;
  eventRate: number;

  // Internal: raw timestamps for rate calculation
  _timestamps: number[];

  pushEvent: (event: SseEvent) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  _recalcRate: () => void;
}

export const useEventBusStore = create<EventBusState>((set, get) => ({
  events: [],
  connectionStatus: 'disconnected',
  eventRate: 0,
  _timestamps: [],

  pushEvent: (event: SseEvent) => {
    const now = Date.now();
    set((state) => {
      const events = [...state.events, event];
      // Drop oldest if over limit
      const trimmed = events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events;

      // Keep timestamps within rolling 10s window
      const timestamps = [...state._timestamps, now].filter((t) => now - t <= RATE_WINDOW_MS);
      const eventRate = timestamps.length / (RATE_WINDOW_MS / 1000);

      return { events: trimmed, _timestamps: timestamps, eventRate };
    });
  },

  setConnectionStatus: (connectionStatus: ConnectionStatus) => set({ connectionStatus }),

  _recalcRate: () => {
    const now = Date.now();
    set((state) => {
      const timestamps = state._timestamps.filter((t) => now - t <= RATE_WINDOW_MS);
      const eventRate = timestamps.length / (RATE_WINDOW_MS / 1000);
      return { _timestamps: timestamps, eventRate };
    });
  },
}));

/** Selector: returns events filtered by partial match on type/agentId/projectId/taskId.
 *  useShallow prevents infinite re-renders caused by .filter() always returning a new array ref. */
export function useEventBus(filter: Partial<Pick<SseEvent, 'type' | 'agentId' | 'projectId' | 'taskId'>> = {}): SseEvent[] {
  return useEventBusStore(
    useShallow((state) =>
      state.events.filter((e) => {
        if (filter.type !== undefined && e.type !== filter.type) return false;
        if (filter.agentId !== undefined && e.agentId !== filter.agentId) return false;
        if (filter.projectId !== undefined && e.projectId !== filter.projectId) return false;
        if (filter.taskId !== undefined && e.taskId !== filter.taskId) return false;
        return true;
      }),
    ),
  );
}
