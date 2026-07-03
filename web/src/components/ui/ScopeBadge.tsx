import React from 'react';
import { useScopeStore } from '../../stores/scope.js';

/**
 * Small chip marking a surface as company-wide, i.e. NOT affected by the
 * global project picker. Rendered only while a project is selected, so
 * scoped and unscoped data are never silently mixed.
 *
 * Company-level surfaces (no project linkage in the data model): goals,
 * workflow registry + runs, human gates, skills.
 */
export function CompanyWideBadge({ className = '' }: { className?: string }) {
  const selectedProject = useScopeStore((s) => s.selectedProject);
  if (!selectedProject) return null;
  return (
    <span
      title="Company-wide — not affected by the project filter"
      className={`inline-flex items-center text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 border border-zinc-700 ${className}`}
    >
      company-wide
    </span>
  );
}
