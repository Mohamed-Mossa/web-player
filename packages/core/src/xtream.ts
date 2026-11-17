import type {
  AccountInfo, CatalogSnapshot, Category, Episode, Kind, LiveItem, SeriesDetail, SeriesItem, VodItem, XtreamCredentials,
} from './models';
import { cleanTitle } from './titleCleaner';
import { hashString } from './hash';

export type FetchJson = (url: string) => Promise<unknown>;

export class XtreamError extends Error {
  constructor(
    public code: 'auth' | 'expired' | 'banned' | 'network' | 'format',
    message: string,
  ) {
    super(message);
  }
}

// ---------- coercion helpers (panels send numbers as strings, "" or null) ----------
type Raw = Record<string, unknown>;
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).trim();
const num = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const int = (v: unknown, d = 0) => Math.trunc(num(v) ?? d);
const url = (v: unknown) => {
  const s = str(v);
  return /^https?:\/\//i.test(s) ? s : undefined;
};
const genres = (v: unknown) =>
  str(v)
    .split(/[,/|]/)
    .map((g) => g.trim())
    .filter(Boolean);
const yearFrom = (...vals: unknown[]) => {
  for (const v of vals) {
    const m = /((?:19|20)\d{2})/.exec(str(v));
    if (m) return Number(m[1]);
  }
  return undefined;
};
const rating = (r: unknown, r5: unknown) => {
  const a = num(r);
  if (a !== undefined && a > 0) return Math.min(10, a);
  const b = num(r5);
  return b !== undefined && b > 0 ? Math.min(10, b * 2) : undefined;
};
const tmdb = (v: unknown) => {
  const n = num(v);
  return n && n > 0 ? n : undefined;
};

/**
 * Accepts what people paste: "host:8080", "http://host:8080/", ".../player_api.php",
 * or a full M3U link with username/password.
 */
export function normalizeServer(input: string): {
  server: string; username?: string; password?: string;
} {
  let s = input.trim();
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  const u = new URL(s);
  const username = u.searchParams.get('username') ?? undefined;
  const password = u.searchParams.get('password') ?? undefined;
  return { server: `${u.protocol}//${u.host}`, username, password };
}

export class XtreamClient {
  constructor(
    private creds: XtreamCredentials,
    private fetchJson: FetchJson,
  ) {}

  private api(params: Record<string, string> = {}) {
    const q = new URLSearchParams({ username: this.creds.username, password: this.creds.password, ...params });
    return `${this.creds.server}/player_api.php?${q}`;
  }

  private async get(params: Record<string, string> = {}): Promise<unknown> {
    try {
      return await this.fetchJson(this.api(params));
    } catch (e) {
      if (e instanceof XtreamError) throw e;
      throw new XtreamError('network', (e as Error)?.message || 'Network error');
    }
  }

  private async list(action: string, extra: Record<string, string> = {}): Promise<Raw[]> {
    const data = await this.get({ action, ...extra });
    if (Array.isArray(data)) return data as Raw[];
    if (data && typeof data === 'object') return Object.values(data as Raw) as Raw[]; // some panels send objects
    return [];
  }

  async authenticate(): Promise<AccountInfo> {
    const data = (await this.get()) as Raw | null;
    const ui = (data?.user_info ?? null) as Raw | null;
    const si = (data?.server_info ?? {}) as Raw;
    if (!ui || int(ui.auth) !== 1) throw new XtreamError('auth', 'Wrong username or password');
    const status = str(ui.status) || 'Active';
    const exp = num(ui.exp_date);
    const info: AccountInfo = {
      status,
      expiresAt: exp ? exp * 1000 : null,
      isTrial: int(ui.is_trial) === 1,
      activeConnections: int(ui.active_cons),
      maxConnections: int(ui.max_connections, 1),
      createdAt: num(ui.created_at) ? num(ui.created_at)! * 1000 : null,
      allowedFormats: Array.isArray(ui.allowed_output_formats) ? (ui.allowed_output_formats as unknown[]).map(str) : [],
      serverTimezone: str(si.timezone) || undefined,
    };
    if (/expired/i.test(status)) throw new XtreamError('expired', 'Subscription expired');
    if (/banned|disabled/i.test(status)) throw new XtreamError('banned', `Account ${status.toLowerCase()}`);
    return info;
  }

  async categories(playlistId: string, kind: Kind): Promise<Category[]> {
    const action = { movie: 'get_vod_categories', series: 'get_series_categories', live: 'get_live_categories' }[kind];
    const rows = await this.list(action);
    return rows.map((r, i) => ({
      playlistId, kind, id: str(r.category_id), name: str(r.category_name) || 'Uncategorized', order: i,
    }));
  }

  async movies(playlistId: string): Promise<VodItem[]> {
    const rows = await this.list('get_vod_streams');
    return rows.map((r) => {
      const name = str(r.name);
      const c = cleanTitle(name, 'movie');
      return {
        kind: 'movie' as const,
        playlistId,
        id: str(r.stream_id),
        rawName: name,
        title: c.title,
        year: num(r.year) ?? c.year ?? yearFrom(r.releasedate, r.release_date),
        rating: rating(r.rating, r.rating_5based),
        genres: genres(r.genre),
        categoryId: str(r.category_id),
        addedAt: int(r.added),
        poster: url(r.stream_icon),
        ext: str(r.container_extension) || undefined,
        tmdbId: tmdb(r.tmdb ?? r.tmdb_id),
        hash: hashString(`${name}|${r.stream_icon}|${r.rating}|${r.category_id}|${r.container_extension}|${r.added}`),
      };
    });
  }

