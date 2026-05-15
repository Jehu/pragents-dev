import React, { useEffect, useState } from 'react';
import { InterfacesConfig } from '@pragents/schema/config';

export interface InterfacesFormValues {
  web: { port: number; host: string };
}

export interface InterfacesFormProps {
  initial: Partial<InterfacesFormValues> | null;
  busy?: boolean;
  onChange: (values: InterfacesFormValues, valid: boolean) => void;
}

export function InterfacesForm({ initial, busy, onChange }: InterfacesFormProps) {
  const [port, setPort] = useState<number>(initial?.web?.port ?? 3000);
  const [host, setHost] = useState<string>(initial?.web?.host ?? 'localhost');

  useEffect(() => {
    setPort(initial?.web?.port ?? 3000);
    setHost(initial?.web?.host ?? 'localhost');
  }, [initial?.web?.port, initial?.web?.host]);

  useEffect(() => {
    const candidate: InterfacesFormValues = { web: { port, host } };
    const parsed = InterfacesConfig.safeParse(candidate);
    onChange(candidate, parsed.success);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [port, host]);

  const portError =
    !Number.isInteger(port) || port < 1 || port > 65535
      ? 'Port must be between 1 and 65535'
      : null;
  const hostError = !host.trim() ? 'Host is required' : null;

  return (
    <div className="space-y-4 max-w-md">
      <label className="block">
        <span className="block text-xs font-medium text-zinc-300 mb-1">
          Web port
        </span>
        <input
          type="number"
          min={1}
          max={65535}
          value={port}
          onChange={(e) =>
            setPort(e.target.value === '' ? NaN : Number(e.target.value))
          }
          disabled={busy}
          aria-label="Web port"
          aria-invalid={!!portError}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500 font-mono"
        />
        {portError && (
          <span role="alert" className="block text-[11px] text-red-400 mt-1">
            {portError}
          </span>
        )}
      </label>

      <label className="block">
        <span className="block text-xs font-medium text-zinc-300 mb-1">
          Web host
        </span>
        <input
          type="text"
          value={host}
          onChange={(e) => setHost(e.target.value)}
          disabled={busy}
          aria-label="Web host"
          aria-invalid={!!hostError}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 font-mono"
        />
        {hostError && (
          <span role="alert" className="block text-[11px] text-red-400 mt-1">
            {hostError}
          </span>
        )}
      </label>
    </div>
  );
}
