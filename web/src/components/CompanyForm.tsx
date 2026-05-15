import React, { useEffect, useState } from 'react';

export interface CompanyFormValues {
  name: string;
  autoApproveSkills?: boolean;
  similarityThreshold?: number;
}

export interface CompanyFormProps {
  initial: Partial<CompanyFormValues> | null;
  busy?: boolean;
  onChange: (values: CompanyFormValues, valid: boolean) => void;
}

/**
 * Company-Stammdaten only. The two nested blocks (`agents` + `skillApproval`)
 * have their own forms / endpoints on `/settings` and are intentionally not
 * touched here — the server's `PUT /settings/company` does the same.
 */
export function CompanyForm({ initial, busy, onChange }: CompanyFormProps) {
  const [name, setName] = useState<string>(initial?.name ?? '');
  const [autoApprove, setAutoApprove] = useState<boolean>(
    initial?.autoApproveSkills ?? false,
  );
  const [similarity, setSimilarity] = useState<number>(
    initial?.similarityThreshold ?? 0.8,
  );

  useEffect(() => {
    setName(initial?.name ?? '');
    setAutoApprove(initial?.autoApproveSkills ?? false);
    setSimilarity(initial?.similarityThreshold ?? 0.8);
  }, [initial?.name, initial?.autoApproveSkills, initial?.similarityThreshold]);

  useEffect(() => {
    const valid =
      name.trim().length > 0 &&
      Number.isFinite(similarity) &&
      similarity >= 0 &&
      similarity <= 1;
    onChange(
      {
        name,
        autoApproveSkills: autoApprove,
        similarityThreshold: similarity,
      },
      valid,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, autoApprove, similarity]);

  const nameError = !name.trim() ? 'Company name is required' : null;
  const simError =
    !Number.isFinite(similarity) || similarity < 0 || similarity > 1
      ? 'Threshold must be between 0 and 1'
      : null;

  return (
    <div className="space-y-4 max-w-xl">
      <label className="block">
        <span className="block text-xs font-medium text-zinc-300 mb-1">
          Company name
        </span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          aria-label="Company name"
          aria-invalid={!!nameError}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
        />
        {nameError && (
          <span role="alert" className="block text-[11px] text-red-400 mt-1">
            {nameError}
          </span>
        )}
      </label>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={autoApprove}
          onChange={(e) => setAutoApprove(e.target.checked)}
          disabled={busy}
          aria-label="Auto-approve skills"
        />
        <span className="text-xs text-zinc-300">
          Auto-approve extracted skills (skips quarantine)
        </span>
      </label>

      <label className="block">
        <span className="block text-xs font-medium text-zinc-300 mb-1">
          Similarity threshold ({similarity.toFixed(2)})
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={Number.isFinite(similarity) ? similarity : 0.8}
          onChange={(e) => setSimilarity(Number(e.target.value))}
          disabled={busy}
          aria-label="Similarity threshold"
          aria-invalid={!!simError}
          className="w-full"
        />
        {simError ? (
          <span role="alert" className="block text-[11px] text-red-400 mt-1">
            {simError}
          </span>
        ) : (
          <span className="block text-[11px] text-zinc-500 mt-1">
            Skills above this similarity to an existing one are flagged as duplicates.
          </span>
        )}
      </label>
    </div>
  );
}
