import { create } from 'zustand';

interface FeedFilters {
  project?: string;
  agent?: string;
  intent?: string; // 'gates' | 'review' | 'blocked' | 'completed'
}

interface FeedStore {
  filters: FeedFilters;
  setFilter: (key: keyof FeedFilters, value: string | undefined) => void;
  clearFilters: () => void;
}

export const useFeedStore = create<FeedStore>((set) => ({
  filters: {},
  setFilter: (key, value) =>
    set((state) => ({ filters: { ...state.filters, [key]: value || undefined } })),
  clearFilters: () => set({ filters: {} }),
}));
