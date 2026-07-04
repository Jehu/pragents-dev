import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface NavStore {
  /** Group label → collapsed. Absent means expanded (the default). */
  collapsedGroups: Record<string, boolean>;
  toggleGroup: (group: string) => void;
}

/**
 * Collapse state for the sidebar's collapsible nav groups (currently only
 * "Observe"). Persisted so a collapsed group stays collapsed across reloads,
 * and shared by store rather than local state because the sidebar renders in
 * two places at once (desktop rail + mobile drawer).
 */
export const useNavStore = create<NavStore>()(
  persist(
    (set) => ({
      collapsedGroups: {},
      toggleGroup: (group) =>
        set((s) => ({
          collapsedGroups: { ...s.collapsedGroups, [group]: !s.collapsedGroups[group] },
        })),
    }),
    { name: 'pragents-nav' },
  ),
);
