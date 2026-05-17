import React, { useMemo, useState } from 'react';
import {
  AgentConfig as AgentConfigSchema,
  PROJECT_AGENT_TYPES as AGENT_TYPES,
  type ProjectAgentType,
} from '@pragents/schema/config';
import { ModelSelect } from './ModelSelect.js';

// Re-export so existing consumers (`new.tsx`, `$projectId.tsx`) keep their
// import path stable while the single source of truth lives in
// `@pragents/schema`.
export { AGENT_TYPES };
export type { ProjectAgentType };

/**
 * Form for editing a single agent inside a project (dev / seo / content).
 *
 * Re-used by:
 *  - Project detail page (per agent type slot)
 *  - "New project" wizard (Step 2)
 *  - Future: Company-agent forms (Slice 3) once that surface lands.
 *
 * Form-state stays local — see the U8 plan: Zustand stores are not used
 * for form values to keep things predictable across modal lifecycles.
 */

export type MemoryLevel = 'none' | 'read' | 'read/write';

export interface AgentFormValues {
  type: ProjectAgentType;
  role?: 'fast' | 'standard';
  model?: string;
  personality?: string;
  capabilities: string[];
  memory: {
    company: MemoryLevel;
    project: MemoryLevel;
    projectsAll: 'none' | 'read';
  };
  tokenBudget?: number;
  keepWarm: boolean;
}

export interface AgentFormProps {
  initialValues?: Partial<AgentFormValues>;
  /** When true, the type select is shown but disabled (editing existing agent). */
  editMode?: boolean;
  /** Types that are already configured on the parent project — disabled in the type select. */
  takenTypes?: ProjectAgentType[];
  /** Default agent type when adding into an empty slot. */
  defaultType?: ProjectAgentType;
  onCancel?: () => void;
  onSubmit: (values: AgentFormValues) => void;
  submitLabel?: string;
  busy?: boolean;
}

function normalizedMemoryPayload(mem: AgentFormValues['memory']) {
  const out: {
    company?: 'read' | 'read/write';
    project?: 'read' | 'read/write';
    projects?: { all?: 'read' };
  } = {};
  if (mem.company !== 'none') out.company = mem.company;
  if (mem.project !== 'none') out.project = mem.project;
  if (mem.projectsAll === 'read') out.projects = { all: 'read' };
  return Object.keys(out).length > 0 ? out : undefined;
}

export function buildAgentPayload(values: AgentFormValues): Record<string, unknown> {
  const memory = normalizedMemoryPayload(values.memory);
  const payload: Record<string, unknown> = {
    type: values.type,
    keepWarm: values.keepWarm,
  };
  if (values.role) payload.role = values.role;
  if (values.model && values.model.trim()) payload.model = values.model.trim();
  if (values.personality && values.personality.trim())
    payload.personality = values.personality.trim();
  if (values.capabilities.length > 0) payload.capabilities = values.capabilities;
  if (memory) payload.memory = memory;
  if (typeof values.tokenBudget === 'number' && Number.isFinite(values.tokenBudget))
    payload.tokenBudget = values.tokenBudget;
  return payload;
}

