import React, { useEffect, useState } from 'react';

export type CostsMap = Record<string, { in: number; out: number }>;

export interface CostsFormProps {
  initial: CostsMap | null;
  busy?: boolean;
  onChange: (values: CostsMap, valid: boolean) => void;
}

interface Row {
  model: string;
  in: string;
  out: string;
}

function toRows(map: CostsMap | null): Row[] {
  if (!map) return [];
  return Object.entries(map).map(([model, rate]) => ({
    model,
    in: String(rate.in),
    out: String(rate.out),
  }));
}

function rowsToMap(rows: Row[]): { map: CostsMap; valid: boolean; reason?: string } {
  const map: CostsMap = {};
  const seen = new Set<string>();
  for (const row of rows) {
    const model = row.model.trim();
    if (!model) return { map: {}, valid: false, reason: 'Model name required' };
    if (seen.has(model)) {
      return { map: {}, valid: false, reason: `Duplicate model "${model}"` };
    }
    seen.add(model);
    const inN = Number(row.in);
    const outN = Number(row.out);
    if (!Number.isFinite(inN) || !Number.isFinite(outN)) {
      return { map: {}, valid: false, reason: `Numeric in/out required for ${model}` };
    }
    if (inN < 0 || outN < 0) {
      return { map: {}, valid: false, reason: `Negative rate for ${model}` };
    }
    map[model] = { in: inN, out: outN };
  }
  return { map, valid: true };
}

/**
 * Editable model → {in, out} table. Re-emits on every keystroke so the
 * parent decides when the form is dirty vs. saveable.
 */
export function CostsForm({ initial, busy, onChange }: CostsFormProps) {
  const [rows, setRows] = useState<Row[]>(() => toRows(initial));

  useEffect(() => {
    setRows(toRows(initial));
  }, [initial]);

  useEffect(() => {
    const { map, valid } = rowsToMap(rows);
    onChange(map, valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const validation = rowsToMap(rows);

  function updateRow(idx: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((rs) => [...rs, { model: '', in: '0', out: '0' }]);
  }

  function removeRow(idx: number) {
    setRows((rs) => rs.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-2" data-testid="costs-form">
      {rows.length > 0 && (
        <div className="grid grid-cols-[2fr_1fr_1fr_auto] gap-2 text-[11px] text-zinc-500 px-1">
          <span>Model</span>
          <span>In (€/M tokens)</span>
          <span>Out (€/M tokens)</span>
          <span />
        </div>
      )}
      {rows.map((row, idx) => (
        <div
          key={idx}
          className="grid grid-cols-[2fr_1fr_1fr_auto] gap-2 items-center"
          data-testid={`cost-row-${idx}`}
        >
          <input
            type="text"
            value={row.model}
            onChange={(e) => updateRow(idx, { model: e.target.value })}
            disabled={busy}
            aria-label={`Model name ${idx + 1}`}
            placeholder="provider/model-id"
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 font-mono"
          />
          <input
            type="number"
            step="0.0001"
            value={row.in}
            onChange={(e) => updateRow(idx, { in: e.target.value })}
            disabled={busy}
            aria-label={`In rate ${idx + 1}`}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500 font-mono"
          />
          <input
            type="number"
            step="0.0001"
            value={row.out}
            onChange={(e) => updateRow(idx, { out: e.target.value })}
            disabled={busy}
            aria-label={`Out rate ${idx + 1}`}
            className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500 font-mono"
          />
          <button
            type="button"
            onClick={() => removeRow(idx)}
            disabled={busy}
            aria-label={`Remove row ${idx + 1}`}
            className="text-[11px] px-2 py-1 rounded bg-zinc-800 hover:bg-red-900 text-zinc-400 hover:text-red-200 disabled:opacity-40"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addRow}
        disabled={busy}
        className="text-[11px] px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-40"
      >
        + Add model
      </button>
      {!validation.valid && validation.reason && (
        <p role="alert" className="text-[11px] text-red-400 mt-1">
          {validation.reason}
        </p>
      )}
    </div>
  );
}
