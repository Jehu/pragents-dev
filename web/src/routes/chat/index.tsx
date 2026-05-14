import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MasterDetail, ApprovalCard } from '../../components/ui/index.js';

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

function MessageBubble({ msg }: { msg: ChatMessage }) {
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
          onApprove={() => {
            if (msg.planId) {
              fetch(`/api/v1/plans/${msg.planId}/approve`, { method: 'POST' }).catch(() => {});
            }
          }}
          onReject={() => {}}
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
  onConversationCreated,
}: {
  conversationId?: string;
  agentId?: string;
  onConversationCreated: (id: string) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [activeConvId, setActiveConvId] = useState(conversationId);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Sync when outer conversationId changes (user picks a different convo)
  useEffect(() => {
    setActiveConvId(conversationId);
    setMessages([]);
  }, [conversationId]);

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
      const res = await fetch('/api/v1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          conversationId: activeConvId,
          agentId,
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
  }, [input, streaming, activeConvId, agentId, onConversationCreated]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-4 space-y-1">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-zinc-500">Start a conversation below</p>
          </div>
        ) : (
          messages.map((msg) => <MessageBubble key={msg.id} msg={msg} />)
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
            disabled={streaming || !input.trim()}
            className="btn-approve px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40 flex-shrink-0 self-end"
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
  const agentId = search.agentId;
  const [activeConvId, setActiveConvId] = useState<string | undefined>(search.conversationId);

  const { data } = useQuery<{ conversations?: Conversation[] }>({
    queryKey: ['chat-conversations'],
    queryFn: () => fetch('/api/v1/chat/conversations').then((r) => r.json()),
    staleTime: 30_000,
  });

  const conversations = data?.conversations ?? [];

  const handleSelect = (id: string) => {
    setActiveConvId(id);
  };

  const handleNew = () => {
    setActiveConvId(undefined);
  };

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
        onConversationCreated={handleConversationCreated}
      />
    </MasterDetail>
  );
}
