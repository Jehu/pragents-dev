import React, { useEffect, useMemo, useState } from 'react';
import { CompanyAgentConfig } from '@pragents/schema/config';
import type { MemoryLevel } from './AgentForm.js';
import { ModelSelect } from './ModelSelect.js';

/**
 * Company-scope agent form (office / pm). Re-uses the same memory-access
 * shape as the project AgentForm but the `type` slot is fixed by the
 * surrounding section header, so we don't render a type-select here.
 */
export type CompanyAgentType = 'office' | 'pm';

export interface CompanyAgentFormValues {
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

export interface CompanyAgentFormProps {
  agentType: CompanyAgentType;
  initial: Partial<CompanyAgentFormValues> | null;
  busy?: boolean;
  onChange: (values: CompanyAgentFormValues, valid: boolean, payload: Record<string, unknown>) => void;
}

function normalizedMemoryPayload(mem: CompanyAgentFormValues['memory']) {
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

export function buildCompanyAgentPayload(
  values: CompanyAgentFormValues,
  agentType: CompanyAgentType,
): Record<string, unknown> {
  return buildPayload(values, agentType);
}

function buildPayload(values: CompanyAgentFormValues, agentType: CompanyAgentType) {
  const payload: Record<string, unknown> = {
    type: agentType,
    keepWarm: values.keepWarm,
  };
  if (values.model && values.model.trim()) payload.model = values.model.trim();
  if (values.personality && values.personality.trim())
    payload.personality = values.personality.trim();
  if (values.capabilities.length > 0) payload.capabilities = values.capabilities;
  const memory = normalizedMemoryPayload(values.memory);
  if (memory) payload.memory = memory;
  if (typeof values.tokenBudget === 'number' && Number.isFinite(values.tokenBudget))
    payload.tokenBudget = values.tokenBudget;
  return payload;
}

export function CompanyAgentForm({
  agentType,
  initial,
  busy,
  onChange,
}: CompanyAgentFormProps) {
  const [values, setValues] = useState<CompanyAgentFormValues>(() => ({
    model: initial?.model ?? '',
    personality: initial?.personality ?? '',
    capabilities: initial?.capabilities ?? [],
    memory: {
      company: initial?.memory?.company ?? 'read/write',
      project: initial?.memory?.project ?? 'none',
      projectsAll: initial?.memory?.projectsAll ?? 'none',
    },
    tokenBudget: initial?.tokenBudget,
    keepWarm: initial?.keepWarm ?? false,
  }));
  const [tagInput, setTagInput] = useState('');

  // Re-hydrate when the parent loads a new section snapshot.
  useEffect(() => {
    setValues({
      model: initial?.model ?? '',
      personality: initial?.personality ?? '',
      capabilities: initial?.capabilities ?? [],
      memory: {
        company: initial?.memory?.company ?? 'read/write',
        project: initial?.memory?.project ?? 'none',
        projectsAll: initial?.memory?.projectsAll ?? 'none',
      },
      tokenBudget: initial?.tokenBudget,
      keepWarm: initial?.keepWarm ?? false,
    });
  }, [
    initial?.model,
    initial?.personality,
    initial?.capabilities,
    initial?.memory?.company,
    initial?.memory?.project,
    initial?.memory?.projectsAll,
    initial?.tokenBudget,
    initial?.keepWarm,
  ]);

  const payload = useMemo(() => buildPayload(values, agentType), [values, agentType]);
  const parsed = CompanyAgentConfig.safeParse(payload);
  const valid = parsed.success;

  useEffect(() => {
    onChange(values, valid, payload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, valid]);

  function update<K extends keyof CompanyAgentFormValues>(
    key: K,
    val: CompanyAgentFormValues[K],
  ) {
    setValues((prev) => ({ ...prev, [key]: val }));
  }

  function addTag(raw: string) {
    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    setValues((prev) => ({
      ...prev,
      capabilities: Array.from(new Set([...prev.capabilities, ...parts])),
    }));
    setTagInput('');
  }

  function removeTag(tag: string) {
    setValues((prev) => ({
      ...prev,
      capabilities: prev.capabilities.filter((t) => t !== tag),
    }));
  }

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="block text-xs font-medium text-zinc-300 mb-1">Model</span>
        <ModelSelect
          value={values.model ?? ''}
          onChange={(next) => update('model', next)}
          disabled={busy}
          id={`company-model-${agentType}`}
          ariaLabel={`${agentType} model`}
        />
      </label>

      <label className="block">
        <span className="block text-xs font-medium text-zinc-300 mb-1">Personality</span>
        <textarea
          rows={3}
          value={values.personality ?? ''}
          onChange={(e) => update('personality', e.target.value)}
          disabled={busy}
          aria-label={`${agentType} personality`}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-y"
          placeholder="Short prompt describing how the agent behaves…"
        />
      </label>

      <fieldset className="block">
        <legend className="block text-xs font-medium text-zinc-300 mb-1">
          Capabilities
        </legend>
        <div className="flex flex-wrap gap-1.5 mb-2">
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
                disabled={busy}
                className="text-zinc-500 hover:text-red-400 disabled:opacity-40"
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
            }
          }}
          onBlur={() => tagInput && addTag(tagInput)}
          disabled={busy}
          aria-label={`Add ${agentType} capability`}
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
            group={`mem-${agentType}-company`}
          />
          <MemoryRow
            label="All projects"
            value={values.memory.projectsAll}
            onChange={(v) =>
              update('memory', { ...values.memory, projectsAll: v as 'none' | 'read' })
            }
            options={['none', 'read']}
            group={`mem-${agentType}-projects`}
          />
        </div>
      </fieldset>

      <label className="block max-w-xs">
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
          aria-label={`${agentType} token budget`}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
          placeholder="e.g. 30000"
        />
      </label>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={values.keepWarm}
          onChange={(e) => update('keepWarm', e.target.checked)}
          disabled={busy}
          aria-label={`${agentType} keep warm`}
        />
        <span className="text-xs text-zinc-300">Keep warm (pre-spawn on boot)</span>
      </label>
    </div>
  );
}

interface MemoryRowProps {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  group: string;
}

function MemoryRow({ label, value, options, onChange, group }: MemoryRowProps) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 text-xs text-zinc-400">{label}</span>
      <div className="flex gap-2">
        {options.map((opt) => (
          <label key={opt} className="flex items-center gap-1 text-xs text-zinc-300">
            <input
              type="radio"
              name={group}
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
