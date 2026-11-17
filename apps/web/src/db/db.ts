import Dexie, { type EntityTable, type Table } from 'dexie';
import type {
  AccountInfo, Category, Kind, LiveItem, PlaylistType, SeriesDetail, SeriesItem, VodItem,
} from '@iptv/core';

export interface Playlist {
  id: string;
  name: string;
  type: PlaylistType;
  order: number;
  createdAt: number;
  hostHint: string; // host only, for display; no credentials
  account?: AccountInfo;
  accountCheckedAt?: number;
  pingMs?: number;
  lastSyncAt?: number;
  syncError?: string;
  counts?: { movie: number; series: number; live: number };
}

export interface SecretRow {
  playlistId: string;
  iv: Uint8Array;
  data: ArrayBuffer;
}

export interface KeyRow {
  id: string;
  key: CryptoKey;
}

export interface Profile {
  id: string;
  name: string;
  color: string;
  order: number;
  pinHash?: string;
  pinSalt?: string;
  createdAt: number;
}

export interface Favorite {
  profileId: string;
  kind: Kind;
  playlistId: string;
  itemId: string;
  title: string;
  poster?: string;
  createdAt: number;
}

export interface CategoryPref {
  profileId: string;
  playlistId: string;
  kind: Kind;
  categoryId: string;
  hidden?: boolean;
  customName?: string;
  sortOrder?: number;
}

export interface Progress {
  profileId: string;
  kind: 'movie' | 'episode';
  playlistId: string;
  itemId: string;
  seriesId?: string;
  season?: number;
  episode?: number;
  title: string;
  poster?: string;
  positionSec: number;
  durationSec: number;
  completed: boolean;
  lastWatchedAt: number;
}

export interface TmdbCacheRow {
  key: string;
  fetchedAt: number;
  data: TmdbInfo | null;
}

export interface TmdbInfo {
  id: number;
  type: 'movie' | 'tv';
  title: string;
  overview?: string;
  poster?: string;
  backdrop?: string;
  rating?: number;
  year?: number;
  runtime?: number;
  genres: string[];
  cast: { name: string; character?: string; photo?: string }[];
  trailerKey?: string;
  similar: { id: number; title: string; poster?: string }[];
}

export interface SearchIndexRow {
  id: string;
  signature: string;
  json: string;
}

export interface SyncMeta {
  playlistId: string;
  kind: Kind;
  lastFullSync: number;
  itemCount: number;
}

export class IptvDB extends Dexie {
  playlists!: EntityTable<Playlist, 'id'>;
  secrets!: EntityTable<SecretRow, 'playlistId'>;
  keys!: EntityTable<KeyRow, 'id'>;
  categories!: Table<Category, [string, string, string]>;
  movies!: Table<VodItem, [string, string]>;
  series!: Table<SeriesItem, [string, string]>;
  live!: Table<LiveItem, [string, string]>;
  seriesDetail!: Table<SeriesDetail, [string, string]>;
  profiles!: EntityTable<Profile, 'id'>;
  favorites!: Table<Favorite, [string, string, string, string]>;
  categoryPrefs!: Table<CategoryPref, [string, string, string, string]>;
  progress!: Table<Progress, [string, string, string, string]>;
  tmdb!: EntityTable<TmdbCacheRow, 'key'>;
  searchIndex!: EntityTable<SearchIndexRow, 'id'>;
  syncMeta!: Table<SyncMeta, [string, string]>;

  constructor(name = 'iptv') {
    super(name);
    this.version(1).stores({
      playlists: '&id, order',
      secrets: '&playlistId',
      keys: '&id',
      categories: '&[playlistId+kind+id], playlistId, [playlistId+kind]',
      movies: '&[playlistId+id], playlistId, categoryId, addedAt',
      series: '&[playlistId+id], playlistId, categoryId, addedAt',
      live: '&[playlistId+id], playlistId, categoryId, num',
      seriesDetail: '&[playlistId+id], playlistId',
      profiles: '&id, order',
      favorites: '&[profileId+kind+playlistId+itemId], profileId, [profileId+kind], createdAt',
      categoryPrefs: '&[profileId+playlistId+kind+categoryId], [profileId+kind]',
      progress: '&[profileId+kind+playlistId+itemId], profileId, [profileId+seriesId], lastWatchedAt',
      tmdb: '&key, fetchedAt',
      searchIndex: '&id',
      syncMeta: '&[playlistId+kind], playlistId',
    });
  }
}

export const db = new IptvDB();

export const catalogTable = (kind: Kind) =>
  kind === 'movie' ? db.movies : kind === 'series' ? db.series : db.live;
