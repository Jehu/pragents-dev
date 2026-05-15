import React, { useMemo, useState } from 'react';
import { ProjectConfig } from '@pragents/schema/config';

/**
 * Form for project core metadata (name, directory). Used both in the
 * "new project" wizard (Step 1) and in the inline edit modal on the
 * detail page. Agent configuration lives in `AgentForm`.
 *
 * Client-side validation re-uses the shared Zod schema from
 * `@pragents/schema/config` so the rules match the server contract.
 */
export interface ProjectFormValues {
  id: string;
  name: string;
  directory: string;
}

export interface ProjectFormProps {
  initialValues?: Partial<ProjectFormValues>;
  /** When true, the `id` field is shown but disabled (existing project). */
  editMode?: boolean;
  /** Optional list of taken IDs — used for duplicate-detection on create. */
  existingIds?: string[];
  onCancel?: () => void;
  onSubmit: (values: ProjectFormValues) => void;
  submitLabel?: string;
  busy?: boolean;
}

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-\s]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    // Strip leading/trailing hyphens so the auto-suggested id always passes
    // ID_RE (first char must be alphanumeric).
    .replace(/^-+|-+$/g, '');
}

export function ProjectForm({
  initialValues,
  editMode = false,
  existingIds = [],
  onCancel,
  onSubmit,
  submitLabel = 'Save',
  busy = false,
}: ProjectFormProps) {
  const [id, setId] = useState(initialValues?.id ?? '');
  const [name, setName] = useState(initialValues?.name ?? '');
  const [directory, setDirectory] = useState(initialValues?.directory ?? '~/');
  const [idTouched, setIdTouched] = useState(false);

  // Auto-suggest id from name unless user edited the field.
  const effectiveId = editMode || idTouched ? id : slugify(name);

  const errors = useMemo(() => {
    const errs: Partial<Record<keyof ProjectFormValues, string>> = {};
    if (!editMode) {
      if (!effectiveId) errs.id = 'ID is required';
      else if (!ID_RE.test(effectiveId))
        errs.id = 'ID must be lowercase kebab-case (a-z0-9-)';
      else if (existingIds.includes(effectiveId))
        errs.id = `ID "${effectiveId}" is already taken`;
    }
    const parsed = ProjectConfig.safeParse({
      name,
      directory,
      agents: {},
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const k = issue.path[0] as keyof ProjectFormValues;
        if (k && !errs[k]) errs[k] = issue.message;
      }
    }
    if (!directory.trim()) errs.directory = 'Directory is required';
    return errs;
  }, [effectiveId, name, directory, existingIds, editMode]);

  const valid = Object.keys(errors).length === 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    onSubmit({ id: effectiveId, name, directory });
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="Project form"
      className="space-y-4 p-5"
      data-testid="project-form"
    >
      <Field
        label="Project ID"
        error={!editMode ? errors.id : undefined}
        hint={editMode ? 'ID is immutable.' : 'Lowercase kebab-case. Generated from name if left empty.'}
      >
        <input
          type="text"
          aria-label="Project ID"
          value={effectiveId}
          onChange={(e) => {
            setIdTouched(true);
            setId(e.target.value);
          }}
          disabled={editMode || busy}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 disabled:opacity-60 font-mono"
          placeholder="my-project"
          aria-invalid={!editMode && !!errors.id}
        />
      </Field>

      <Field label="Name" error={errors.name}>
        <input
          type="text"
          aria-label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
          placeholder="My Project"
          aria-invalid={!!errors.name}
        />
      </Field>

      <Field
        label="Directory"
        error={errors.directory}
        hint="Tilde (~) is expanded to your home directory by the server."
      >
        <input
          type="text"
          aria-label="Directory"
          value={directory}
          onChange={(e) => setDirectory(e.target.value)}
          disabled={busy}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 font-mono"
          placeholder="~/code/my-project"
          aria-invalid={!!errors.directory}
        />
      </Field>

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

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}

function Field({ label, error, hint, children }: FieldProps) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-zinc-300 mb-1">{label}</span>
      {children}
      {error ? (
        <span role="alert" className="block text-[11px] text-red-400 mt-1">
          {error}
        </span>
      ) : hint ? (
        <span className="block text-[11px] text-zinc-500 mt-1">{hint}</span>
      ) : null}
    </label>
  );
}
