import { corsHeaders, isAllowedUser, isBlockedTarget, isPlaylist, rewriteM3U8, signToken, verifyToken } from './lib';

export interface Env {
  TOKEN_SECRET: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  ALLOWED_USERS: string;
  ALLOWED_ORIGINS: string;
  TMDB_API_KEY?: string;
  OPENSUBTITLES_API_KEY?: string;
  OPENSUBTITLES_USERNAME?: string;
  OPENSUBTITLES_PASSWORD?: string;
}

const TOKEN_TTL = 6 * 3600;
// Many panels refuse browser user agents; a player UA is what they expect.
const DEFAULT_UA = 'VLC/3.0.20 LibVLC/3.0.20';
const PASS_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag'];

function json(data: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

async function issueToken(req: Request, env: Env, cors: Record<string, string>) {
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return json({ error: 'missing session' }, 401, cors);
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: auth } });
  if (!r.ok) return json({ error: 'invalid session' }, 401, cors);
  const user = (await r.json()) as { id: string; email?: string };
  if (!isAllowedUser(env.ALLOWED_USERS ?? '', user)) return json({ error: 'not allowed' }, 403, cors);
  const token = await signToken(env.TOKEN_SECRET, user.id, TOKEN_TTL);
  return json({ token, expiresIn: TOKEN_TTL }, 200, cors);
}

