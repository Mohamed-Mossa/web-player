import type { CatalogSnapshot, Category, Episode, Kind, LiveItem, SeriesDetail, SeriesItem, VodItem } from './models';
import { cleanTitle, seriesKey } from './titleCleaner';
import { hashString } from './hash';

export interface M3UEntry {
  name: string;
  url: string;
  duration: number;
  attrs: Record<string, string>; // tvg-id, tvg-name, tvg-logo, group-title, catchup-days …
  group: string;
  headers?: Record<string, string>; // from #EXTVLCOPT http-user-agent / http-referrer
}

export interface M3UHeader {
  epgUrl?: string;
}

const ATTR_RE = /([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"/g;

function parseExtinf(line: string): { duration: number; attrs: Record<string, string>; name: string } {
  // #EXTINF:-1 tvg-id="x" group-title="A, B",Display Name
  const body = line.slice(line.indexOf(':') + 1);
  let inQuote = false;
  let commaAt = -1;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === ',' && !inQuote) {
      commaAt = i;
      break;
    }
  }
  const head = commaAt >= 0 ? body.slice(0, commaAt) : body;
  const name = commaAt >= 0 ? body.slice(commaAt + 1).trim() : '';
  const duration = parseFloat(head) || -1;
  const attrs: Record<string, string> = {};
  for (const m of head.matchAll(ATTR_RE)) attrs[m[1].toLowerCase()] = m[2];
  return { duration, attrs, name };
}

/**
 * Incremental M3U parser: feed text chunks as they stream in, collect entries per chunk.
 * Works for multi-hundred-MB playlists without holding the whole file.
 */
export class M3UParser {
  header: M3UHeader = {};
  private buf = '';
  private pending: Partial<M3UEntry> | null = null;
  private pendingHeaders: Record<string, string> = {};
  private extgrp = '';

  push(chunk: string): M3UEntry[] {
    this.buf += chunk;
    const out: M3UEntry[] = [];
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      this.line(line, out);
    }
    return out;
  }

  end(): M3UEntry[] {
    const out: M3UEntry[] = [];
    if (this.buf) this.line(this.buf, out);
    this.buf = '';
    return out;
  }

  private line(raw: string, out: M3UEntry[]) {
    const line = raw.replace(/^﻿/, '').trim();
    if (!line) return;
    if (line.startsWith('#EXTM3U')) {
      const attrs: Record<string, string> = {};
      for (const m of line.matchAll(ATTR_RE)) attrs[m[1].toLowerCase()] = m[2];
      const epg = attrs['x-tvg-url'] || attrs['url-tvg'] || attrs['tvg-url'];
      if (epg) this.header.epgUrl = epg.split(',')[0].trim();
      return;
    }
    if (line.startsWith('#EXTINF')) {
      const { duration, attrs, name } = parseExtinf(line);
      this.pending = { duration, attrs, name: name || attrs['tvg-name'] || '' };
      return;
    }
    if (line.startsWith('#EXTGRP:')) {
      this.extgrp = line.slice(8).trim();
      return;
    }
    if (line.startsWith('#EXTVLCOPT:')) {
      const [k, ...v] = line.slice(11).split('=');
      const key = k.trim().toLowerCase();
      if (key === 'http-user-agent') this.pendingHeaders['User-Agent'] = v.join('=').trim();
      if (key === 'http-referrer' || key === 'http-referer') this.pendingHeaders['Referer'] = v.join('=').trim();
      return;
    }
    if (line.startsWith('#')) return;
    // URL line
    const p = this.pending ?? { duration: -1, attrs: {}, name: line };
    const attrs = p.attrs ?? {};
    out.push({
      name: p.name || line,
      url: line,
      duration: p.duration ?? -1,
      attrs,
      group: attrs['group-title'] || this.extgrp || '',
      headers: Object.keys(this.pendingHeaders).length ? this.pendingHeaders : undefined,
    });
    this.pending = null;
    this.pendingHeaders = {};
    this.extgrp = '';
  }
}

export function parseM3U(text: string): { header: M3UHeader; entries: M3UEntry[] } {
  const p = new M3UParser();
  const entries = [...p.push(text), ...p.end()];
  return { header: p.header, entries };
}

const VOD_EXT = /\.(mp4|mkv|avi|mov|m4v|wmv|flv|webm|mpg|mpeg)(\?|$)/i;

