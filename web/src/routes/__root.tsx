import { createRootRoute, Outlet } from '@tanstack/react-router';

export const Route = createRootRoute({
  component: () => (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between" data-block="header">
        <div className="flex items-center gap-6">
          <h1 className="text-lg font-bold">pragents</h1>
          <nav className="flex gap-4 text-sm">
            <a href="/" className="hover:text-blue-600 transition-colors">Dashboard</a>
            <a href="/traces" className="hover:text-blue-600 transition-colors">Traces</a>
            <a href="/tasks" className="hover:text-blue-600 transition-colors">Tasks</a>
          </nav>
        </div>
        <div className="flex items-center gap-3 text-xs text-gray-500">
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
