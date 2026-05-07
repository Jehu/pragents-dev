import { create } from 'zustand';
import { connectSSE, disconnectSSE, isSSEAvailable } from '../hooks/useSSE';
import { connectWebSocket, disconnectWebSocket } from '../hooks/useWebSocket';

type EventCallback = (event: any) => void;

interface ConnectionStore {
  connected: boolean;
  transport: 'none' | 'sse' | 'websocket';
  setConnected: (v: boolean) => void;
  connect: (onEvent?: EventCallback, project?: string) => void;
  disconnect: () => void;
}

export const useConnectionStore = create<ConnectionStore>((set, get) => ({
  connected: false,
  transport: 'none',

  setConnected: (v: boolean) => set({ connected: v }),

  connect: (onEvent?: EventCallback, project?: string) => {
    const callbacks = {
      onEvent,
      onConnect: () => set({ connected: true }),
      onDisconnect: () => set({ connected: false }),
    };

    if (isSSEAvailable()) {
      // Prefer SSE — simpler, auto-reconnect, firewall-friendly
      connectSSE({ ...callbacks, project });
      set({ transport: 'sse' });
    } else {
      // Fallback to WebSocket
      connectWebSocket(onEvent);
      set({ transport: 'websocket' });
    }
  },

  disconnect: () => {
    const { transport } = get();
    if (transport === 'sse') {
      disconnectSSE();
    } else {
      disconnectWebSocket();
    }
    set({ connected: false, transport: 'none' });
  },
}));