export function classifyEntry(e: M3UEntry): Kind {
  const u = e.url.toLowerCase();
  if (/\/series\//.test(u)) return 'series';
  if (/\/movies?\//.test(u)) return 'movie';
  if (VOD_EXT.test(u)) {
    return /S\d{1,2}\s*E\d{1,3}/i.test(e.name) ? 'series' : 'movie';
  }
  return 'live';
}

/**
 * Replace credentials in Xtream-style URLs with {u}/{p} placeholders so the catalog
 * stored in IndexedDB holds no secrets: http://h/live/user/pass/1.ts → http://h/live/{u}/{p}/1.ts
 */
export function templatizeUrl(url: string, user?: string, pass?: string): string {
  if (!user || !pass) return url;
  return url.split(`/${user}/${pass}/`).join('/{u}/{p}/');
}

export function fillUrl(url: string, user?: string, pass?: string): string {
  if (!user || !pass) return url;
  return url.replace('/{u}/{p}/', `/${encodeURIComponent(user)}/${encodeURIComponent(pass)}/`);
}

/** Pulls credentials from an M3U URL like get.php?username=u&password=p */
export function credsFromM3UUrl(url: string): { server: string; username: string; password: string } | null {
  try {
    const u = new URL(url);
    const username = u.searchParams.get('username');
    const password = u.searchParams.get('password');
    if (!username || !password) return null;
    return { server: `${u.protocol}//${u.host}`, username, password };
  } catch {
    return null;
  }
}

/** Accumulates entries into a CatalogSnapshot for one playlist. */
export class M3UCatalogBuilder {
  private cats = new Map<string, Category>();
  private movies: VodItem[] = [];
  private live: LiveItem[] = [];
  private series = new Map<string, { item: SeriesItem; episodes: Episode[] }>();
  private liveNum = 0;

  constructor(
    private playlistId: string,
    private creds?: { username: string; password: string },
  ) {}

  private category(kind: Kind, name: string): string {
    const label = name || 'Uncategorized';
    const id = `${kind}:${hashString(label)}`;
    if (!this.cats.has(id)) {
      this.cats.set(id, { playlistId: this.playlistId, kind, id, name: label, order: this.cats.size });
    }
    return id;
  }

  add(entries: M3UEntry[]) {
    for (const e of entries) {
      const kind = classifyEntry(e);
      const url = templatizeUrl(e.url, this.creds?.username, this.creds?.password);
      const idPath = url.replace(/^[a-z]+:\/\/[^/]+/i, '');
      const id = hashString(idPath);
      const categoryId = this.category(kind, e.group);
      const logo = e.attrs['tvg-logo'] || undefined;
      if (kind === 'live') {
        const name = cleanTitle(e.name, 'live').title;
        this.live.push({
          kind: 'live', playlistId: this.playlistId, id, rawName: e.name, title: name, categoryId,
          num: Number(e.attrs['tvg-chno']) || ++this.liveNum,
          epgChannelId: e.attrs['tvg-id'] || undefined,
          logo,
          archiveDays: Number(e.attrs['catchup-days'] || e.attrs['timeshift'] || 0) || 0,
          url,
          hash: hashString(`${e.name}|${url}|${logo}|${e.group}`),
        });
      } else if (kind === 'movie') {
        const c = cleanTitle(e.name, 'movie');
        this.movies.push({
          kind: 'movie', playlistId: this.playlistId, id, rawName: e.name, title: c.title, year: c.year,
          genres: [], addedAt: 0, categoryId, poster: logo, url,
          ext: /\.([a-z0-9]{2,4})(\?|$)/i.exec(url)?.[1]?.toLowerCase(),
          hash: hashString(`${e.name}|${url}|${logo}|${e.group}`),
        });
      } else {
        const c = cleanTitle(e.name, 'series');
        const key = seriesKey(e.name);
        const sid = hashString(`${categoryId}|${key}`);
        let s = this.series.get(sid);
        if (!s) {
          s = {
            item: {
              kind: 'series', playlistId: this.playlistId, id: sid, rawName: c.title, title: c.title, year: c.year,
              genres: [], addedAt: 0, categoryId, poster: logo, hash: '',
            },
            episodes: [],
          };
          this.series.set(sid, s);
        }
        s.episodes.push({
          id, season: c.season ?? 1, episode: c.episode ?? s.episodes.length + 1, title: e.name, url,
          ext: /\.([a-z0-9]{2,4})(\?|$)/i.exec(url)?.[1]?.toLowerCase(),
        });
      }
    }
  }

  build(epgUrl?: string): CatalogSnapshot {
    const seriesDetails: SeriesDetail[] = [];
    const series: SeriesItem[] = [];
    for (const { item, episodes } of this.series.values()) {
      const bySeason = new Map<number, Episode[]>();
      for (const ep of episodes) {
        if (!bySeason.has(ep.season)) bySeason.set(ep.season, []);
        bySeason.get(ep.season)!.push(ep);
      }
      const seasons = [...bySeason.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([season, eps]) => ({ season, name: `Season ${season}`, episodes: eps.sort((a, b) => a.episode - b.episode) }));
      item.hash = hashString(episodes.map((e) => e.id).join(','));
      series.push(item);
      seriesDetails.push({ playlistId: this.playlistId, id: item.id, seasons, fetchedAt: Date.now() });
    }
    return {
      categories: [...this.cats.values()],
      movies: this.movies,
      live: this.live,
      series,
      seriesDetails,
      epgUrl,
    };
  }
}
