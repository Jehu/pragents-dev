import { create } from 'zustand';

interface ThemeStore {
  dark: boolean;
  toggle: () => void;
}

const getInitial = (): boolean => {
  if (typeof window === 'undefined') return false;
  const stored = localStorage.getItem('theme');
  if (stored === 'dark') return true;
  if (stored === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
};

export const useThemeStore = create<ThemeStore>((set) => ({
  dark: getInitial(),
  toggle: () =>
    set((state) => {
      const next = !state.dark;
      localStorage.setItem('theme', next ? 'dark' : 'light');
      document.documentElement.classList.toggle('dark', next);
      return { dark: next };
    }),
}));

// Initialize on load
if (typeof window !== 'undefined') {
  const dark = getInitial();
  document.documentElement.classList.toggle('dark', dark);
}
