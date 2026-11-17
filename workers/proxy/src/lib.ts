// Pure helpers, unit-tested without the Workers runtime.

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s: string): string {
  return atob(s.replace(/-/g, '+').replace(/_/g, '/'));
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

export interface TokenPayload {
  u: string; // user id
  exp: number; // epoch seconds
}

export async function signToken(secret: string, userId: string, ttlSec: number, now = Date.now()): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify({ u: userId, exp: Math.floor(now / 1000) + ttlSec } satisfies TokenPayload)));
  return `${payload}.${await hmac(secret, payload)}`;
}

export async function verifyToken(secret: string, token: string | null, now = Date.now()): Promise<TokenPayload | null> {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = await hmac(secret, payload);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const p = JSON.parse(fromB64url(payload)) as TokenPayload;
    return p.exp * 1000 > now ? p : null;
  } catch {
    return null;
  }
}

/** Refuse anything that could reach internal networks (SSRF). Hostnames only; IP literals are checked. */
export function isBlockedTarget(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return true;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return true;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return true;
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return true;
  }
  if (h.includes(':') && (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80'))) return true;
  return false;
}

export function isPlaylist(contentType: string | null, url: string, head: string): boolean {
  if (contentType && /mpegurl/i.test(contentType)) return true;
  if (/\.m3u8(\?|$)/i.test(url)) return true;
  return head.trimStart().startsWith('#EXTM3U') && /#EXT-X-/.test(head);
}

/**
 * Rewrite an HLS playlist so every segment, key, sub-playlist and media URI goes through the proxy.
 * `wrap(absoluteUrl)` returns the proxied URL.
 */
export function rewriteM3U8(body: string, baseUrl: string, wrap: (u: string) => string): string {
  const abs = (u: string) => {
    try {
      return new URL(u, baseUrl).toString();
    } catch {
      return u;
    }
  };
  return body
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/g, (_m, u: string) => `URI="${wrap(abs(u))}"`);
      }
      return wrap(abs(t));
    })
    .join('\n');
}

export function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  const ok = origin && (allowed.includes(origin) || allowed.includes('*'));
  return {
    'Access-Control-Allow-Origin': ok ? origin! : allowed[0] ?? 'null',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function isAllowedUser(allowList: string, user: { id: string; email?: string }): boolean {
  const list = allowList.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(user.id.toLowerCase()) || (!!user.email && list.includes(user.email.toLowerCase()));
}
