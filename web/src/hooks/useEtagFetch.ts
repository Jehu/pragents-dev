import { useEffect, useRef, useState } from 'react';

/**
 * Minimal ETag-aware fetch hook used by the config-ui surfaces.
 *
 * Tracks the most recent ETag the server returned for `url` so subsequent
 * writes can send `If-Match` and so `useConflictDetection` can compare on
 * tab refocus. Re-fetches when `url` changes; otherwise re-uses the cached
 * response and ETag.
 */
export interface EtagFetchState<T> {
  data: T | null;
  etag: string | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useEtagFetch<T>(url: string | null, init?: RequestInit): EtagFetchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [etag, setEtag] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(url !== null);
  const [error, setError] = useState<Error | null>(null);
  const reqIdRef = useRef(0);

  const doFetch = () => {
    if (url === null) return;
    const myId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    fetch(url, init)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const e = res.headers.get('ETag');
        const body = (await res.json()) as T;
        if (reqIdRef.current !== myId) return;
        setData(body);
        setEtag(e);
        setLoading(false);
      })
      .catch((err) => {
        if (reqIdRef.current !== myId) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });
  };

  useEffect(() => {
    doFetch();
    // We intentionally only re-fetch when `url` changes; the caller provides
    // a stable URL or invokes `refetch` manually after mutations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return { data, etag, loading, error, refetch: doFetch };
}