  async series(playlistId: string): Promise<SeriesItem[]> {
    const rows = await this.list('get_series');
    return rows.map((r) => {
      const name = str(r.name);
      const c = cleanTitle(name, 'series');
      return {
        kind: 'series' as const,
        playlistId,
        id: str(r.series_id),
        rawName: name,
        title: c.title,
        year: c.year ?? yearFrom(r.releaseDate, r.release_date, r.year),
        rating: rating(r.rating, r.rating_5based),
        genres: genres(r.genre),
        categoryId: str(r.category_id),
        addedAt: int(r.last_modified),
        poster: url(r.cover),
        plot: str(r.plot) || undefined,
        tmdbId: tmdb(r.tmdb ?? r.tmdb_id),
        hash: hashString(`${name}|${r.cover}|${r.rating}|${r.category_id}|${r.last_modified}`),
      };
    });
  }

  async live(playlistId: string): Promise<LiveItem[]> {
    const rows = await this.list('get_live_streams');
    return rows.map((r, i) => {
      const name = str(r.name);
      return {
        kind: 'live' as const,
        playlistId,
        id: str(r.stream_id),
        rawName: name,
        title: cleanTitle(name, 'live').title,
        categoryId: str(r.category_id),
        num: int(r.num, i + 1),
        epgChannelId: str(r.epg_channel_id) || undefined,
        logo: url(r.stream_icon),
        archiveDays: int(r.tv_archive) === 1 ? int(r.tv_archive_duration) : 0,
        hash: hashString(`${name}|${r.stream_icon}|${r.category_id}|${r.epg_channel_id}|${r.tv_archive}|${r.num}`),
      };
    });
  }

  async seriesInfo(playlistId: string, seriesId: string): Promise<SeriesDetail> {
    const data = ((await this.get({ action: 'get_series_info', series_id: seriesId })) ?? {}) as Raw;
    const info = (data.info ?? {}) as Raw;
    const seasonMeta = new Map<number, string>();
    if (Array.isArray(data.seasons)) {
      for (const s of data.seasons as Raw[]) seasonMeta.set(int(s.season_number), str(s.name));
    }
    const rawEps = data.episodes ?? {};
    const groups: Raw[][] = Array.isArray(rawEps)
      ? [rawEps as Raw[]]
      : (Object.values(rawEps as Raw) as Raw[][]);
    const bySeason = new Map<number, Episode[]>();
    for (const group of groups) {
      for (const e of Array.isArray(group) ? group : []) {
        const ei = (e.info ?? {}) as Raw;
        const season = int(e.season, 1);
        const ep: Episode = {
          id: str(e.id),
          season,
          episode: int(e.episode_num, 0),
          title: str(e.title),
          ext: str(e.container_extension) || undefined,
          durationSec: num(ei.duration_secs),
          plot: str(ei.plot) || undefined,
          still: url(ei.movie_image),
        };
        if (!bySeason.has(season)) bySeason.set(season, []);
        bySeason.get(season)!.push(ep);
      }
    }
    const seasons = [...bySeason.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([season, eps]) => ({
        season,
        name: seasonMeta.get(season) || `Season ${season}`,
        episodes: eps.sort((a, b) => a.episode - b.episode),
      }));
    const bd = Array.isArray(info.backdrop_path) ? url((info.backdrop_path as unknown[])[0]) : url(info.backdrop_path);
    return {
      playlistId,
      id: seriesId,
      seasons,
      plot: str(info.plot) || undefined,
      cast: str(info.cast) || undefined,
      director: str(info.director) || undefined,
      backdrop: bd,
      fetchedAt: Date.now(),
    };
  }

  async snapshot(playlistId: string, onStep?: (step: string) => void): Promise<CatalogSnapshot> {
    onStep?.('categories');
    const [cm, cs, cl] = await Promise.all([
      this.categories(playlistId, 'movie'),
      this.categories(playlistId, 'series'),
      this.categories(playlistId, 'live'),
    ]);
    onStep?.('live');
    const live = await this.live(playlistId);
    onStep?.('movies');
    const movies = await this.movies(playlistId);
    onStep?.('series');
    const series = await this.series(playlistId);
    return {
      categories: [...cm, ...cs, ...cl],
      movies,
      series,
      live,
      epgUrl: `${this.creds.server}/xmltv.php?username=${encodeURIComponent(this.creds.username)}&password=${encodeURIComponent(this.creds.password)}`,
    };
  }

  streamUrl(kind: Kind, id: string, ext?: string): string {
    const u = encodeURIComponent(this.creds.username);
    const p = encodeURIComponent(this.creds.password);
    const path = kind === 'movie' ? 'movie' : kind === 'series' ? 'series' : 'live';
    const e = ext || (kind === 'live' ? 'm3u8' : 'mp4');
    return `${this.creds.server}/${path}/${u}/${p}/${id}.${e}`;
  }

  /** Catch-up URL; start is the programme start in the server's local time. */
  timeshiftUrl(id: string, start: Date, durationMin: number): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    const t = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}:${pad(start.getHours())}-${pad(start.getMinutes())}`;
    const u = encodeURIComponent(this.creds.username);
    const p = encodeURIComponent(this.creds.password);
    return `${this.creds.server}/timeshift/${u}/${p}/${durationMin}/${t}/${id}.ts`;
  }
}
