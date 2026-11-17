import { useQuery } from '@tanstack/react-query';
import { matchKey } from '@iptv/core';
import { db, type TmdbInfo } from '../db/db';
import { API_BASE, TMDB_IMG } from '../env';
import { fetchJson } from '../lib/http';
import { useAuth } from '../state/auth';

const TTL = 30 * 86400_000;

// Simple concurrency limiter so a scrolled grid never floods TMDB (≈ 20 req/s max).
let active = 0;
const queue: (() => void)[] = [];
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= 4) await new Promise<void>((r) => queue.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    setTimeout(() => queue.shift()?.(), 50);
  }
}

type Raw = Record<string, any>;
const tmdb = (path: string, params: Record<string, string>) => {
  const t = useAuth.getState().proxyToken;
  const q = new URLSearchParams(t ? { ...params, t } : params);
  return limited(() => fetchJson(`${API_BASE}/tmdb/3${path}?${q}`, {}, 15_000)) as Promise<Raw>;
};

export const tmdbImg = (path: string | undefined, size: 'w185' | 'w342' | 'w780' | 'w1280' | 'h632' = 'w342') =>
  path ? `${TMDB_IMG}/${size}${path}` : undefined;

export interface TmdbQuery {
  type: 'movie' | 'tv';
  title: string;
  year?: number;
  tmdbId?: number;
  lang: string;
  full?: boolean; // details with cast/videos/similar
}

async function resolve(q: TmdbQuery): Promise<TmdbInfo | null> {
  if (!API_BASE) return null;
  const language = q.lang === 'ar' ? 'ar-EG' : 'en-US';
  const key = `${q.type}:${q.tmdbId ?? matchKey(q.title, q.year)}:${q.lang}:${q.full ? 'f' : 's'}`;
  const cached = await db.tmdb.get(key);
  if (cached && Date.now() - cached.fetchedAt < TTL) return cached.data;

  let id = q.tmdbId;
  let hit: Raw | undefined;
  if (!id) {
    const params: Record<string, string> = { query: q.title, language, include_adult: 'false' };
    if (q.year) params[q.type === 'tv' ? 'first_air_date_year' : 'year'] = String(q.year);
    let res = await tmdb(`/search/${q.type}`, params);
    if (!res?.results?.length && q.year) {
      delete params.year;
      delete params.first_air_date_year;
      res = await tmdb(`/search/${q.type}`, params);
    }
    hit = res?.results?.[0];
    id = hit?.id;
  }
  let data: TmdbInfo | null = null;
  if (id && (q.full || !hit)) {
    const d = await tmdb(`/${q.type}/${id}`, { language, append_to_response: 'credits,videos,similar' });
    const date: string = d.release_date ?? d.first_air_date ?? '';
    const trailer = (d.videos?.results ?? []).find((v: Raw) => v.site === 'YouTube' && v.type === 'Trailer') ?? (d.videos?.results ?? [])[0];
    data = {
      id, type: q.type, title: d.title ?? d.name ?? q.title, overview: d.overview || undefined,
      poster: d.poster_path ?? undefined, backdrop: d.backdrop_path ?? undefined,
      rating: d.vote_average || undefined, year: Number(date.slice(0, 4)) || undefined,
      runtime: d.runtime ?? d.episode_run_time?.[0],
      genres: (d.genres ?? []).map((g: Raw) => g.name),
      cast: (d.credits?.cast ?? []).slice(0, 15).map((c: Raw) => ({ name: c.name, character: c.character, photo: c.profile_path ?? undefined })),
      trailerKey: trailer?.key,
      similar: (d.similar?.results ?? []).slice(0, 20).map((s: Raw) => ({ id: s.id, title: s.title ?? s.name, poster: s.poster_path ?? undefined })),
    };
  } else if (hit) {
    const date: string = hit.release_date ?? hit.first_air_date ?? '';
    data = {
      id: hit.id, type: q.type, title: hit.title ?? hit.name, overview: hit.overview || undefined,
      poster: hit.poster_path ?? undefined, backdrop: hit.backdrop_path ?? undefined, rating: hit.vote_average || undefined,
      year: Number(date.slice(0, 4)) || undefined, genres: [], cast: [], similar: [],
    };
  }
  await db.tmdb.put({ key, fetchedAt: Date.now(), data });
  return data;
}

export function useTmdb(q: TmdbQuery | null) {
  return useQuery({
    queryKey: ['tmdb', q?.type, q?.tmdbId ?? q?.title, q?.year, q?.lang, q?.full],
    enabled: !!q && !!API_BASE,
    queryFn: () => resolve(q!),
    staleTime: Infinity,
  });
}

export const tmdbEnabled = () => !!API_BASE;
