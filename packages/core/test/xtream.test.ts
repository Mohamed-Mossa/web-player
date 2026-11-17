import { describe, expect, it } from 'vitest';
import { XtreamClient, XtreamError, normalizeServer } from '../src/xtream';

const creds = { server: 'http://h:8080', username: 'u', password: 'p' };

function client(routes: Record<string, unknown>) {
  const calls: string[] = [];
  const c = new XtreamClient(creds, async (url) => {
    calls.push(url);
    const action = new URL(url).searchParams.get('action') ?? '';
    if (!(action in routes)) throw new Error('404');
    return routes[action];
  });
  return { c, calls };
}

describe('normalizeServer', () => {
  it('accepts bare hosts, paths and full M3U links', () => {
    expect(normalizeServer('host.tv:8080')).toEqual({ server: 'http://host.tv:8080', username: undefined, password: undefined });
    expect(normalizeServer('https://host.tv/player_api.php').server).toBe('https://host.tv');
    expect(normalizeServer('http://h:25461/get.php?username=a&password=b&type=m3u')).toEqual({
      server: 'http://h:25461', username: 'a', password: 'b',
    });
  });
});

describe('XtreamClient', () => {
  it('reads account info with string numbers', async () => {
    const { c } = client({
      '': {
        user_info: { auth: 1, status: 'Active', exp_date: '1893456000', is_trial: '0', active_cons: '1', max_connections: '2', created_at: '1700000000', allowed_output_formats: ['m3u8', 'ts'] },
        server_info: { timezone: 'Africa/Cairo' },
      },
    });
    const info = await c.authenticate();
    expect(info).toMatchObject({
      status: 'Active', expiresAt: 1893456000000, activeConnections: 1, maxConnections: 2, isTrial: false,
      allowedFormats: ['m3u8', 'ts'], serverTimezone: 'Africa/Cairo',
    });
  });

  it('treats unlimited expiry as null and rejects bad logins and expired accounts', async () => {
    expect((await client({ '': { user_info: { auth: 1, status: 'Active', exp_date: null } } }).c.authenticate()).expiresAt).toBeNull();
    await expect(client({ '': { user_info: { auth: 0 } } }).c.authenticate()).rejects.toMatchObject({ code: 'auth' });
    await expect(client({ '': { user_info: { auth: 1, status: 'Expired' } } }).c.authenticate()).rejects.toBeInstanceOf(XtreamError);
  });

  it('maps movies, cleaning names and coercing messy fields', async () => {
    const { c } = client({
      get_vod_streams: [
        { stream_id: 10, name: 'HQ | The Matrix (1999)', stream_icon: 'http://i/m.jpg', rating: '8.7', added: '1700000000', category_id: 5, container_extension: 'mkv', genre: 'Action, Sci-Fi', tmdb: '603' },
        { stream_id: '11', name: 'No Rating', stream_icon: '', rating: '', rating_5based: 4, added: null, category_id: '5' },
      ],
    });
    const [a, b] = await c.movies('p1');
    expect(a).toMatchObject({ id: '10', title: 'The Matrix', year: 1999, rating: 8.7, genres: ['Action', 'Sci-Fi'], categoryId: '5', addedAt: 1700000000, ext: 'mkv', tmdbId: 603, poster: 'http://i/m.jpg' });
    expect(b).toMatchObject({ id: '11', rating: 8, addedAt: 0, poster: undefined });
    expect(a.hash).not.toBe(b.hash);
  });

  it('maps live channels with archive days', async () => {
    const { c } = client({ get_live_streams: [{ stream_id: 1, num: 7, name: 'AR | MBC 1 HD', epg_channel_id: 'mbc1', tv_archive: 1, tv_archive_duration: '5', category_id: '1' }] });
    expect((await c.live('p1'))[0]).toMatchObject({ num: 7, title: 'MBC 1 HD', epgChannelId: 'mbc1', archiveDays: 5 });
  });

  it('reads series info whether episodes are an object or an array', async () => {
    const asObject = client({
      get_series_info: {
        seasons: [{ season_number: 1, name: 'Season One' }],
        info: { plot: 'A teacher', backdrop_path: ['http://i/b.jpg'] },
        episodes: { '2': [{ id: '22', episode_num: '1', season: 2, title: 'S2E1', container_extension: 'mp4', info: { duration_secs: 3000 } }], '1': [{ id: '12', episode_num: 2, season: 1 }, { id: '11', episode_num: 1, season: 1 }] },
      },
    });
    const d = await asObject.c.seriesInfo('p1', '9');
    expect(d.seasons.map((s) => s.season)).toEqual([1, 2]);
    expect(d.seasons[0].name).toBe('Season One');
    expect(d.seasons[0].episodes.map((e) => e.id)).toEqual(['11', '12']);
    expect(d.seasons[1].episodes[0].durationSec).toBe(3000);
    expect(d.backdrop).toBe('http://i/b.jpg');

    const asArray = client({ get_series_info: { episodes: [{ id: '1', episode_num: 1, season: 1 }] } });
    expect((await asArray.c.seriesInfo('p1', '9')).seasons).toHaveLength(1);
  });

  it('builds stream and catch-up URLs', () => {
    const c = new XtreamClient({ ...creds, password: 'p@ss' }, async () => ({}));
    expect(c.streamUrl('movie', '10', 'mkv')).toBe('http://h:8080/movie/u/p%40ss/10.mkv');
    expect(c.streamUrl('live', '1')).toBe('http://h:8080/live/u/p%40ss/1.m3u8');
    expect(c.timeshiftUrl('1', new Date(2026, 10, 17, 21, 5), 60)).toBe('http://h:8080/timeshift/u/p%40ss/60/2026-11-17:21-05/1.ts');
  });

  it('wraps transport failures as network errors', async () => {
    const c = new XtreamClient(creds, async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(c.authenticate()).rejects.toMatchObject({ code: 'network' });
  });
});
