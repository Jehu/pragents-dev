import { useEffect, useRef, useState } from 'react';

export interface ConflictState {
  localContent: string;
  remoteContent: string;
}

export interface SectionSaveResult {
  ok: boolean;
  status: number;
  error?: string;
}

export interface UseSectionSaveOpts {
  /** Endpoint URL (e.g. `/api/v1/settings/pool`). */
  url: string;
  /** Source URL for re-fetching the on-disk version when a 412 hits. */
  conflictReadUrl: string;
  /** Latest ETag the section was hydrated from (used as `If-Match`). */
  etag: string | null;
  /** Called after a successful save so the parent can refetch + invalidate caches. */
  onSuccess?: () => void | Promise<void>;
}

/**
 * Shared save-mutation helper for the Slice-3 settings sections.
 *
 * Each section serializes its body as JSON, sends a PUT with `If-Match`,
 * and on `412` surfaces a `ConflictState` payload so the parent can render
 * a `ConflictDialog`. A non-OK response that isn't 412 is exposed as an
 * inline error string — the section banner shows it without unmounting
 * the form so the operator's edits stay alive.
 */
export function useSectionSave(opts: UseSectionSaveOpts) {
  const { url, conflictReadUrl, etag, onSuccess } = opts;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-clear the success banner after 3s so the dirty/save indicator
  // doesn't stay green forever next to an idle form.
  useEffect(() => {
    if (!success) return;
    successTimerRef.current = setTimeout(() => setSuccess(null), 3000);
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, [success]);

  async function save(body: unknown, method: 'PUT' | 'DELETE' = 'PUT'): Promise<SectionSaveResult> {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(etag ? { 'If-Match': etag } : {}),
        },
        body: method === 'DELETE' ? undefined : JSON.stringify(body),
      });
      if (res.status === 412) {
        let remote = '(failed to load current server state)';
        try {
          const r = await fetch(conflictReadUrl);
          if (r.ok) {
            const j = await r.json();
            remote = JSON.stringify(j, null, 2);
          }
        } catch {
          /* fall through */
        }
        setConflict({
          localContent: JSON.stringify(body ?? null, null, 2),
          remoteContent: remote,
        });
        return { ok: false, status: 412 };
      }
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const message = (errBody as any)?.error ?? `HTTP ${res.status}`;
        setError(message);
        return { ok: false, status: res.status, error: message };
      }
      setSuccess('Saved.');
      await onSuccess?.();
      return { ok: true, status: res.status };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      return { ok: false, status: 0, error: message };
    } finally {
      setBusy(false);
    }
  }

  return {
    busy,
    error,
    success,
    conflict,
    clearStatus: () => {
      setError(null);
      setSuccess(null);
    },
    dismissConflict: () => setConflict(null),
    save,
  };
}
