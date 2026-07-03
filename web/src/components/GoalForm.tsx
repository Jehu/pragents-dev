import React, { useMemo, useState } from 'react';
import { parseCron } from '../routes/goals/index.js';

/**
 * Form-based goal editor (create + edit). Deliberately a form and not a
 * Monaco/YAML surface: the goal schema is small and flat, and the form
 * prevents the two most common authoring errors directly — invalid cron
 * (live humanized preview) and dangling workflow references (registry-fed
 * dropdown with an explicit free-text escape hatch).
 *
 * The server stays the authority: content is validated against the GoalDef
 * Zod schema on write, and 400 responses surface Zod issues verbatim.
 */

export interface GoalGate {
  step: string;
  label: string;
  timeout?: string;
}

export interface GoalFormValues {
  id: string;
  description: string;
  cadence: string;
  deadline?: string;
  workflow: string;
  acceptance: string[];
  human_gates: GoalGate[];
}

export const GOAL_ID_RE = /^[a-z0-9][a-z0-9_-]*$/;

/** Loose pre-check; croner on the server is the authority. */
function looksLikeCron(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  return parts.length >= 5 && parts.length <= 6;
}

/** Build the plain object that the caller serializes to YAML for POST/PUT. */
export function buildGoalPayload(values: GoalFormValues): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    id: values.id.trim(),
    description: values.description.trim(),
    cadence: values.cadence.trim(),
    workflow: values.workflow.trim(),
  };
  if (values.deadline?.trim()) payload.deadline = values.deadline.trim();
  if (values.acceptance.length > 0) payload.acceptance = values.acceptance;
  if (values.human_gates.length > 0) {
    payload.human_gates = values.human_gates.map((g) => ({
      step: g.step.trim(),
      label: g.label.trim(),
      ...(g.timeout?.trim() ? { timeout: g.timeout.trim() } : {}),
    }));
  }
  return payload;
}

export function validateGoalForm(values: GoalFormValues): Record<string, string> {
  const errs: Record<string, string> = {};
  if (!GOAL_ID_RE.test(values.id.trim())) errs.id = 'Lowercase kebab-case identifier (a-z, 0-9, -, _)';
  if (!values.description.trim()) errs.description = 'Required';
  if (!looksLikeCron(values.cadence)) errs.cadence = 'Cron expression with 5 fields, e.g. "0 8 * * 1"';
  if (values.deadline?.trim() && !looksLikeCron(values.deadline)) errs.deadline = 'Cron expression with 5 fields';
  if (!values.workflow.trim()) errs.workflow = 'Required';
  for (const g of values.human_gates) {
    if (!g.step.trim() || !g.label.trim()) {
      errs.human_gates = 'Every gate needs a step and a label';
      break;
    }
  }
  return errs;
}

function CronField({
  label,
  value,
  onChange,
  error,
  optional,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  optional?: boolean;
  disabled?: boolean;
}) {
  const preview = value.trim() && looksLikeCron(value) ? parseCron(value.trim()) : null;
  return (
    <label className="block">
      <span className="block text-xs font-medium text-zinc-300 mb-1">
        {label}
        {optional && <span className="text-zinc-600"> (optional)</span>}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label={label}
        placeholder="0 8 * * 1"
        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
      />
      {error ? (
        <span role="alert" className="block text-[11px] text-red-400 mt-1">{error}</span>
      ) : preview ? (
        <span className="block text-[11px] text-zinc-500 mt-1">{preview}</span>
      ) : null}
    </label>
  );
}

