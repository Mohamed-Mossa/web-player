export type Kind = 'movie' | 'series' | 'live';
export type PlaylistType = 'xtream' | 'm3u';

export interface XtreamCredentials {
  server: string; // normalized: scheme://host[:port]
  username: string;
  password: string;
}

export interface M3UCredentials {
  url: string;
  epgUrl?: string;
}

export type PlaylistSecret =
  | ({ type: 'xtream' } & XtreamCredentials)
  | ({ type: 'm3u' } & M3UCredentials);

export interface AccountInfo {
  status: string; // Active, Expired, Banned, Disabled …
  expiresAt: number | null; // epoch ms, null = unlimited
  isTrial: boolean;
  activeConnections: number;
  maxConnections: number;
  createdAt: number | null;
  allowedFormats: string[];
  serverTimezone?: string;
}

export interface Category {
  playlistId: string;
  kind: Kind;
  id: string;
  name: string;
  order: number;
}

interface CatalogBase {
  playlistId: string;
  id: string;
  rawName: string;
  title: string;
  categoryId: string;
  /** hash of the source row, used for incremental diffs */
  hash: string;
}

export interface VodItem extends CatalogBase {
  kind: 'movie';
  year?: number;
  rating?: number; // 0..10
  genres: string[];
  addedAt: number; // epoch seconds, 0 when unknown
  poster?: string;
  ext?: string; // container extension (mp4, mkv…)
  tmdbId?: number;
  /** M3U only: stream URL; credentials replaced with {u}/{p} placeholders when detected */
  url?: string;
}

export interface SeriesItem extends CatalogBase {
  kind: 'series';
  year?: number;
  rating?: number;
  genres: string[];
  addedAt: number; // last_modified for Xtream
  poster?: string;
  plot?: string;
  tmdbId?: number;
}

export interface LiveItem extends CatalogBase {
  kind: 'live';
  num: number;
  epgChannelId?: string;
  logo?: string;
  archiveDays: number;
  url?: string;
}

export type CatalogItem = VodItem | SeriesItem | LiveItem;

export interface Episode {
  id: string;
  season: number;
  episode: number;
  title: string;
  ext?: string;
  durationSec?: number;
  plot?: string;
  still?: string;
  url?: string;
}

export interface SeriesDetail {
  playlistId: string;
  id: string;
  seasons: { season: number; name: string; episodes: Episode[] }[];
  plot?: string;
  cast?: string;
  director?: string;
  backdrop?: string;
  fetchedAt: number;
}

export interface CatalogSnapshot {
  categories: Category[];
  movies: VodItem[];
  series: SeriesItem[];
  live: LiveItem[];
  /** M3U only: episodes grouped under synthetic series */
  seriesDetails?: SeriesDetail[];
  epgUrl?: string;
}
