import React, { useEffect, useState } from 'react';

export interface SkillApprovalFormValues {
  confidenceThreshold: number;
  blockedTools: string[];
}

export interface SkillApprovalFormProps {
  initial: Partial<SkillApprovalFormValues> | null;
  busy?: boolean;
  onChange: (values: SkillApprovalFormValues, valid: boolean) => void;
}

export function SkillApprovalForm({ initial, busy, onChange }: SkillApprovalFormProps) {
  const [confidence, setConfidence] = useState<number>(
    initial?.confidenceThreshold ?? 0.9,
  );
  const [tools, setTools] = useState<string[]>(initial?.blockedTools ?? ['bash', 'write', 'computer']);
  const [tagInput, setTagInput] = useState('');

  useEffect(() => {
    setConfidence(initial?.confidenceThreshold ?? 0.9);
    setTools(initial?.blockedTools ?? ['bash', 'write', 'computer']);
  }, [initial?.confidenceThreshold, initial?.blockedTools]);

  useEffect(() => {
    const valid =
      Number.isFinite(confidence) &&
      confidence >= 0 &&
      confidence <= 1 &&
      tools.every((t) => t.trim().length > 0);
    onChange({ confidenceThreshold: confidence, blockedTools: tools }, valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confidence, tools]);

  const confidenceError =
    !Number.isFinite(confidence) || confidence < 0 || confidence > 1
      ? 'Confidence must be between 0 and 1'
      : null;

  function addTool(raw: string) {
    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    setTools((cur) => Array.from(new Set([...cur, ...parts])));
    setTagInput('');
  }

  function removeTool(t: string) {
    setTools((cur) => cur.filter((x) => x !== t));
  }

  return (
    <div className="space-y-4 max-w-xl">
      <label className="block">
        <span className="block text-xs font-medium text-zinc-300 mb-1">
          Confidence threshold ({confidence.toFixed(2)})
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={Number.isFinite(confidence) ? confidence : 0.9}
          onChange={(e) => setConfidence(Number(e.target.value))}
          disabled={busy}
          aria-label="Confidence threshold"
          aria-invalid={!!confidenceError}
          className="w-full"
        />
        {confidenceError ? (
          <span role="alert" className="block text-[11px] text-red-400 mt-1">
            {confidenceError}
          </span>
        ) : (
          <span className="block text-[11px] text-zinc-500 mt-1">
            Skills extracted with a confidence below this score require manual approval.
          </span>
        )}
      </label>

      <fieldset className="block">
        <legend className="block text-xs font-medium text-zinc-300 mb-1">
          Blocked tools
        </legend>
        <div className="flex flex-wrap gap-1.5 mb-2" data-testid="blocked-tools">
          {tools.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-200 border border-zinc-700"
            >
              {t}
              <button
                type="button"
                aria-label={`Remove ${t}`}
                onClick={() => removeTool(t)}
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
              addTool(tagInput);
            } else if (e.key === 'Backspace' && tagInput === '' && tools.length > 0) {
              removeTool(tools[tools.length - 1]);
            }
          }}
          onBlur={() => tagInput && addTool(tagInput)}
          disabled={busy}
          aria-label="Add blocked tool"
          placeholder="Type and press Enter or comma…"
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
        />
        <span className="block text-[11px] text-zinc-500 mt-1">
          Auto-extraction refuses to mint skills that invoke any of these tools.
        </span>
      </fieldset>
    </div>
  );
}
