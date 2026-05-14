import React from 'react';

interface MasterDetailProps {
  sidebar: React.ReactNode;
  children: React.ReactNode;
  sidebarWidth?: string;
  className?: string;
}

export function MasterDetail({
  sidebar,
  children,
  sidebarWidth = 'w-64',
  className = '',
}: MasterDetailProps) {
  return (
    <div className={`flex h-full overflow-hidden ${className}`}>
      <aside className={`${sidebarWidth} flex-shrink-0 border-r border-zinc-800 overflow-y-auto bg-zinc-900/50`}>
        {sidebar}
      </aside>
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