export function AgentForm({
  initialValues,
  editMode = false,
  takenTypes = [],
  defaultType,
  onCancel,
  onSubmit,
  submitLabel = 'Save',
  busy = false,
}: AgentFormProps) {
  const fallbackType: ProjectAgentType =
    defaultType ?? AGENT_TYPES.find((t) => !takenTypes.includes(t)) ?? 'dev';

  const [values, setValues] = useState<AgentFormValues>(() => ({
    type: initialValues?.type ?? fallbackType,
    role: initialValues?.role,
    model: initialValues?.model ?? '',
    personality: initialValues?.personality ?? '',
    capabilities: initialValues?.capabilities ?? [],
    memory: {
      company: initialValues?.memory?.company ?? 'none',
      project: initialValues?.memory?.project ?? 'none',
      projectsAll: initialValues?.memory?.projectsAll ?? 'none',
    },
    tokenBudget: initialValues?.tokenBudget,
    keepWarm: initialValues?.keepWarm ?? false,
  }));

  const [tagInput, setTagInput] = useState('');

  const payload = useMemo(() => buildAgentPayload(values), [values]);

  const errors = useMemo(() => {
    const errs: Record<string, string> = {};
    if (typeof values.tokenBudget === 'number') {
      if (!Number.isFinite(values.tokenBudget) || values.tokenBudget <= 0) {
        errs.tokenBudget = 'Must be a positive integer';
      } else if (!Number.isInteger(values.tokenBudget)) {
        errs.tokenBudget = 'Must be an integer';
      }
    }
    const parsed = AgentConfigSchema.safeParse(payload);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const k = issue.path.join('.') || '_';
        if (!errs[k]) errs[k] = issue.message;
      }
    }
    return errs;
  }, [payload, values.tokenBudget]);

  const valid = Object.keys(errors).length === 0;

  function update<K extends keyof AgentFormValues>(key: K, val: AgentFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: val }));
  }

  function addTag(raw: string) {
    const parts = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    setValues((prev) => {
      const next = new Set(prev.capabilities);
      for (const p of parts) next.add(p);
      return { ...prev, capabilities: Array.from(next) };
    });
    setTagInput('');
  }

  function removeTag(tag: string) {
    setValues((prev) => ({
      ...prev,
      capabilities: prev.capabilities.filter((t) => t !== tag),
    }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    onSubmit(values);
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="Agent form"
      className="space-y-4 p-5 max-h-[70vh] overflow-y-auto"
      data-testid="agent-form"
    >
      <label className="block">
        <span className="block text-xs font-medium text-zinc-300 mb-1">Type</span>
        <select
          value={values.type}
          onChange={(e) => update('type', e.target.value as ProjectAgentType)}
          disabled={editMode || busy}
          aria-label="Agent type"
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500 disabled:opacity-60"
        >
          {AGENT_TYPES.map((t) => (
            <option
              key={t}
              value={t}
              disabled={!editMode && takenTypes.includes(t) && t !== values.type}
            >
              {t}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="block text-xs font-medium text-zinc-300 mb-1">Model</span>
        <ModelSelect
          value={values.model ?? ''}
          onChange={(next) => update('model', next)}
          disabled={busy}
          ariaLabel="Model"
          id={`agent-model-${values.type}`}
        />
      </label>

      <label className="block">
        <span className="block text-xs font-medium text-zinc-300 mb-1">Personality</span>
        <textarea
          rows={3}
          value={values.personality ?? ''}
          onChange={(e) => update('personality', e.target.value)}
          disabled={busy}
          aria-label="Personality"
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-y"
          placeholder="Short prompt describing how the agent behaves…"
        />
      </label>

      <fieldset className="block">
        <legend className="block text-xs font-medium text-zinc-300 mb-1">
          Capabilities
        </legend>
        <div className="flex flex-wrap gap-1.5 mb-2" data-testid="capability-tags">
          {values.capabilities.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-200 border border-zinc-700"
            >
              {tag}
              <button
                type="button"
                aria-label={`Remove ${tag}`}
                onClick={() => removeTag(tag)}
                className="text-zinc-500 hover:text-red-400"
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <input
          type="text"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              addTag(tagInput);
            } else if (e.key === 'Backspace' && tagInput === '' && values.capabilities.length > 0) {
              removeTag(values.capabilities[values.capabilities.length - 1]);
            }
          }}
          onBlur={() => tagInput && addTag(tagInput)}
          disabled={busy}
          aria-label="Add capability"
          placeholder="Type and press Enter or comma…"
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
        />
      </fieldset>

      <fieldset className="block">
        <legend className="block text-xs font-medium text-zinc-300 mb-2">
          Memory access
        </legend>
        <div className="space-y-2">
          <MemoryRow
            label="Company"
            value={values.memory.company}
            onChange={(v) =>
              update('memory', { ...values.memory, company: v as MemoryLevel })
            }
            options={['none', 'read', 'read/write']}
          />
          <MemoryRow
            label="Project"
            value={values.memory.project}
            onChange={(v) =>
              update('memory', { ...values.memory, project: v as MemoryLevel })
            }
            options={['none', 'read', 'read/write']}
          />
          <MemoryRow
            label="All projects"
            value={values.memory.projectsAll}
            onChange={(v) =>
              update('memory', {
                ...values.memory,
                projectsAll: v as 'none' | 'read',
              })
            }
            options={['none', 'read']}
          />
        </div>
      </fieldset>

      <label className="block">
        <span className="block text-xs font-medium text-zinc-300 mb-1">Token budget</span>
        <input
          type="number"
          min={1}
          value={values.tokenBudget ?? ''}
          onChange={(e) => {
            const raw = e.target.value;
            update('tokenBudget', raw === '' ? undefined : Number(raw));
          }}
          disabled={busy}
          aria-label="Token budget"
          aria-invalid={!!errors.tokenBudget}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
          placeholder="e.g. 200000"
        />
        {errors.tokenBudget && (
          <span role="alert" className="block text-[11px] text-red-400 mt-1">
            {errors.tokenBudget}
          </span>
        )}
      </label>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={values.keepWarm}
          onChange={(e) => update('keepWarm', e.target.checked)}
          disabled={busy}
          aria-label="Keep warm"
        />
        <span className="text-xs text-zinc-300">Keep warm (pre-spawn on boot)</span>
      </label>

      <div className="flex justify-end gap-2 pt-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-40"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={!valid || busy}
          className="text-xs px-3 py-1.5 rounded-lg bg-indigo-700 hover:bg-indigo-600 text-zinc-100 font-medium disabled:opacity-40"
        >
          {busy ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

interface MemoryRowProps {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}

function MemoryRow({ label, value, options, onChange }: MemoryRowProps) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 text-xs text-zinc-400">{label}</span>
      <div className="flex gap-2">
        {options.map((opt) => (
          <label key={opt} className="flex items-center gap-1 text-xs text-zinc-300">
            <input
              type="radio"
              name={`memory-${label}`}
              value={opt}
              checked={value === opt}
              onChange={() => onChange(opt)}
            />
            <span>{opt}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
