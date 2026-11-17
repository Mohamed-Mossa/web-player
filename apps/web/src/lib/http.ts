/**
 * Network layer shared by the main thread and workers.
 * - Web build: requests to providers go through the Worker proxy when one is configured
 *   (needed for CORS and http streams on an https page).
 * - Android (phase 3): native HTTP, no proxy.
 */
export interface NetConfig {
  proxyBase?: string; // e.g. https://iptv-proxy.example.workers.dev
  proxyToken?: string;
}

export function viaProxy(url: string, cfg: NetConfig): string {
  if (!cfg.proxyBase) return url;
  const q = new URLSearchParams({ u: url });
  if (cfg.proxyToken) q.set('t', cfg.proxyToken);
  return `${cfg.proxyBase.replace(/\/$/, '')}/p?${q}`;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function fetchWithTimeout(url: string, cfg: NetConfig, timeoutMs = 60_000, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(viaProxy(url, cfg), { ...init, signal: ctrl.signal });
    if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status}`);
    return res;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new HttpError(0, 'Timed out');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export async function fetchJson(url: string, cfg: NetConfig, timeoutMs?: number): Promise<unknown> {
  const res = await fetchWithTimeout(url, cfg, timeoutMs);
  const text = await res.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(res.status, 'Server did not return JSON');
  }
}
