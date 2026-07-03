import React, { useState } from 'react';

/**
 * Editor for the per-agent platform-tool policy (`tools: { allow, deny }`).
 * Deny always wins; a non-empty allow-list is exclusive; both empty = every
 * tool permitted. Mirrors the semantics enforced in ToolExecutor.execute.
 */

export interface ToolPolicyValue {
  allow: string[];
  deny: string[];
}

/** The M6 platform tools (see server/src/agents/tool-definitions.ts). */
export const KNOWN_TOOLS = [
  'query_tasks', 'create_task',
  'run_workflow', 'list_workflows', 'get_workflow_runs',
  'approve_gate', 'reject_gate', 'list_pending_gates', 'list_pending_attention',
  'search_memory', 'remember_fact', 'delete_fact',
  'list_skills', 'get_cost_summary', 'list_agents',
  'list_goals', 'get_goal_runs', 'list_events', 'decompose_task',
] as const;

/** Build the payload fragment: undefined when the policy is empty (= all tools). */
export function buildToolsPayload(
  value?: Partial<ToolPolicyValue>,
): { allow?: string[]; deny?: string[] } | undefined {
  const allow = value?.allow ?? [];
  const deny = value?.deny ?? [];
  const out: { allow?: string[]; deny?: string[] } = {};
  if (allow.length > 0) out.allow = allow;
  if (deny.length > 0) out.deny = deny;
  return Object.keys(out).length > 0 ? out : undefined;
}

function TagListInput({
  label,
  tags,
  onAdd,
  onRemove,
  disabled,
  listId,
  tone,
}: {
  label: string;
  tags: string[];
  onAdd: (raw: string) => void;
  onRemove: (tag: string) => void;
  disabled?: boolean;
  listId: string;
  tone: 'allow' | 'deny';
}) {
  const [input, setInput] = useState('');
  const chipClass =
    tone === 'deny'
      ? 'bg-red-500/10 text-red-300 border-red-500/30'
      : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30';

  return (
    <div>
      <span className="block text-[11px] text-zinc-400 mb-1">{label}</span>
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {tags.map((tag) => (
          <span
            key={tag}
            className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border font-mono ${chipClass}`}
          >
            {tag}
            <button
              type="button"
              aria-label={`Remove ${tag} from ${tone} list`}
              onClick={() => onRemove(tag)}
              className="text-zinc-500 hover:text-red-400"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        type="text"
        value={input}
        list={listId}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            if (input.trim()) {
              onAdd(input);
              setInput('');
            }
          } else if (e.key === 'Backspace' && input === '' && tags.length > 0) {
            onRemove(tags[tags.length - 1]);
          }
        }}
        onBlur={() => {
          if (input.trim()) {
            onAdd(input);
            setInput('');
          }
        }}
        disabled={disabled}
        aria-label={`Add tool to ${tone} list`}
        placeholder="Tool name — Enter or comma…"
        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
      />
    </div>
  );
}

export function ToolPolicyEditor({
  value,
  onChange,
  disabled,
  idPrefix,
}: {
  value: ToolPolicyValue;
  onChange: (next: ToolPolicyValue) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  const listId = `${idPrefix}-known-tools`;

  function addTo(key: 'allow' | 'deny', raw: string) {
    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) return;
    const next = new Set(value[key]);
    for (const p of parts) next.add(p);
    onChange({ ...value, [key]: Array.from(next) });
  }

  function removeFrom(key: 'allow' | 'deny', tag: string) {
    onChange({ ...value, [key]: value[key].filter((t) => t !== tag) });
  }

  return (
    <fieldset
      className="border border-zinc-800 rounded-lg px-4 pb-4 pt-1"
      data-testid="tool-policy-editor"
    >
      <legend className="text-xs font-medium text-zinc-300 px-1.5">Tool policy</legend>
      <p className="text-[11px] text-zinc-500 mb-3">
        Deny always wins. A non-empty allow list permits <em>only</em> those tools. Leave both
        empty to permit every platform tool.
      </p>
      <datalist id={listId}>
        {KNOWN_TOOLS.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <div className="space-y-3">
        <TagListInput
          label="Deny (blocked even if allowed)"
          tags={value.deny}
          onAdd={(raw) => addTo('deny', raw)}
          onRemove={(tag) => removeFrom('deny', tag)}
          disabled={disabled}
          listId={listId}
          tone="deny"
        />
        <TagListInput
          label="Allow (exclusive when non-empty)"
          tags={value.allow}
          onAdd={(raw) => addTo('allow', raw)}
          onRemove={(tag) => removeFrom('allow', tag)}
          disabled={disabled}
          listId={listId}
          tone="allow"
        />
      </div>
    </fieldset>
  );
}