async function proxy(req: Request, url: URL, env: Env, cors: Record<string, string>) {
  const target = url.searchParams.get('u');
  const token = url.searchParams.get('t');
  if (!(await verifyToken(env.TOKEN_SECRET, token))) return json({ error: 'unauthorized' }, 401, cors);
  if (!target || isBlockedTarget(target)) return json({ error: 'bad target' }, 400, cors);

  const headers = new Headers({ 'User-Agent': url.searchParams.get('ua') || DEFAULT_UA, Accept: '*/*' });
  const range = req.headers.get('Range');
  if (range) headers.set('Range', range);
  const ref = url.searchParams.get('ref');
  if (ref) headers.set('Referer', ref);

  let upstream: Response;
  try {
    upstream = await fetch(target, { method: req.method === 'HEAD' ? 'HEAD' : 'GET', headers, redirect: 'follow' });
  } catch (e) {
    return json({ error: 'upstream unreachable', detail: String(e) }, 502, cors);
  }

  const out = new Headers(cors);
  for (const h of PASS_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  out.set('Cache-Control', 'no-store');

  const ct = upstream.headers.get('content-type');
  const finalUrl = upstream.url || target;
  const maybeText = !ct || /mpegurl|text|octet-stream/i.test(ct);
  const small = Number(upstream.headers.get('content-length') ?? '0') < 2_000_000;
  if (upstream.ok && maybeText && small && req.method !== 'HEAD' && (/\.m3u8(\?|$)/i.test(finalUrl) || /mpegurl/i.test(ct ?? ''))) {
    const body = await upstream.text();
    if (isPlaylist(ct, finalUrl, body.slice(0, 512))) {
      const base = `${url.origin}/p`;
      const extra = new URLSearchParams();
      if (url.searchParams.get('ua')) extra.set('ua', url.searchParams.get('ua')!);
      if (ref) extra.set('ref', ref);
      const wrap = (u: string) => `${base}?${new URLSearchParams({ u, t: token! })}${extra.size ? `&${extra}` : ''}`;
      out.set('content-type', 'application/vnd.apple.mpegurl');
      out.delete('content-length');
      return new Response(rewriteM3U8(body, finalUrl, wrap), { status: upstream.status, headers: out });
    }
    return new Response(body, { status: upstream.status, headers: out });
  }
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

async function tmdb(url: URL, env: Env, cors: Record<string, string>, ctx: ExecutionContext) {
  if (!env.TMDB_API_KEY) return json({ error: 'TMDB not configured' }, 501, cors);
  const path = url.pathname.replace(/^\/tmdb/, '');
  const q = new URLSearchParams(url.searchParams);
  q.delete('t');
  const bearer = env.TMDB_API_KEY.startsWith('eyJ');
  if (!bearer) q.set('api_key', env.TMDB_API_KEY);
  const target = `https://api.themoviedb.org${path}?${q}`;
  const cache = (caches as unknown as { default: Cache }).default;
  const cacheKey = new Request(target.replace(/api_key=[^&]+/, ''));
  const hit = await cache.match(cacheKey);
  if (hit) return new Response(hit.body, { status: hit.status, headers: { ...cors, 'Content-Type': 'application/json', 'X-Cache': 'HIT' } });
  const r = await fetch(target, { headers: bearer ? { Authorization: `Bearer ${env.TMDB_API_KEY}` } : {} });
  const body = await r.text();
  if (r.ok) ctx.waitUntil(cache.put(cacheKey, new Response(body, { headers: { 'Cache-Control': 'public, max-age=86400' } })));
  return new Response(body, { status: r.status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

let osToken: { value: string; exp: number } | null = null;
async function openSubtitles(req: Request, url: URL, env: Env, cors: Record<string, string>) {
  if (!env.OPENSUBTITLES_API_KEY) return json({ error: 'OpenSubtitles not configured' }, 501, cors);
  const base = 'https://api.opensubtitles.com/api/v1';
  const headers: Record<string, string> = {
    'Api-Key': env.OPENSUBTITLES_API_KEY,
    'User-Agent': 'IPTVPlayer v0.1',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (env.OPENSUBTITLES_USERNAME && env.OPENSUBTITLES_PASSWORD) {
    if (!osToken || osToken.exp < Date.now()) {
      const r = await fetch(`${base}/login`, { method: 'POST', headers, body: JSON.stringify({ username: env.OPENSUBTITLES_USERNAME, password: env.OPENSUBTITLES_PASSWORD }) });
      if (r.ok) osToken = { value: ((await r.json()) as { token: string }).token, exp: Date.now() + 12 * 3600_000 };
    }
    if (osToken) headers.Authorization = `Bearer ${osToken.value}`;
  }
  const path = url.pathname.replace(/^\/os/, '');
  if (path === '/subtitles') {
    const q = new URLSearchParams(url.searchParams);
    q.delete('t');
    const r = await fetch(`${base}/subtitles?${q}`, { headers });
    return new Response(await r.text(), { status: r.status, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
  if (path === '/download' && req.method === 'POST') {
    const r = await fetch(`${base}/download`, { method: 'POST', headers, body: await req.text() });
    const data = (await r.json()) as { link?: string; message?: string };
    if (!r.ok || !data.link) return json({ error: data.message ?? 'download failed' }, r.status || 502, cors);
    const file = await fetch(data.link);
    return new Response(await file.text(), { status: 200, headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  return json({ error: 'not found' }, 404, cors);
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const cors = corsHeaders(req.headers.get('Origin'), (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean));
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      if (url.pathname === '/token' && req.method === 'POST') return await issueToken(req, env, cors);
      if (url.pathname === '/health') return json({ ok: true }, 200, cors);
      // Everything below requires a valid proxy token.
      if (url.pathname === '/p') return await proxy(req, url, env, cors);
      if (!(await verifyToken(env.TOKEN_SECRET, url.searchParams.get('t') ?? req.headers.get('Authorization')?.replace(/^Proxy /, '') ?? null))) {
        return json({ error: 'unauthorized' }, 401, cors);
      }
      if (url.pathname.startsWith('/tmdb/')) return await tmdb(url, env, cors, ctx);
      if (url.pathname.startsWith('/os/')) return await openSubtitles(req, url, env, cors);
      return json({ error: 'not found' }, 404, cors);
    } catch (e) {
      return json({ error: 'internal', detail: String(e) }, 500, cors);
    }
  },
};
