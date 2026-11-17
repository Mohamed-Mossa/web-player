import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Progress } from '../db/db';

const DONE_RATIO = 0.92;

export async function getProgress(profileId: string, kind: Progress['kind'], playlistId: string, itemId: string) {
  return db.progress.get([profileId, kind, playlistId, itemId]);
}

export async function saveProgress(p: Omit<Progress, 'completed' | 'lastWatchedAt'> & { completed?: boolean }) {
  const completed = p.completed ?? (p.durationSec > 0 && p.positionSec / p.durationSec >= DONE_RATIO);
  await db.progress.put({ ...p, completed, lastWatchedAt: Date.now() });
}

export async function setWatched(p: Omit<Progress, 'completed' | 'lastWatchedAt' | 'positionSec' | 'durationSec'>, watched: boolean) {
  const key: [string, string, string, string] = [p.profileId, p.kind, p.playlistId, p.itemId];
  const cur = await db.progress.get(key);
  await db.progress.put({ ...p, positionSec: cur?.positionSec ?? 0, durationSec: cur?.durationSec ?? 0, ...cur, completed: watched, lastWatchedAt: Date.now() });
}

/** Episode progress for one series, keyed by episode id. */
export function useSeriesProgress(profileId: string | null, playlistId: string, seriesId: string) {
  return useLiveQuery(async () => {
    if (!profileId) return new Map<string, Progress>();
    const rows = await db.progress.where('[profileId+seriesId]').equals([profileId, seriesId]).toArray();
    return new Map(rows.filter((r) => r.playlistId === playlistId).map((r) => [r.itemId, r]));
  }, [profileId, playlistId, seriesId]);
}

export function useItemProgress(profileId: string | null, kind: Progress['kind'], playlistId: string, itemId: string) {
  return useLiveQuery(async () => (profileId ? (await db.progress.get([profileId, kind, playlistId, itemId])) ?? null : null), [profileId, kind, playlistId, itemId]);
}
