import { create } from 'zustand';

interface CommandPaletteState {
  open: boolean;
  query: string;
  /** When true, the palette skips the option list and renders the dispatch
   *  form directly. Used by the Overview "+ New task" button so the user
   *  doesn't have to type "dispatch" first. Reset to false when the palette
   *  closes. */
  initialDispatch: boolean;
  setOpen: (open: boolean) => void;
  setQuery: (query: string) => void;
  toggle: () => void;
  openDispatch: () => void;
}

export const useCommandPaletteStore = create<CommandPaletteState>((set, get) => ({
  open: false,
  query: '',
  initialDispatch: false,
  setOpen: (open) => set({ open, query: open ? get().query : '', initialDispatch: open ? get().initialDispatch : false }),
  setQuery: (query) => set({ query }),
  toggle: () => {
    const next = !get().open;
    set({ open: next, query: next ? '' : get().query, initialDispatch: next ? get().initialDispatch : false });
  },
  openDispatch: () => set({ open: true, initialDispatch: true, query: '' }),
}));
