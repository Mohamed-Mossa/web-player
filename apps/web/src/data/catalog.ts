import { useQuery } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import { mergeAcrossPlaylists, type Category, type Kind, type LiveItem, type SeriesItem, type VodItem } from '@iptv/core';
import { db, catalogTable, type CategoryPref, type Playlist } from '../db/db';
import type { CatalogView } from '../state/app';

export type GridItem = (VodItem | SeriesItem | LiveItem) & { alternates: { playlistId: string; id: string }[] };

export function usePlaylists(): Playlist[] | undefined {
  return useLiveQuery(() => db.playlists.orderBy('order').toArray(), []);
}

/** All items of one kind across playlists, duplicates merged (movies/series). Cached in memory. */
export function useCatalog(kind: Kind) {
  const playlists = usePlaylists();
  const order = (playlists ?? []).map((p) => p.id);
  return useQuery({
    queryKey: ['catalog', kind, order.join(',')],
    enabled: playlists !== undefined,
    queryFn: async (): Promise<GridItem[]> => {
      const rows = (await catalogTable(kind).toArray()) as (VodItem | SeriesItem | LiveItem)[];
      const known = new Set(order);
      const mine = rows.filter((r) => known.has(r.playlistId));
      if (kind === 'live') return mine.map((r) => ({ ...r, alternates: [] }));
      return mergeAcrossPlaylists(mine as (VodItem | SeriesItem)[], order) as GridItem[];
    },
  });
}

export interface CategoryEntry extends Category {
  key: string; // playlistId:id
  label: string;
  hidden: boolean;
  sortOrder: number;
  originalName: string;
}

export const catKey = (playlistId: string, id: string) => `${playlistId}:${id}`;

export function useCategories(kind: Kind, profileId: string | null) {
  const playlists = usePlaylists();
  return useLiveQuery(async () => {
    if (!playlists) return undefined;
    const many = playlists.length > 1;
    const names = new Map(playlists.map((p) => [p.id, p.name]));
    const rank = new Map(playlists.map((p, i) => [p.id, i]));
    const cats = (await db.categories.where('[playlistId+kind]').anyOf(playlists.map((p) => [p.id, kind])).toArray());
    const prefs = profileId ? await db.categoryPrefs.where('[profileId+kind]').equals([profileId, kind]).toArray() : [];
    const pref = new Map(prefs.map((p) => [catKey(p.playlistId, p.categoryId), p]));
    return cats
      .map((c): CategoryEntry => {
        const p = pref.get(catKey(c.playlistId, c.id));
        const base = p?.customName || c.name;
        return {
          ...c,
          key: catKey(c.playlistId, c.id),
          originalName: c.name,
          label: many && !p?.customName ? `${base} · ${names.get(c.playlistId)}` : base,
          hidden: !!p?.hidden,
          sortOrder: p?.sortOrder ?? (rank.get(c.playlistId) ?? 0) * 100000 + c.order,
        };
      })
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [playlists, kind, profileId]);
}

export async function updateCategoryPref(
  profileId: string, kind: Kind, cat: { playlistId: string; id: string }, patch: Partial<CategoryPref>,
) {
  const key: [string, string, string, string] = [profileId, cat.playlistId, kind, cat.id];
  const cur = await db.categoryPrefs.get(key);
  await db.categoryPrefs.put({ profileId, playlistId: cat.playlistId, kind, categoryId: cat.id, ...cur, ...patch });
}

/** Move a category one step up/down: rewrites sortOrder for the visible list so order is explicit. */
export async function moveCategory(profileId: string, kind: Kind, list: CategoryEntry[], index: number, dir: -1 | 1) {
  const j = index + dir;
  if (j < 0 || j >= list.length) return;
  const next = [...list];
  [next[index], next[j]] = [next[j], next[index]];
  await db.transaction('rw', db.categoryPrefs, async () => {
    for (let i = 0; i < next.length; i++) {
      await updateCategoryPref(profileId, kind, next[i], { sortOrder: i });
    }
  });
}

// ---------- filtering / sorting ----------
export function decadeOf(year?: number) {
  if (!year) return null;
  return year < 1990 ? 0 : Math.floor(year / 10) * 10;
}

export function applyView(items: GridItem[], view: CatalogView, cats: CategoryEntry[] | undefined, lang: string): GridItem[] {
  const hidden = new Set((cats ?? []).filter((c) => c.hidden).map((c) => c.key));
  let out = items.filter((it) => !hidden.has(catKey(it.playlistId, it.categoryId)));
  if (view.categoryId) out = out.filter((it) => catKey(it.playlistId, it.categoryId) === view.categoryId);
  if (view.genre) out = out.filter((it) => 'genres' in it && it.genres.includes(view.genre!));
  if (view.decade !== null) out = out.filter((it) => 'year' in it && decadeOf(it.year) === view.decade);
  if (view.minRating) out = out.filter((it) => 'rating' in it && (it.rating ?? 0) >= view.minRating!);
  const collator = new Intl.Collator(lang, { sensitivity: 'base', numeric: true });
  const by = {
    added: (a: GridItem, b: GridItem) =>
      a.kind === 'live' && b.kind === 'live' ? a.num - b.num : ((b as VodItem).addedAt ?? 0) - ((a as VodItem).addedAt ?? 0),
    name: (a: GridItem, b: GridItem) => collator.compare(a.title, b.title),
    year: (a: GridItem, b: GridItem) => ((b as VodItem).year ?? 0) - ((a as VodItem).year ?? 0),
    rating: (a: GridItem, b: GridItem) => ((b as VodItem).rating ?? 0) - ((a as VodItem).rating ?? 0),
  }[view.sort];
  return [...out].sort(by);
}

export function topGenres(items: GridItem[], n = 24): string[] {
  const count = new Map<string, number>();
  for (const it of items) if ('genres' in it) for (const g of it.genres) count.set(g, (count.get(g) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([g]) => g);
}
