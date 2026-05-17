import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

/**
 * Model picker backed by the pi ModelRegistry (`/api/v1/models`).
 *
 * Renders a grouped `<select>`:
 *   - Available (auth configured)
 *   - Not configured (no API key / OAuth) — kept visible but `disabled` so
 *     users can see what's installable
 *   - Custom… — switches the control to a free-text input so users can
 *     reference models the registry doesn't know about yet (e.g. a fresh
 *     release before pi ships an update). The current value is also shown
 *     in this mode when it doesn't match any known reference.
 *
 * Stays predictable when the API errors: falls back to a plain text input
 * with the existing value, so an unreachable endpoint can't lock the
 * user out of editing.
 */

interface ApiModel {
  reference: string;
  provider: string;
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  hasAuth: boolean;
}

interface ApiResponse {
  available: ApiModel[];
  all: ApiModel[];
  error: string | null;
}

const CUSTOM_TOKEN = '__custom__';

export interface ModelSelectProps {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  /** Used for input ids + aria. Keep stable per form instance. */
  id?: string;
  ariaLabel?: string;
  placeholder?: string;
}

export function ModelSelect({
  value,
  onChange,
  disabled = false,
  id = 'model-select',
  ariaLabel = 'Model',
  placeholder = 'provider/model-id',
}: ModelSelectProps) {
  const { data, isLoading, isError } = useQuery<ApiResponse>({
    queryKey: ['available-models'],
    queryFn: async () => {
      const res = await fetch('/api/v1/models');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as ApiResponse;
    },
    staleTime: 60_000,
  });

  const allModels = data?.all ?? [];
  const known = useMemo(
    () => new Set(allModels.map((m) => m.reference)),
    [allModels],
  );

  // Custom-mode kicks in when (a) the saved value doesn't match a known
  // reference (e.g. an older config pointing at a removed model) or (b)
  // the user explicitly picked "Custom…".
  const valueIsCustom = !!value && !known.has(value);
  const [customMode, setCustomMode] = useState(valueIsCustom);

  // Keep customMode in sync once data arrives: a value that looked "custom"
  // while loading may turn out to be known once /api/v1/models responds.
  useEffect(() => {
    if (!data) return;
    if (value && !known.has(value)) setCustomMode(true);
  }, [data, value, known]);

  if (isLoading && !data) {
    return (
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label={ariaLabel}
        placeholder="Loading models…"
        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 font-mono"
      />
    );
  }

  if (isError || !data) {
    return (
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label={ariaLabel}
        placeholder={placeholder}
        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 font-mono"
      />
    );
  }

  const available = data.available;
  const unavailable = data.all.filter((m) => !m.hasAuth);

  if (customMode) {
    return (
      <div className="space-y-1.5">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-label={ariaLabel}
          placeholder={placeholder}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 font-mono"
        />
        <button
          type="button"
          onClick={() => {
            setCustomMode(false);
            // Reset to first available or empty so the select renders sensibly.
            onChange(available[0]?.reference ?? '');
          }}
          disabled={disabled}
          className="text-[11px] text-zinc-500 hover:text-zinc-300 underline"
        >
          ← pick from registry
        </button>
      </div>
    );
  }

  function handleSelect(next: string) {
    if (next === CUSTOM_TOKEN) {
      setCustomMode(true);
      // Don't clobber the existing value — user may want to keep editing it.
      return;
    }
    onChange(next);
  }

  return (
    <select
      id={id}
      value={value}
      onChange={(e) => handleSelect(e.target.value)}
      disabled={disabled}
      aria-label={ariaLabel}
      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500 font-mono"
    >
      {!value && <option value="">— pick a model —</option>}
      {available.length > 0 && (
        <optgroup label="Available">
          {available.map((m) => (
            <option key={m.reference} value={m.reference}>
              {m.reference}
              {m.reasoning ? ' · reasoning' : ''}
            </option>
          ))}
        </optgroup>
      )}
      {unavailable.length > 0 && (
        <optgroup label="Not configured (no API key / OAuth)">
          {unavailable.map((m) => (
            <option key={m.reference} value={m.reference} disabled>
              {m.reference}
            </option>
          ))}
        </optgroup>
      )}
      <option value={CUSTOM_TOKEN}>Custom…</option>
    </select>
  );
}
