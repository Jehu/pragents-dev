import { createRootRoute, Outlet, Link } from '@tanstack/react-router';
import { useThemeStore } from '../stores/theme';

function ThemeToggle() {
  const { dark, toggle } = useThemeStore();
  return (
    <button
      onClick={toggle}
      className="text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {dark ? '☀️' : '🌙'}
    </button>
  );
}

export const Route = createRootRoute({
  component: () => (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <h1 className="text-lg font-bold">pragents</h1>
          <nav className="flex gap-4 text-sm">
            <Link to="/" className="hover:text-blue-600 transition-colors">Dashboard</Link>
            <Link to="/feed" className="hover:text-blue-600 transition-colors">Feed</Link>
            <Link to="/memory" className="hover:text-blue-600 transition-colors">Memory</Link>
            <Link to="/traces" className="hover:text-blue-600 transition-colors">Traces</Link>
            <Link to="/tasks" className="hover:text-blue-600 transition-colors">Tasks</Link>
          </nav>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
          <ThemeToggle />
          <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
          connected
        </div>
      </header>
      <main className="p-6">
        <Outlet />
      </main>
    </div>
  ),
});
