import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MasterDetail, ApprovalCard } from '../../components/ui/index.js';
import { useEventBusStore } from '../../stores/eventBus.js';
import { useScopeStore } from '../../stores/scope.js';
import { agentsInScope } from '../../lib/scope.js';

/** Build the URL-query suffix carrying the active project scope.
 *  - selectedProject set → ?projectId=X
 *  - selectedProject null → ?scope=all (explicit cross-project intent) */
function scopeQuery(selectedProject: string | null): string {
  return selectedProject ? `projectId=${encodeURIComponent(selectedProject)}` : 'scope=all';
}

// ---------------------------------------------------------------------------
// Route definition
// ---------------------------------------------------------------------------

export const Route = createFileRoute('/chat/')({
  validateSearch: (search: Record<string, unknown>) => ({
    conversationId: typeof search.conversationId === 'string' ? search.conversationId : undefined,
    agentId: typeof search.agentId === 'string' ? search.agentId : undefined,
  }),
  component: ChatPage,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Conversation {
  id: string;
  agentId?: string;
  agentName?: string;
  lastMessage?: string;
  updatedAt?: string;
}

export type MessageSubtype = 'text' | 'plan_proposal' | 'status' | 'error_message';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  subtype: MessageSubtype;
  content: string;
  planId?: string;
  plan?: {
    steps: Array<{ description: string; agentId: string; dependsOn?: number }>;
  };
  /** Resolved plan lifecycle status for plan_proposal messages.
   *  'pending' = waiting for user decision (default)
   *  'approving' = optimistic local state after click, before SSE confirmation
   *  'approved' / 'cancelled' = confirmed via plan.approved / plan.cancelled SSE event */
  planStatus?: 'pending' | 'approving' | 'approved' | 'cancelled';
  streaming?: boolean;
}

// ---------------------------------------------------------------------------
// SSE envelope parser (exported for tests)
// ---------------------------------------------------------------------------

export function parseSSELine(line: string): { type: string; data: unknown } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(':')) return null;
  if (!trimmed.startsWith('data:')) return null;
  const raw = trimmed.slice(5).trim();
  try {
    return JSON.parse(raw) as { type: string; data: unknown };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(iso?: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function escapeMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Conversation list (left sidebar)
// ---------------------------------------------------------------------------

function ConversationList({
  conversations,
  activeId,
  agentId,
  onSelect,
  onNew,
}: {
  conversations: Conversation[];
  activeId?: string;
  agentId?: string;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const filtered = agentId
    ? conversations.filter((c) => c.agentId === agentId)
    : conversations;

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-zinc-800 flex-shrink-0">
        <button
          onClick={onNew}
          className="w-full text-xs px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
        >
          + New conversation
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="text-xs text-zinc-500 p-4 text-center">No conversations yet</p>
        ) : (
          filtered.map((conv) => (
            <button
              key={conv.id}
              onClick={() => onSelect(conv.id)}
              className={`w-full text-left px-3 py-2.5 border-b border-zinc-800/50 hover:bg-zinc-800/40 transition-colors ${
                activeId === conv.id ? 'bg-indigo-500/20 border-l-2 border-l-indigo-400' : ''
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-zinc-200 truncate">
                  {conv.agentName ?? conv.agentId ?? 'Unknown agent'}
                </span>
                <span className="text-[11px] text-zinc-500 flex-shrink-0">
                  {relativeTime(conv.updatedAt)}
                </span>
              </div>
              {conv.lastMessage && (
                <p className="text-[11px] text-zinc-500 truncate mt-0.5">{conv.lastMessage}</p>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Message bubble
// ---------------------------------------------------------------------------

function MessageBubble({
  msg,
  onApprovePlan,
}: {
  msg: ChatMessage;
  onApprovePlan?: (planId: string) => void;
}) {
  if (msg.subtype === 'status') {
    return (
      <div className="flex justify-center py-1">
        <span className="text-[11px] text-zinc-500 font-mono italic">{msg.content}</span>
      </div>
    );
  }

  if (msg.subtype === 'error_message') {
    return (
      <div className="mx-4 my-1 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg">
        <p className="text-xs text-red-400">{msg.content}</p>
      </div>
    );
  }

  if (msg.subtype === 'plan_proposal') {
    return (
      <div className="mx-4 my-2">
        <ApprovalCard
          variant="plan"
          title="Plan proposal"
          body={
            msg.plan?.steps ? (
              <ol className="list-decimal list-inside space-y-0.5 mt-1">
                {msg.plan.steps.map((s, i) => (
                  <li key={i} className="text-zinc-400">
                    {s.description}
                    <span className="text-zinc-600 ml-1">({s.agentId})</span>
                  </li>
                ))}
              </ol>
            ) : (
              <span>{msg.content}</span>
            )
          }
          disabled={msg.planStatus !== undefined && msg.planStatus !== 'pending'}
          status={msg.planStatus}
          onApprove={() => msg.planId && onApprovePlan?.(msg.planId)}
        />
      </div>
    );
  }

  // Default: text bubble
  const isUser = msg.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} px-4 py-1`}>
      <div
        className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
          isUser
            ? 'bg-indigo-600 text-white rounded-br-sm'
            : 'bg-zinc-800 text-zinc-100 rounded-bl-sm'
        }`}
      >
        <pre
          className="whitespace-pre-wrap font-sans text-sm"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: escapeMarkdown(msg.content) + (msg.streaming ? '▍' : ''),
          }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thread panel (right side)
// ---------------------------------------------------------------------------

function ThreadPanel({
  conversationId,
  agentId,
  availableAgents,
  onPickDraftAgent,
  onConversationCreated,
}: {
  conversationId?: string;
  agentId?: string;
  availableAgents: Array<{ id: string; name?: string }>;
  onPickDraftAgent: (id: string) => void;
  onConversationCreated: (id: string) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [activeConvId, setActiveConvId] = useState(conversationId);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const selectedProject = useScopeStore((s) => s.selectedProject);

  const [historyState, setHistoryState] = useState<'idle' | 'loading' | 'error'>('idle');

  // SSE event-bus subscription for plan lifecycle updates.
  const busEvents = useEventBusStore((s) => s.events);
  useEffect(() => {
    const latest = busEvents[busEvents.length - 1];
    if (!latest || typeof latest.type !== 'string') return;
    if (latest.type !== 'plan.approved' && latest.type !== 'plan.cancelled') return;
    const planId = (latest.data as { planId?: string } | undefined)?.planId;
    if (!planId) return;
    setMessages((prev) =>
      prev.map((m) =>
        m.subtype === 'plan_proposal' && m.planId === planId
          ? { ...m, planStatus: latest.type === 'plan.approved' ? 'approved' : 'cancelled' }
          : m,
      ),
    );
  }, [busEvents]);

  const setPlanStatus = useCallback((planId: string, planStatus: ChatMessage['planStatus']) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.subtype === 'plan_proposal' && m.planId === planId ? { ...m, planStatus } : m,
      ),
    );
  }, []);

  const handleApprovePlan = useCallback(
    (planId: string) => {
      // Optimistic: hide buttons immediately, then fire the POST.
      setPlanStatus(planId, 'approving');
      fetch(`/api/v1/plans/${planId}/approve`, { method: 'POST' })
        .then((res) => {
          // 200/201/202: server accepted — wait for SSE plan.approved.
          // 409: already approved on a previous attempt (or another tab) —
          //      promote optimistic state to 'approved'; SSE may also fire.
          // 4xx other: validation problem — revert so the user can try again.
          // 5xx / network: log and revert; SSE may still rescue, but the UX
          //      shouldn't strand the user on 'approving' forever.
          if (res.ok) return;
          if (res.status === 409) {
            setPlanStatus(planId, 'approved');
            return;
          }
          // eslint-disable-next-line no-console
          console.warn(`Plan ${planId} approve returned ${res.status} — reverting`);
          setPlanStatus(planId, 'pending');
        })
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.warn(`Plan ${planId} approve failed`, err);
          setPlanStatus(planId, 'pending');
        });
    },
    [setPlanStatus],
  );

  // Sync when outer conversationId changes (user picks a different convo) +
  // load the conversation's prior messages.
  useEffect(() => {
    setActiveConvId(conversationId);
    setMessages([]);
    if (!conversationId) {
      setHistoryState('idle');
      return;
    }

    const ctrl = new AbortController();
    setHistoryState('loading');
    fetch(`/api/v1/chat/conversations/${encodeURIComponent(conversationId)}/messages?${scopeQuery(selectedProject)}`, {
      signal: ctrl.signal,
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: { messages?: Array<{ id?: string; role: string; content: string; type?: string; createdAt?: string }> }) => {
        const rows = data.messages ?? [];
        const loaded: ChatMessage[] = rows.map((m, i) => ({
          id: m.id ? String(m.id) : `hist-${i}`,
          role: m.role === 'user' ? 'user' : 'assistant',
          subtype: (m.type as ChatMessage['subtype']) ?? 'text',
          content: m.content,
        }));
        setMessages(loaded);
        setHistoryState('idle');
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setHistoryState('error');
      });

    return () => ctrl.abort();
  }, [conversationId, selectedProject]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    setInput('');
    setStreaming(true);

    // Append user message
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      subtype: 'text',
      content: text,
    };
    setMessages((prev) => [...prev, userMsg]);

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      // Scope the conversation to a project: project agents pin their own
      // project (agent ids are "type@projectId"), company agents inherit the
      // active picker scope. Without this, conversations were stored with
      // project_id NULL and never showed up in any scoped list.
      const agentProject = agentId?.includes('@') ? agentId.split('@')[1] : undefined;
      const conversationProjectId =
        agentProject && agentProject !== 'company' ? agentProject : selectedProject ?? undefined;

      const res = await fetch('/api/v1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          conversationId: activeConvId,
          agentId,
          ...(conversationProjectId ? { projectId: conversationProjectId } : {}),
        }),
        signal: ctrl.signal,
      });

      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const assistantMsgId = `asst-${Date.now()}`;
      let assistantStarted = false;

      const upsertAssistantMsg = (partial: Partial<ChatMessage> & { id: string }) => {
        if (!assistantStarted) {
          assistantStarted = true;
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', subtype: 'text', content: '', streaming: true, ...partial },
          ]);
        } else {
          setMessages((prev) =>
            prev.map((m) => (m.id === partial.id ? { ...m, ...partial } : m)),
          );
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const parsed = parseSSELine(line);
          if (!parsed) continue;

          type RawData = {
            subtype?: string;
            content?: string;
            message?: string;
            tool?: string;
            code?: string;
            conversationId?: string;
            planId?: string;
            plan?: { steps: Array<{ description: string; agentId: string }> };
          };

          const evt = parsed as { type: string; data: RawData };

          if (evt.type === 'done') {
            if (evt.data.conversationId && !activeConvId) {
              const newId = evt.data.conversationId;
              setActiveConvId(newId);
              onConversationCreated(newId);
            }
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantMsgId ? { ...m, streaming: false } : m)),
            );
          } else if (evt.type === 'message') {
            const subtype = (evt.data.subtype ?? 'text') as MessageSubtype;
            const content = evt.data.content ?? '';

            if (subtype === 'text') {
              upsertAssistantMsg({ id: assistantMsgId, content, streaming: true });
            } else if (subtype === 'status') {
              setMessages((prev) => [
                ...prev,
                { id: `status-${Date.now()}`, role: 'assistant', subtype: 'status', content },
              ]);
            } else if (subtype === 'error_message') {
              setMessages((prev) => [
                ...prev,
                { id: `err-${Date.now()}`, role: 'assistant', subtype: 'error_message', content },
              ]);
            } else if (subtype === 'plan_proposal') {
              setMessages((prev) => [
                ...prev,
                {
                  id: `plan-${Date.now()}`,
                  role: 'assistant',
                  subtype: 'plan_proposal',
                  content,
                  planId: evt.data.planId,
                  plan: evt.data.plan,
                },
              ]);
            }
          } else if (evt.type === 'thinking') {
            setMessages((prev) => [
              ...prev,
              {
                id: `status-${Date.now()}`,
                role: 'assistant',
                subtype: 'status',
                content: evt.data.message ?? 'thinking…',
              },
            ]);
          } else if (evt.type === 'tool_call') {
            setMessages((prev) => [
              ...prev,
              {
                id: `status-${Date.now()}`,
                role: 'assistant',
                subtype: 'status',
                content: `executing tool: ${evt.data.tool ?? ''}`,
              },
            ]);
          } else if (evt.type === 'error') {
            setMessages((prev) => [
              ...prev,
              {
                id: `err-${Date.now()}`,
                role: 'assistant',
                subtype: 'error_message',
                content: evt.data.message ?? 'An error occurred',
              },
            ]);
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: 'assistant',
            subtype: 'error_message',
            content: String(err),
          },
        ]);
      }
    } finally {
      setStreaming(false);
    }
  }, [input, streaming, activeConvId, agentId, selectedProject, onConversationCreated]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  const needsAgentPick = !conversationId && !agentId;
  const showDraftAgentHeader = !conversationId && agentId;

  return (
    <div className="flex flex-col h-full">
      {/* Draft-conversation header — shows the picked agent above the input */}
      {showDraftAgentHeader && (
        <div className="px-3 py-2 border-b border-zinc-800 flex items-center gap-2 text-xs text-zinc-400">
          <span>Drafting conversation with</span>
          <span className="font-mono text-zinc-100">
            {availableAgents.find((a) => a.id === agentId)?.name ?? agentId}
          </span>
          <button
            type="button"
            onClick={() => onPickDraftAgent('')}
            className="ml-auto text-[11px] text-zinc-500 hover:text-zinc-300"
          >
            change…
          </button>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-4 space-y-1">
        {historyState === 'loading' && messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-zinc-500">Loading history…</p>
          </div>
        ) : historyState === 'error' && messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-red-400">Failed to load conversation history.</p>
          </div>
        ) : messages.length === 0 && needsAgentPick ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <p className="text-sm text-zinc-400 mb-3">Pick an agent to talk to</p>
              {availableAgents.length === 0 ? (
                <p className="text-xs text-zinc-500">No agents configured.</p>
              ) : (
                <ul role="listbox" aria-label="Available agents" className="flex flex-col gap-1 max-w-xs mx-auto">
                  {availableAgents.map((a) => (
                    <li key={a.id} role="option" aria-selected="false">
                      <button
                        type="button"
                        onClick={() => onPickDraftAgent(a.id)}
                        className="w-full text-left text-sm px-3 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100"
                      >
                        <span className="font-mono">{a.id}</span>
                        {a.name && <span className="ml-2 text-zinc-500">{a.name}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-zinc-500">Start a conversation below</p>
          </div>
        ) : (
          messages.map((msg) => (
            <MessageBubble key={msg.id} msg={msg} onApprovePlan={handleApprovePlan} />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-zinc-800 p-3 flex-shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message an agent… (Enter to send, Shift+Enter for newline)"
            rows={2}
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-indigo-500 resize-none min-h-[60px]"
          />
          <button
            onClick={() => void sendMessage()}
            disabled={streaming || !input.trim() || needsAgentPick}
            className="btn-approve px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40 flex-shrink-0 self-end"
            title={needsAgentPick ? 'Pick an agent first' : undefined}
          >
            {streaming ? '…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function ChatPage() {
  const qc = useQueryClient();
  const search = Route.useSearch();
  const [activeConvId, setActiveConvId] = useState<string | undefined>(search.conversationId);
  const [draftAgentId, setDraftAgentId] = useState<string | undefined>(search.agentId);
  const agentId = activeConvId ? undefined : draftAgentId;
  const selectedProject = useScopeStore((s) => s.selectedProject);

  const { data } = useQuery<{ conversations?: Conversation[] }>({
    queryKey: ['chat-conversations', selectedProject],
    queryFn: () => fetch(`/api/v1/chat/conversations?${scopeQuery(selectedProject)}`).then((r) => r.json()),
    staleTime: 30_000,
  });

  // Agent display-name resolution for the sidebar — /api/v1/agents returns a
  // bare array (see U15 / F-6). Cache hits avoid re-fetching when the palette
  // is also open.
  const { data: agentsRaw } = useQuery<Array<{ id: string; name?: string; projectId?: string }> | { agents?: Array<{ id: string; name?: string; projectId?: string }> }>({
    queryKey: ['agents'],
    queryFn: () => fetch('/api/v1/agents').then((r) => r.json()),
    staleTime: 30_000,
  });
  const agentList: Array<{ id: string; name?: string; projectId?: string }> = Array.isArray(agentsRaw)
    ? agentsRaw
    : (agentsRaw?.agents ?? []);
  // The "pick an agent to talk to" list honors the global project scope
  // (company agents + agents of the selected project).
  const pickableAgents = agentsInScope(agentList, selectedProject);

  const conversationsRaw = data?.conversations ?? [];
  // Enrich each conversation with an agentName by joining against the agents list.
  const conversations: Conversation[] = conversationsRaw.map((c) => ({
    ...c,
    agentName: c.agentName ?? agentList.find((a) => a.id === c.agentId)?.name ?? c.agentId,
  }));

  const handleSelect = (id: string) => {
    setActiveConvId(id);
  };

  const handleNew = () => {
    setActiveConvId(undefined);
    setDraftAgentId(undefined); // re-open the agent picker
  };

  const handleDraftAgentPick = (id: string) => setDraftAgentId(id);

  const handleConversationCreated = (id: string) => {
    setActiveConvId(id);
    qc.invalidateQueries({ queryKey: ['chat-conversations'] });
  };

  return (
    <MasterDetail
      sidebar={
        <ConversationList
          conversations={conversations}
          activeId={activeConvId}
          agentId={agentId}
          onSelect={handleSelect}
          onNew={handleNew}
        />
      }
      sidebarWidth="w-56"
      className="h-full"
    >
      <ThreadPanel
        conversationId={activeConvId}
        agentId={agentId}
        availableAgents={pickableAgents}
        onPickDraftAgent={handleDraftAgentPick}
        onConversationCreated={handleConversationCreated}
      />
    </MasterDetail>
  );
}
