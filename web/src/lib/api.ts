const TOKEN_KEY = 'ccwebui.token';

/** Picks up `#token=…` from the launch URL, then falls back to the saved token (only needed with `--token`). */
export function initToken(): string | null {
  const match = location.hash.match(/token=([^&]+)/);
  if (match) {
    localStorage.setItem(TOKEN_KEY, decodeURIComponent(match[1]));
    history.replaceState(null, '', location.pathname + location.search);
  }
  return localStorage.getItem(TOKEN_KEY);
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class UnauthorizedError extends Error {}

export async function api<T>(path: string, init?: { method: 'POST' | 'DELETE'; body?: unknown }): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  if (init?.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? 'GET',
    headers,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 401) throw new UnauthorizedError('令牌无效');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}
