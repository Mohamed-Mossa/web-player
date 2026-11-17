import { useQuery } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import { XtreamClient, type Kind, type SeriesDetail } from '@iptv/core';
import { catalogTable, db, type Favorite } from '../db/db';
import { loadSecret } from '../lib/crypto';
import { fetchJson } from '../lib/http';
import { netConfig } from '../sync/catalogSync';

export function useItem(kind: Kind, playlistId: string, id: string) {
  return useLiveQuery(async () => (await catalogTable(kind).get([playlistId, id])) ?? null, [kind, playlistId, id]);
}

const SERIES_TTL = 6 * 3600_000;

export function useSeriesDetail(playlistId: string, seriesId: string) {
  return useQuery({
    queryKey: ['seriesDetail', playlistId, seriesId],
    queryFn: async (): Promise<SeriesDetail | null> => {
      const cached = await db.seriesDetail.get([playlistId, seriesId]);
      const secret = await loadSecret(playlistId);
      if (secret?.type !== 'xtream') return cached ?? null; // M3U: built during sync
      if (cached && Date.now() - cached.fetchedAt < SERIES_TTL) return cached;
      try {
        const fresh = await new XtreamClient(secret, (u) => fetchJson(u, netConfig(), 30_000)).seriesInfo(playlistId, seriesId);
        await db.seriesDetail.put(fresh);
        return fresh;
      } catch (e) {
        if (cached) return cached;
        throw e;
      }
    },
  });
}

export function useFavorites(profileId: string | null, kind?: Kind) {
  return useLiveQuery(async () => {
    if (!profileId) return [];
    const rows = kind
      ? await db.favorites.where('[profileId+kind]').equals([profileId, kind]).toArray()
      : await db.favorites.where('profileId').equals(profileId).toArray();
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  }, [profileId, kind]);
}

export function useIsFavorite(profileId: string | null, kind: Kind, playlistId: string, itemId: string) {
  return useLiveQuery(
    async () => (profileId ? !!(await db.favorites.get([profileId, kind, playlistId, itemId])) : false),
    [profileId, kind, playlistId, itemId],
  );
}

export async function toggleFavorite(fav: Omit<Favorite, 'createdAt'>) {
  const key: [string, string, string, string] = [fav.profileId, fav.kind, fav.playlistId, fav.itemId];
  if (await db.favorites.get(key)) await db.favorites.delete(key);
  else await db.favorites.put({ ...fav, createdAt: Date.now() });
}
