import { XtreamClient, credsFromM3UUrl, fillUrl, type Episode, type LiveItem, type SeriesDetail, type VodItem } from '@iptv/core';
import { db } from '../db/db';
import { loadSecret } from '../lib/crypto';
import { viaProxy } from '../lib/http';
import { directNet } from '../lib/platform';
import { netConfig } from '../sync/catalogSync';
import { detectKind, type StreamSource } from './types';

export type PlayKind = 'movie' | 'episode' | 'live';

/** Builds the playable URL for an item: Xtream URL or M3U URL with credentials restored, proxied on the web. */
export async function resolveStream(kind: PlayKind, playlistId: string, item: VodItem | Episode | LiveItem): Promise<StreamSource> {
  const secret = await loadSecret(playlistId);
  if (!secret) throw new Error('Missing credentials');
  let url: string;
  if (secret.type === 'xtream') {
    const client = new XtreamClient(secret, async () => ({}));
    if (kind === 'live') {
      const pl = await db.playlists.get(playlistId);
      const formats = pl?.account?.allowedFormats ?? [];
      // Web players handle HLS best; ExoPlayer and AVPlay play raw TS with less delay.
      const ext = !directNet() && (formats.length === 0 || formats.includes('m3u8')) ? 'm3u8' : 'ts';
      url = client.streamUrl('live', item.id, ext);
    } else {
      url = client.streamUrl(kind === 'episode' ? 'series' : 'movie', item.id, (item as VodItem | Episode).ext);
    }
  } else {
    const creds = credsFromM3UUrl(secret.url);
    url = fillUrl((item as VodItem).url ?? '', creds?.username, creds?.password);
  }
  const kindHint = detectKind(url);
  return { url: directNet() ? url : viaProxy(url, netConfig()), live: kind === 'live', kindHint };
}

export function flattenEpisodes(d: SeriesDetail | null | undefined): Episode[] {
  return (d?.seasons ?? []).flatMap((s) => s.episodes);
}

export function nextEpisode(d: SeriesDetail | null | undefined, currentId: string): Episode | null {
  const all = flattenEpisodes(d);
  const i = all.findIndex((e) => e.id === currentId);
  return i >= 0 && i + 1 < all.length ? all[i + 1] : null;
}
