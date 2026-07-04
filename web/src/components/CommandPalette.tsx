import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useCommandPaletteStore } from '../stores/commandPalette.js';
import { useScopeStore } from '../stores/scope.js';
import { agentsInScope } from '../lib/scope.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PaletteItem {
  id: string;
  label: string;
  category: 'nav' | 'agent' | 'task' | 'skill' | 'action' | 'conversation';
  path?: string;
  params?: Record<string, string>;
  search?: Record<string, string>;
  searchQuery?: string;
  onActivate?: () => void;
}

// ---------------------------------------------------------------------------
// Static nav items
// ---------------------------------------------------------------------------

const NAV_ITEMS: PaletteItem[] = [
  { id: 'nav-overview',   label: 'Overview',   category: 'nav', path: '/overview' },
  { id: 'nav-inbox',      label: 'Inbox',      category: 'nav', path: '/inbox' },
  { id: 'nav-agents',     label: 'Agents',     category: 'nav', path: '/agents' },
  { id: 'nav-tasks',      label: 'Tasks',      category: 'nav', path: '/tasks' },
  { id: 'nav-plans',      label: 'Plans',      category: 'nav', path: '/plans' },
  { id: 'nav-workflows',  label: 'Workflows',  category: 'nav', path: '/workflows' },
  { id: 'nav-goals',      label: 'Goals',      category: 'nav', path: '/goals' },
  { id: 'nav-skills',     label: 'Skills',     category: 'nav', path: '/skills' },
  { id: 'nav-memory',     label: 'Memory',     category: 'nav', path: '/memory' },
  { id: 'nav-metrics',    label: 'Metrics',    category: 'nav', path: '/metrics' },
  { id: 'nav-costs',      label: 'Costs',      category: 'nav', path: '/costs' },
  { id: 'nav-health',     label: 'Health',     category: 'nav', path: '/health' },
  { id: 'nav-traces',     label: 'Traces',     category: 'nav', path: '/traces' },
  { id: 'nav-chat',       label: 'Chat',       category: 'nav', path: '/chat' },
];

// ---------------------------------------------------------------------------
// Match helper (exported for tests)
// ---------------------------------------------------------------------------

export function matchesQuery(label: string, query: string): boolean {
  if (!query) return true;
  return label.toLowerCase().includes(query.toLowerCase());
}

// ---------------------------------------------------------------------------
// Dispatch sub-modal
// ---------------------------------------------------------------------------

