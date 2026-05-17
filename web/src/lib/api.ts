export class ApiError extends Error {
  status: number;
  statusText: string;
  body: unknown;

  constructor(message: string, status: number, statusText: string, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
}

export async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  const body = await parseBody(res);

  if (!res.ok) {
    throw new ApiError(errorMessage(body, res), res.status, res.statusText, body);
  }

  return body as T;
}

export async function postJson<T = unknown>(input: RequestInfo | URL, init: RequestInit = {}): Promise<T> {
  return fetchJson<T>(input, { ...init, method: init.method ?? 'POST' });
}

async function parseBody(res: Response): Promise<unknown> {
  if (typeof res.text !== 'function') {
    const maybeJson = res as Response & { json?: () => Promise<unknown> };
    if (typeof maybeJson.json === 'function') return maybeJson.json().catch(() => null);
    return null;
  }
  const text = await res.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorMessage(body: unknown, res: Response): string {
  if (body && typeof body === 'object' && 'error' in body) {
    const error = (body as { error?: unknown }).error;
    if (typeof error === 'string' && error.trim()) return error;
  }
  if (body && typeof body === 'object' && 'message' in body) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  if (typeof body === 'string' && body.trim()) return body;
  return `Request failed with HTTP ${res.status}`;
}
