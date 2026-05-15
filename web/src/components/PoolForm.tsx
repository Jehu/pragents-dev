import React, { useEffect, useState } from 'react';
import { PoolConfig } from '@pragents/schema/config';

export interface PoolFormValues {
  maxWarmSessions: number;
}

export interface PoolFormProps {
  initial: Partial<PoolFormValues> | null;
  busy?: boolean;
  onChange: (values: PoolFormValues, valid: boolean) => void;
}

/**
 * Single-field form for `pool.maxWarmSessions`. Re-emits its value on every
 * keystroke so the parent can drive a dirty-state indicator and `Save`
 * button enablement without owning a copy of the form state.
 */
export function PoolForm({ initial, busy, onChange }: PoolFormProps) {
  const [value, setValue] = useState<number>(initial?.maxWarmSessions ?? 10);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    setValue(initial?.maxWarmSessions ?? 10);
    setTouched(false);
  }, [initial?.maxWarmSessions]);

  useEffect(() => {
    const parsed = PoolConfig.safeParse({ maxWarmSessions: value });
    onChange({ maxWarmSessions: value }, parsed.success);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const error =
    touched && (!Number.isInteger(value) || value <= 0)
      ? 'Must be a positive integer'
      : null;

  return (
    <label className="block max-w-xs">
      <span className="block text-xs font-medium text-zinc-300 mb-1">
        Max warm sessions
      </span>
      <input
        type="number"
        min={1}
        value={value}
        onChange={(e) => {
          setTouched(true);
          const raw = e.target.value;
          setValue(raw === '' ? NaN : Number(raw));
        }}
        disabled={busy}
        aria-label="Max warm sessions"
        aria-invalid={!!error}
        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
      />
      {error ? (
        <span role="alert" className="block text-[11px] text-red-400 mt-1">
          {error}
        </span>
      ) : (
        <span className="block text-[11px] text-zinc-500 mt-1">
          Cap on agents that may be pre-spawned at boot.
        </span>
      )}
    </label>
  );
}
