import { useQuery } from '@tanstack/react-query';

export interface HealthStatus {
  ok: boolean;
  degraded: boolean;
}

/** Shared health query — used by header dot and health view */
export function useHealth(): HealthStatus {
  const { data } = useQuery<{ status?: string; db?: { connected: boolean }; memory?: { degraded: boolean } }>({
    queryKey: ['health'],
    queryFn: () => fetch('/api/v1/health').then((r) => r.json()),
    refetchInterval: 10_000,
    staleTime: 8_000,
  });

  if (!data) return { ok: true, degraded: false };

  const dbOk = data.db?.connected !== false;
  const memOk = data.memory?.degraded !== true;
  const statusOk = !data.status || data.status === 'ok' || data.status === 'healthy';

  const ok = dbOk && memOk && statusOk;
  return { ok, degraded: !ok };
}
