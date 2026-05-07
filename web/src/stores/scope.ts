import { create } from 'zustand';

interface ScopeStore {
  selectedProject: string | null;
  selectedAgent: string | null;
  setProject: (id: string | null) => void;
  setAgent: (id: string | null) => void;
}

export const useScopeStore = create<ScopeStore>((set) => ({
  selectedProject: null,
  selectedAgent: null,
  setProject: (id) => set({ selectedProject: id, selectedAgent: null }),
  setAgent: (id) => set({ selectedAgent: id }),
}));
