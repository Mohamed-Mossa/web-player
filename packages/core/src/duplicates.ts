import { matchKey } from './normalize';

export interface Mergeable {
  playlistId: string;
  id: string;
  title: string;
  year?: number;
  tmdbId?: number;
}

export type Merged<T> = T & { alternates: { playlistId: string; id: string }[] };

/**
 * Collapse the same title appearing in several playlists into one entry.
 * Identity = TMDB id when known, else normalized title + year. Items from the same
 * playlist are never merged (they are usually quality variants the user wants to see).
 * The first playlist in `playlistOrder` wins; the others become fallbacks.
 */
export function mergeAcrossPlaylists<T extends Mergeable>(items: T[], playlistOrder: string[]): Merged<T>[] {
  const rank = new Map(playlistOrder.map((p, i) => [p, i]));
  const sorted = [...items].sort((a, b) => (rank.get(a.playlistId) ?? 99) - (rank.get(b.playlistId) ?? 99));
  const byKey = new Map<string, Merged<T>>();
  const out: Merged<T>[] = [];
  for (const it of sorted) {
    const key = it.tmdbId ? `t${it.tmdbId}` : matchKey(it.title, it.year);
    const primary = byKey.get(key);
    if (primary && primary.playlistId !== it.playlistId && !primary.alternates.some((a) => a.playlistId === it.playlistId)) {
      primary.alternates.push({ playlistId: it.playlistId, id: it.id });
      continue;
    }
    const m = { ...it, alternates: [] } as Merged<T>;
    if (!primary) byKey.set(key, m);
    out.push(m);
  }
  return out;
}
