import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ScopeStore {
  selectedProject: string | null;
  selectedAgent: string | null;
  setProject: (id: string | null) => void;
  setAgent: (id: string | null) => void;
}

export const useScopeStore = create<ScopeStore>()(
  persist(
    (set) => ({
      selectedProject: null,
      selectedAgent: null,
      setProject: (id) => set({ selectedProject: id, selectedAgent: null }),
      setAgent: (id) => set({ selectedAgent: id }),
    }),
    {
      name: 'pragents-scope',
      // Only the project scope survives reloads; selectedAgent is transient
      // UI state. A persisted id may reference a since-deleted project —
      // ProjectPicker resets it once the authoritative list has loaded.
      partialize: (s) => ({ selectedProject: s.selectedProject }),
    },
  ),
);
