import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const TOKEN_FILE = join(homedir(), '.ccwebui', 'token');

/** Returns the persisted access token, creating one on first run. Only used when started with `--token` or CCWEBUI_TOKEN. */
export function loadToken(): string {
  if (process.env.CCWEBUI_TOKEN) return process.env.CCWEBUI_TOKEN;
  if (existsSync(TOKEN_FILE)) {
    const saved = readFileSync(TOKEN_FILE, 'utf8').trim();
    if (saved.length >= 32) return saved;
  }
  const token = randomBytes(24).toString('base64url');
  mkdirSync(join(homedir(), '.ccwebui'), { recursive: true });
  writeFileSync(TOKEN_FILE, token + '\n', { mode: 0o600 });
  try {
    chmodSync(TOKEN_FILE, 0o600);
  } catch {
    // Best effort on Windows.
  }
  return token;
}

export function tokenMatches(expected: string, candidate: string | null | undefined): boolean {
  if (!candidate) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(candidate);
  return a.length === b.length && timingSafeEqual(a, b);
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** DNS-rebinding guard: only accept requests addressed to a loopback host name. */
export function isLoopbackHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  const host = hostHeader.startsWith('[') ? hostHeader.slice(0, hostHeader.indexOf(']') + 1) : hostHeader.split(':')[0];
  return LOOPBACK_HOSTS.has(host.toLowerCase());
}

/**
 * CSRF guard for REST calls: any web page can make the browser send (though not read) a request to this
 * port, and without a token nothing else would stop it. Browsers label such requests: Sec-Fetch-Site says
 * `cross-site`, and POSTs carry the page's Origin.
 */
export function isFromForeignPage(origin: string | undefined, fetchSite: string | undefined): boolean {
  return fetchSite === 'cross-site' || !isLoopbackOrigin(origin);
}

/** Cross-site WebSocket guard: browsers always send Origin; it must be a loopback page. */
export function isLoopbackOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return (url.protocol === 'http:' || url.protocol === 'https:') && isLoopbackHost(url.host);
  } catch {
    return false;
  }
}