function DispatchModal({
  agents,
  onClose,
  onDispatched,
}: {
  agents: Array<{ id: string; name?: string; projectId?: string }>;
  onClose: () => void;
  /** Called with the created task id — the palette navigates to the task. */
  onDispatched?: (taskId: string) => void;
}) {
  // 'auto' = let the SkillRouter pick the best-matching agent based on the
  // task description. Users only override when they know better than the
  // router (retry, deliberate assignment).
  const [agentId, setAgentId] = useState<string>('auto');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Honor the global project scope: only company agents and agents of the
  // selected project are offered. Without this, a scoped operator could
  // accidentally dispatch into a different project.
  const selectedProject = useScopeStore((s) => s.selectedProject);
  const scopedAgents = agentsInScope(agents, selectedProject);

  // The backend's POST /tasks needs a projectId. In auto mode the server
  // derives it from the resolved agent; in pinned mode we send the picked
  // agent's projectId so the dispatch lands in the right scope.
  const selectedAgentProjectId =
    agentId === 'auto' ? undefined : agents.find((a) => a.id === agentId)?.projectId;

  const mutation = useMutation({
    mutationFn: async (body: { agentId?: string; projectId?: string; description: string }) => {
      const res = await fetch('/api/v1/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: (created: { id?: string }) => {
      setError(null);
      onClose();
      // Land the user on the task they just created — the silent close left
      // them guessing whether anything happened (usability report M3).
      if (created?.id) onDispatched?.(created.id);
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Failed to dispatch'),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!agentId || !description.trim()) return;
    mutation.mutate({
      agentId,
      projectId: selectedAgentProjectId,
      description: description.trim(),
    });
  };

  return (
    <div className="border-t border-zinc-800 p-4">
      <h3 className="text-xs font-semibold text-zinc-400 mb-3">Dispatch task</h3>
      <form onSubmit={handleSubmit} className="space-y-3">
        <select
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 outline-none focus:border-indigo-500"
          aria-label="Target agent"
        >
          <option value="auto">✨ Auto — smart route to best-matching agent</option>
          {scopedAgents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name ?? a.id}
            </option>
          ))}
        </select>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Task description…"
          rows={3}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-indigo-500 resize-none"
        />
        {error && (
          <p className="text-xs text-red-400" role="alert">{error}</p>
        )}
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!agentId || !description.trim() || mutation.isPending}
            className="btn-approve text-xs px-3 py-1.5 rounded-lg font-medium disabled:opacity-40"
          >
            {mutation.isPending ? 'Dispatching…' : 'Dispatch'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CommandPalette component
// ---------------------------------------------------------------------------

export function CommandPalette() {
  const { open, query, setOpen, setQuery, initialDispatch } = useCommandPaletteStore();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [showDispatch, setShowDispatch] = useState(false);

  // Fetch agents — API returns a bare array (createAgentsRoute)
  const { data: agentsData } = useQuery<Array<{ id: string; name?: string }> | { agents?: Array<{ id: string; name?: string }> }>({
    queryKey: ['agents'],
    queryFn: () => fetch('/api/v1/agents').then((r) => r.json()),
    staleTime: 30_000,
    enabled: open,
  });

  // Fetch tasks — API returns { tasks, total, page, limit }
  const { data: tasksData } = useQuery<{ tasks?: Array<{ id: string; description?: string }> }>({
    queryKey: ['tasks', 'palette'],
    queryFn: () => fetch('/api/v1/tasks?limit=20').then((r) => r.json()),
    staleTime: 30_000,
    enabled: open,
  });

  // Fetch skills — API returns a bare array
  const { data: skillsData } = useQuery<Array<{ name: string }> | { skills?: Array<{ name: string }> }>({
    queryKey: ['skills'],
    queryFn: () => fetch('/api/v1/skills').then((r) => r.json()),
    staleTime: 30_000,
    enabled: open,
  });

  // Fetch projects for the "switch project" actions — cache-shared with the
  // header ProjectPicker.
  const { data: projectsData } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ['projects'],
    queryFn: () => fetch('/api/v1/projects').then((r) => r.json()),
    staleTime: 60_000,
    enabled: open,
  });

  // Fetch conversations — scope by active project to avoid cross-project leak.
  const selectedProject = useScopeStore((s) => s.selectedProject);
  const setProject = useScopeStore((s) => s.setProject);
  const scopeParam = selectedProject ? `projectId=${encodeURIComponent(selectedProject)}` : 'scope=all';
  const { data: conversationsData } = useQuery<{ conversations?: Array<{ id: string; agentId?: string; agentName?: string }> }>({
    queryKey: ['chat-conversations', 'palette', selectedProject],
    queryFn: () => fetch(`/api/v1/chat/conversations?${scopeParam}`).then((r) => r.json()),
    staleTime: 30_000,
    enabled: open,
  });

  const agents = Array.isArray(agentsData) ? agentsData : (agentsData?.agents ?? []);
  const tasks = tasksData?.tasks ?? [];
  const skills = Array.isArray(skillsData) ? skillsData : (skillsData?.skills ?? []);
  const conversations = conversationsData?.conversations ?? [];

  // Build items list
  const agentItems: PaletteItem[] = agents.map((a) => ({
    id: `agent-${a.id}`,
    label: `Agent: ${a.name ?? a.id}`,
    category: 'agent',
    path: '/agents/$agentId',
    params: { agentId: a.id },
  }));

  const taskItems: PaletteItem[] = tasks.map((t) => {
    const shortHash = String(t.id).slice(0, 8);
    const descPart = t.description ? t.description.slice(0, 40) : '';
    // Include both description and short hash so hash-based search matches.
    const label = descPart ? `Task: ${descPart} [${shortHash}]` : `Task: ${shortHash}`;
    return {
      id: `task-${t.id}`,
      label,
      category: 'task',
      path: '/tasks/$taskId',
      params: { taskId: t.id },
    };
  });

  const skillItems: PaletteItem[] = skills.map((s) => ({
    id: `skill-${s.name}`,
    label: `Skill: ${s.name}`,
    category: 'skill',
    searchQuery: s.name,
  }));

  const conversationItems: PaletteItem[] = conversations.map((c) => ({
    id: `conversation-${c.id}`,
    label: `Conversation: ${c.agentName ?? c.agentId ?? c.id.slice(0, 8)}`,
    category: 'conversation',
    path: '/chat',
    search: { conversationId: c.id },
  }));

  const dispatchItem: PaletteItem = {
    id: 'action-dispatch',
    label: '✦ Dispatch task…',
    category: 'action',
  };

  const projects = Array.isArray(projectsData) ? projectsData : [];
  const scopeItems: PaletteItem[] = [
    ...(selectedProject
      ? [
          {
            id: 'scope-all',
            label: 'Switch project: all projects',
            category: 'action' as const,
            onActivate: () => setProject(null),
          },
        ]
      : []),
    ...projects
      .filter((p) => p.id !== selectedProject)
      .map((p) => ({
        id: `scope-${p.id}`,
        label: `Switch project: ${p.name}`,
        category: 'action' as const,
        onActivate: () => setProject(p.id),
      })),
  ];

  const allItems: PaletteItem[] = [
    ...NAV_ITEMS,
    ...agentItems,
    ...taskItems,
    ...skillItems,
    ...conversationItems,
    dispatchItem,
    ...scopeItems,
  ];

  const filtered = allItems.filter((item) => matchesQuery(item.label, query));

  // Reset active index when filtered list changes
  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  // Focus input when opened. If the open was triggered via openDispatch()
  // (e.g. Overview "+ New task"), jump straight into the dispatch form so
  // the user doesn't have to navigate the option list first.
  useEffect(() => {
    if (open) {
      setShowDispatch(initialDispatch);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open, initialDispatch]);

  const close = useCallback(() => {
    setOpen(false);
    setShowDispatch(false);
  }, [setOpen]);

  const activateItem = useCallback(
    (item: PaletteItem) => {
      if (item.onActivate) {
        item.onActivate();
        close();
        return;
      }
      if (item.category === 'action') {
        setShowDispatch(true);
        return;
      }
      if (item.category === 'skill' && item.searchQuery) {
        void navigate({ to: '/skills', search: { name: item.searchQuery } as never });
        close();
        return;
      }
      if (item.path) {
        const navArgs: Record<string, unknown> = { to: item.path };
        if (item.params) navArgs.params = item.params;
        if (item.search) navArgs.search = item.search;
        void navigate(navArgs as never);
        close();
      }
    },
    [navigate, close],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = filtered[activeIdx];
        if (item) activateItem(item);
      }
    },
    [close, filtered, activeIdx, activateItem],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center pt-[20vh]"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="w-[600px] max-w-[90vw] bg-zinc-900 rounded-xl shadow-2xl border border-zinc-700 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search input — hidden when launched directly into dispatch mode */}
        {!showDispatch && (
          <div className="px-4 py-3 border-b border-zinc-800">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search commands, routes, agents, tasks…"
              className="w-full bg-transparent text-sm text-zinc-100 placeholder-zinc-500 outline-none"
              autoComplete="off"
            />
          </div>
        )}

        {/* Results */}
        {!showDispatch && (
          <div ref={listRef} className="max-h-[360px] overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="text-xs text-zinc-500 text-center py-6">No results</p>
            ) : (
              filtered.map((item, idx) => (
                <button
                  key={item.id}
                  onClick={() => activateItem(item)}
                  className={`w-full text-left px-4 py-2.5 flex items-center gap-3 text-sm transition-colors ${
                    idx === activeIdx
                      ? 'bg-indigo-500/20 text-indigo-200'
                      : 'text-zinc-300 hover:bg-zinc-800/60'
                  }`}
                >
                  <span className="text-[10px] uppercase tracking-wider text-zinc-600 w-12 flex-shrink-0">
                    {item.category}
                  </span>
                  <span className="flex-1 truncate">{item.label}</span>
                </button>
              ))
            )}
          </div>
        )}

        {/* Dispatch sub-modal */}
        {showDispatch && (
          <DispatchModal
            agents={agents}
            onClose={close}
            onDispatched={(taskId) => {
              void navigate({ to: '/tasks/$taskId', params: { taskId } } as never);
            }}
          />
        )}

        {/* Footer hint */}
        {!showDispatch && (
          <div className="border-t border-zinc-800 px-4 py-2 flex gap-4 text-[11px] text-zinc-600">
            <span>↑↓ navigate</span>
            <span>↵ select</span>
            <span>esc close</span>
          </div>
        )}
      </div>
    </div>
  );
}