export function GoalForm({
  initialValues,
  editMode = false,
  knownWorkflows = [],
  onCancel,
  onSubmit,
  submitLabel = 'Save',
  busy = false,
  serverError,
}: {
  initialValues?: Partial<GoalFormValues>;
  /** Edit mode disables the id (renames are delete + create). */
  editMode?: boolean;
  /** Workflow names from the registry — fed into the dropdown. */
  knownWorkflows?: string[];
  onCancel?: () => void;
  onSubmit: (values: GoalFormValues) => void;
  submitLabel?: string;
  busy?: boolean;
  /** Error from the server (Zod issues etc.) rendered above the buttons. */
  serverError?: string | null;
}) {
  const [values, setValues] = useState<GoalFormValues>(() => ({
    id: initialValues?.id ?? '',
    description: initialValues?.description ?? '',
    cadence: initialValues?.cadence ?? '',
    deadline: initialValues?.deadline ?? '',
    workflow: initialValues?.workflow ?? '',
    acceptance: initialValues?.acceptance ?? [],
    human_gates: initialValues?.human_gates ?? [],
  }));
  const [tagInput, setTagInput] = useState('');
  const [touched, setTouched] = useState(false);

  const errors = useMemo(() => validateGoalForm(values), [values]);
  const valid = Object.keys(errors).length === 0;
  const workflowMissing =
    values.workflow.trim() !== '' && knownWorkflows.length > 0 && !knownWorkflows.includes(values.workflow.trim());

  function update<K extends keyof GoalFormValues>(key: K, val: GoalFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: val }));
  }

  function addAcceptance(raw: string) {
    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length === 0) return;
    update('acceptance', Array.from(new Set([...values.acceptance, ...parts])));
    setTagInput('');
  }

  function updateGate(i: number, patch: Partial<GoalGate>) {
    update('human_gates', values.human_gates.map((g, idx) => (idx === i ? { ...g, ...patch } : g)));
  }

  return (
    <form
      aria-label="Goal form"
      data-testid="goal-form"
      className="space-y-4 p-5 max-h-[70vh] overflow-y-auto"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (valid) onSubmit(values);
      }}
    >
      <label className="block">
        <span className="block text-xs font-medium text-zinc-300 mb-1">Goal id</span>
        <input
          type="text"
          value={values.id}
          onChange={(e) => update('id', e.target.value)}
          disabled={editMode || busy}
          aria-label="Goal id"
          placeholder="weekly-article"
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 disabled:opacity-60"
        />
        {editMode ? (
          <span className="block text-[11px] text-zinc-600 mt-1">Renames are delete + create.</span>
        ) : touched && errors.id ? (
          <span role="alert" className="block text-[11px] text-red-400 mt-1">{errors.id}</span>
        ) : null}
      </label>

      <label className="block">
        <span className="block text-xs font-medium text-zinc-300 mb-1">Outcome description</span>
        <input
          type="text"
          value={values.description}
          onChange={(e) => update('description', e.target.value)}
          disabled={busy}
          aria-label="Goal description"
          placeholder="1 well-researched blog article per week"
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
        />
        {touched && errors.description && (
          <span role="alert" className="block text-[11px] text-red-400 mt-1">{errors.description}</span>
        )}
      </label>

      <CronField
        label="Cadence"
        value={values.cadence}
        onChange={(v) => update('cadence', v)}
        error={touched ? errors.cadence : undefined}
        disabled={busy}
      />

      <CronField
        label="Deadline"
        value={values.deadline ?? ''}
        onChange={(v) => update('deadline', v)}
        error={touched ? errors.deadline : undefined}
        optional
        disabled={busy}
      />

      <label className="block">
        <span className="block text-xs font-medium text-zinc-300 mb-1">Workflow</span>
        <input
          type="text"
          value={values.workflow}
          onChange={(e) => update('workflow', e.target.value)}
          disabled={busy}
          aria-label="Goal workflow"
          list="goal-form-known-workflows"
          placeholder="content-pipeline"
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
        />
        <datalist id="goal-form-known-workflows">
          {knownWorkflows.map((w) => (
            <option key={w} value={w} />
          ))}
        </datalist>
        {touched && errors.workflow ? (
          <span role="alert" className="block text-[11px] text-red-400 mt-1">{errors.workflow}</span>
        ) : workflowMissing ? (
          <span className="block text-[11px] text-amber-300 mt-1">
            ⚠ No workflow named "{values.workflow.trim()}" is registered — runs will fail until it exists.
          </span>
        ) : null}
      </label>

      <fieldset className="border border-zinc-800 rounded-lg px-4 pb-4 pt-1">
        <legend className="text-xs font-medium text-zinc-300 px-1.5">Acceptance criteria</legend>
        <div className="flex flex-wrap gap-1.5 mb-1.5" data-testid="acceptance-tags">
          {values.acceptance.map((item) => (
            <span
              key={item}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-200 border border-zinc-700"
            >
              {item}
              <button
                type="button"
                aria-label={`Remove ${item}`}
                onClick={() => update('acceptance', values.acceptance.filter((a) => a !== item))}
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
              addAcceptance(tagInput);
            } else if (e.key === 'Backspace' && tagInput === '' && values.acceptance.length > 0) {
              update('acceptance', values.acceptance.slice(0, -1));
            }
          }}
          onBlur={() => tagInput && addAcceptance(tagInput)}
          disabled={busy}
          aria-label="Add acceptance criterion"
          placeholder="Type and press Enter or comma…"
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
        />
      </fieldset>

      <fieldset className="border border-zinc-800 rounded-lg px-4 pb-4 pt-1">
        <legend className="text-xs font-medium text-zinc-300 px-1.5">Human gates</legend>
        <div className="space-y-2">
          {values.human_gates.map((gate, i) => (
            <div key={i} className="flex gap-2 items-start" data-testid={`gate-row-${i}`}>
              <input
                type="text"
                value={gate.step}
                onChange={(e) => updateGate(i, { step: e.target.value })}
                disabled={busy}
                aria-label={`Gate ${i + 1} step`}
                placeholder="after_draft"
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
              />
              <input
                type="text"
                value={gate.label}
                onChange={(e) => updateGate(i, { label: e.target.value })}
                disabled={busy}
                aria-label={`Gate ${i + 1} label`}
                placeholder="Review draft"
                className="flex-[2] bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
              />
              <input
                type="text"
                value={gate.timeout ?? ''}
                onChange={(e) => updateGate(i, { timeout: e.target.value })}
                disabled={busy}
                aria-label={`Gate ${i + 1} timeout`}
                placeholder="4h"
                className="w-16 bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
              />
              <button
                type="button"
                aria-label={`Remove gate ${i + 1}`}
                onClick={() => update('human_gates', values.human_gates.filter((_, idx) => idx !== i))}
                className="text-zinc-500 hover:text-red-400 px-1 py-1"
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => update('human_gates', [...values.human_gates, { step: '', label: '', timeout: '' }])}
            disabled={busy}
            className="text-xs text-indigo-400 hover:text-indigo-300"
          >
            + Add gate
          </button>
          {touched && errors.human_gates && (
            <span role="alert" className="block text-[11px] text-red-400">{errors.human_gates}</span>
          )}
        </div>
      </fieldset>

      {serverError && (
        <div role="alert" className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded px-3 py-2 whitespace-pre-wrap">
          {serverError}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="text-xs px-3 py-1.5 rounded text-zinc-400 hover:text-zinc-200"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={busy || (touched && !valid)}
          className="text-xs px-3 py-1.5 rounded-lg bg-indigo-700 hover:bg-indigo-600 text-zinc-100 font-medium disabled:opacity-40"
        >
          {busy ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
