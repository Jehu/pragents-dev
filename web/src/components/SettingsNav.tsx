import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

/**
 * In-page section navigation for `/settings` (scrollspy + unsaved indicators).
 *
 * Sections keep their independent Save buttons and conflict handling — the
 * nav only adds orientation: click-to-scroll anchors, the currently visible
 * section highlighted, and an amber dot for any section with unsaved changes
 * (mirroring the dot in the section header, so dirty state is visible even
 * when the section is scrolled out of view).
 */

export interface SettingsNavEntry {
  /** DOM id of the target section (SettingsSection renders its testId as id). */
  id: string;
  label: string;
}

interface DirtyRegistry {
  report: (id: string, dirty: boolean) => void;
  dirtyMap: Record<string, boolean>;
}

const SettingsDirtyContext = createContext<DirtyRegistry | null>(null);

/** Provider that collects per-section dirty flags; wrap the settings page with it. */
export function SettingsDirtyProvider({ children }: { children: React.ReactNode }) {
  const [dirtyMap, setDirtyMap] = useState<Record<string, boolean>>({});
  const report = useCallback((id: string, dirty: boolean) => {
    setDirtyMap((prev) => (prev[id] === dirty ? prev : { ...prev, [id]: dirty }));
  }, []);
  return (
    <SettingsDirtyContext.Provider value={{ report, dirtyMap }}>
      {children}
    </SettingsDirtyContext.Provider>
  );
}

/** Used by SettingsSection to report its dirty flag. No-op outside the provider. */
export function useReportSectionDirty(id: string | undefined, dirty: boolean): void {
  const ctx = useContext(SettingsDirtyContext);
  const report = ctx?.report;
  useEffect(() => {
    if (!id || !report) return;
    report(id, dirty);
    return () => report(id, false);
  }, [id, dirty, report]);
}

export function SettingsNav({ entries }: { entries: SettingsNavEntry[] }) {
  const ctx = useContext(SettingsDirtyContext);
  const [activeId, setActiveId] = useState<string | null>(entries[0]?.id ?? null);

  // Scrollspy — highlight the section currently in the reading zone.
  // Guarded: jsdom (tests) has no IntersectionObserver.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    if (entries.length === 0) return;

    // Locate the scroll container (the app scrolls <main>, not the window).
    const firstEl = document.getElementById(entries[0].id);
    let scrollEl: HTMLElement | null = firstEl?.parentElement ?? null;
    while (scrollEl && scrollEl.scrollHeight <= scrollEl.clientHeight) {
      scrollEl = scrollEl.parentElement;
    }

    const visible = new Map<string, number>();

    // Single source of truth for the active entry: at the very bottom the
    // last entry wins (it can never reach the reading zone — there is
    // nothing left to scroll); otherwise the first visible section wins.
    const computeActive = () => {
      const atBottom = scrollEl
        ? scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 4
        : window.innerHeight + window.scrollY >= document.body.scrollHeight - 4;
      if (atBottom) {
        setActiveId(entries[entries.length - 1].id);
        return;
      }
      const firstVisible = entries.find((en) => visible.has(en.id));
      if (firstVisible) setActiveId(firstVisible.id);
    };

    const observer = new IntersectionObserver(
      (obsEntries) => {
        for (const e of obsEntries) {
          if (e.isIntersecting) visible.set(e.target.id, e.intersectionRatio);
          else visible.delete(e.target.id);
        }
        computeActive();
      },
      // Reading zone: a band starting near the top of the scroll viewport.
      { rootMargin: '-10% 0px -60% 0px', threshold: [0, 0.1] },
    );
    for (const en of entries) {
      const el = document.getElementById(en.id);
      if (el) observer.observe(el);
    }

    const scrollTarget: HTMLElement | Window = scrollEl ?? window;
    scrollTarget.addEventListener('scroll', computeActive, { passive: true });

    return () => {
      observer.disconnect();
      scrollTarget.removeEventListener('scroll', computeActive);
    };
  }, [entries]);

  return (
    <nav aria-label="Settings sections" data-testid="settings-nav" className="text-xs">
      <ul className="space-y-0.5">
        {entries.map((en) => {
          const active = activeId === en.id;
          const dirty = ctx?.dirtyMap[en.id] ?? false;
          return (
            <li key={en.id}>
              <a
                href={`#${en.id}`}
                aria-current={active ? 'true' : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  setActiveId(en.id);
                  document.getElementById(en.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded transition-colors ${
                  active
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                }`}
              >
                <span className="truncate">{en.label}</span>
                {dirty && (
                  <span
                    aria-label={`${en.label}: unsaved changes`}
                    className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0 ml-auto"
                  />
                )}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
