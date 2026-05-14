import { defineConfig, presetUno } from 'unocss';

export default defineConfig({
  presets: [presetUno({ dark: 'class' })],
  theme: {
    colors: {
      surface: {
        DEFAULT: '#18181b',
        subtle: '#27272a',
      },
    },
  },
  shortcuts: {
    'btn-approve':
      'bg-emerald-600/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 hover:border-emerald-500/50 rounded px-2.5 py-1 text-xs font-medium transition-colors',
    'btn-secondary':
      'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded px-2.5 py-1 text-xs transition-colors',
  },
});
