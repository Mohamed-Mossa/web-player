import { afterEach, describe, expect, it, vi } from 'vitest';
import { corsHeaders, isAllowedUser, isBlockedTarget, rewriteM3U8, signToken, verifyToken } from '../src/lib';
import worker, { type Env } from '../src/index';

const env: Env = {
  TOKEN_SECRET: 'test-secret',
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  ALLOWED_USERS: 'user-1, me@example.com',
  ALLOWED_ORIGINS: 'https://app.example.com,http://localhost:5173',
  TMDB_API_KEY: 'k',
};
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
(globalThis as unknown as { caches: unknown }).caches = { default: { match: async () => undefined, put: async () => {} } };

afterEach(() => vi.restoreAllMocks());

describe('tokens', () => {
  it('round-trips and rejects tampering and expiry', async () => {
    const t = await signToken('s', 'user-1', 60);
    expect((await verifyToken('s', t))?.u).toBe('user-1');
    expect(await verifyToken('other', t)).toBeNull();
    expect(await verifyToken('s', t.slice(0, -2) + 'xx')).toBeNull();
    expect(await verifyToken('s', t, Date.now() + 61_000)).toBeNull();
    expect(await verifyToken('s', null)).toBeNull();
  });
});

describe('helpers', () => {
  it('blocks private and local targets', () => {
    for (const u of ['http://localhost/x', 'http://127.0.0.1/x', 'http://10.0.0.5/x', 'http://192.168.1.2:8080/x', 'http://169.254.169.254/latest', 'http://[::1]/', 'ftp://a.com/x', 'nonsense']) {
      expect(isBlockedTarget(u), u).toBe(true);
    }
    expect(isBlockedTarget('http://iptv.example.com:25461/live/u/p/1.ts')).toBe(false);
  });

  it('rewrites every URI in a playlist to the proxy, resolving relative paths', () => {
    const src = [
      '#EXTM3U',
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="audio/ar.m3u8"',
      '#EXTINF:6.0,',
      'seg1.ts',
      '#EXTINF:6.0,',
      'http://cdn.example.com/seg2.ts',
      '',
    ].join('\n');
    const out = rewriteM3U8(src, 'http://h.example.com/live/u/p/1.m3u8', (u) => `P(${u})`);
    expect(out).toContain('URI="P(http://h.example.com/live/u/p/key.bin)"');
    expect(out).toContain('URI="P(http://h.example.com/live/u/p/audio/ar.m3u8)"');
    expect(out).toContain('P(http://h.example.com/live/u/p/seg1.ts)');
    expect(out).toContain('P(http://cdn.example.com/seg2.ts)');
    expect(out.startsWith('#EXTM3U')).toBe(true);
  });

  it('only echoes allowed origins', () => {
    expect(corsHeaders('https://app.example.com', ['https://app.example.com'])['Access-Control-Allow-Origin']).toBe('https://app.example.com');
    expect(corsHeaders('https://evil.com', ['https://app.example.com'])['Access-Control-Allow-Origin']).toBe('https://app.example.com');
  });

  it('matches allowed users by id or email', () => {
    expect(isAllowedUser('user-1, me@example.com', { id: 'x', email: 'ME@example.com' })).toBe(true);
    expect(isAllowedUser('user-1', { id: 'user-1' })).toBe(true);
    expect(isAllowedUser('user-1', { id: 'user-2', email: 'a@b.c' })).toBe(false);
    expect(isAllowedUser('', { id: 'user-1' })).toBe(false);
  });
});

describe('worker', () => {
  it('issues a token only to an allowed Supabase user', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ id: 'user-1' }), { status: 200 }));
    const r = await worker.fetch(new Request('https://w/token', { method: 'POST', headers: { Authorization: 'Bearer jwt' } }), env, ctx);
    expect(r.status).toBe(200);
    const { token } = (await r.json()) as { token: string };
    expect((await verifyToken(env.TOKEN_SECRET, token))?.u).toBe('user-1');

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ id: 'stranger' }), { status: 200 }));
    const denied = await worker.fetch(new Request('https://w/token', { method: 'POST', headers: { Authorization: 'Bearer jwt' } }), env, ctx);
    expect(denied.status).toBe(403);
  });

  it('refuses proxy calls without a valid token (not an open proxy)', async () => {
    const r = await worker.fetch(new Request('https://w/p?u=http://a.example.com/x.ts'), env, ctx);
    expect(r.status).toBe(401);
    const t = await signToken(env.TOKEN_SECRET, 'user-1', 60);
    const bad = await worker.fetch(new Request(`https://w/p?u=http://127.0.0.1/x&t=${t}`), env, ctx);
    expect(bad.status).toBe(400);
  });

  it('streams media with CORS + Range and rewrites HLS playlists', async () => {
    const t = await signToken(env.TOKEN_SECRET, 'user-1', 60);
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockImplementationOnce(async (input, init) => {
      expect((init?.headers as Headers).get('Range')).toBe('bytes=0-99');
      expect((init?.headers as Headers).get('User-Agent')).toMatch(/VLC/);
      return new Response('BYTES', { status: 206, headers: { 'content-type': 'video/mp2t', 'content-range': 'bytes 0-99/1000' } });
    });
    const media = await worker.fetch(
      new Request(`https://w/p?u=${encodeURIComponent('http://iptv.example.com:8080/movie/u/p/1.mkv')}&t=${t}`, { headers: { Range: 'bytes=0-99', Origin: 'http://localhost:5173' } }),
      env, ctx,
    );
    expect(media.status).toBe(206);
    expect(media.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(media.headers.get('content-range')).toBe('bytes 0-99/1000');

    fetchMock.mockImplementationOnce(async () => {
      const r = new Response('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nseg.ts\n', { headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
      Object.defineProperty(r, 'url', { value: 'http://iptv.example.com:8080/hls/abc/index.m3u8' });
      return r;
    });
    const pl = await worker.fetch(new Request(`https://w/p?u=${encodeURIComponent('http://iptv.example.com:8080/live/u/p/1.m3u8')}&t=${t}`), env, ctx);
    const body = await pl.text();
    expect(body).toContain(`https://w/p?u=${encodeURIComponent('http://iptv.example.com:8080/hls/abc/seg.ts')}&t=`);
  });

  it('relays TMDB with the secret key only for token holders', async () => {
    expect((await worker.fetch(new Request('https://w/tmdb/3/movie/603'), env, ctx)).status).toBe(401);
    const t = await signToken(env.TOKEN_SECRET, 'user-1', 60);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{"id":603}'));
    const r = await worker.fetch(new Request(`https://w/tmdb/3/movie/603?language=ar-EG&t=${t}`), env, ctx);
    expect(r.status).toBe(200);
    const called = String(fetchMock.mock.calls[0][0]);
    expect(called).toContain('api.themoviedb.org/3/movie/603');
    expect(called).toContain('api_key=k');
    expect(called).not.toContain('t=');
  });
});
