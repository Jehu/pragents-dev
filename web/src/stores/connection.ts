import { create } from 'zustand';

interface ConnectionStore {
  connected: boolean;
  setConnected: (v: boolean) => void;
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
  connected: false,
  setConnected: (v: boolean) => set({ connected: v }),
}));
