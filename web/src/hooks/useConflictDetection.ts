import { useEffect, useRef } from 'react';

/**
 * Watch a URL's ETag and fire `onStale` when an external edit changed it.
 *
 * The hook checks on:
 * - Mount, once, after the caller's first ETag becomes available.
 * - `document.visibilitychange` to `visible` (tab refocus).
 *
 * Uses HEAD when possible (the server's file-metadata endpoint supports it);
 * falls back to GET for endpoints that don't.
 */
export interface UseConflictDetectionOptions {
  /** Endpoint to poll for ETag changes (typically the same URL used to load the resource). */
  url: string | null;
  /** Operator's last known ETag — comparison happens against this value. */
  currentEtag: string | null;
  /** Called when the upstream ETag differs from `currentEtag`. */
  onStale: (newEtag: string) => void;
  /** When false, the hook is dormant (no listeners attached). Default true. */
  enabled?: boolean;
}

export function useConflictDetection({
  url,
  currentEtag,
  onStale,
  enabled = true,
}: UseConflictDetectionOptions): void {
  const currentEtagRef = useRef(currentEtag);
  const onStaleRef = useRef(onStale);
  currentEtagRef.current = currentEtag;
  onStaleRef.current = onStale;

  useEffect(() => {
    if (!enabled || !url || !currentEtag) return;

    const probe = async () => {
      try {
        const res = await fetch(url, {
          method: 'HEAD',
          headers: { 'If-None-Match': currentEtagRef.current ?? '' },
        });
        if (res.status === 304) return;
        const e = res.headers.get('ETag');
        if (e && e !== currentEtagRef.current) {
          onStaleRef.current(e);
        }
      } catch {
        // Network failures intentionally do not flag stale — the user will see
        // a save-time conflict if their save fails.
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void probe();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [url, currentEtag, enabled]);
}
