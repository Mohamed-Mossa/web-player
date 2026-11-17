import {
  XtreamClient, XtreamError, credsFromM3UUrl, normalizeServer, type AccountInfo, type PlaylistSecret,
} from '@iptv/core';
import { db } from '../db/db';
import { saveSecret } from '../lib/crypto';
import { fetchJson } from '../lib/http';
import { queryClient } from '../lib/query';
import { netConfig, syncPlaylist } from '../sync/catalogSync';

export interface AddResult {
  id: string;
  convertedToXtream?: boolean;
}

async function tryXtream(server: string, username: string, password: string) {
  const creds = { server, username, password };
  const t0 = performance.now();
  const account = await new XtreamClient(creds, (u) => fetchJson(u, netConfig(), 20_000)).authenticate();
  return { creds, account, pingMs: Math.round(performance.now() - t0) };
}

export async function addPlaylist(
  input: { type: 'xtream'; name: string; server: string; username: string; password: string } | { type: 'm3u'; name: string; url: string; epgUrl?: string },
): Promise<AddResult> {
  let secret: PlaylistSecret;
  let account: AccountInfo | undefined;
  let pingMs: number | undefined;
  let converted = false;
  let host = '';

  if (input.type === 'xtream') {
    const n = normalizeServer(input.server);
    const r = await tryXtream(n.server, input.username.trim() || n.username || '', input.password || n.password || '');
    secret = { type: 'xtream', ...r.creds };
    account = r.account;
    pingMs = r.pingMs;
    host = new URL(n.server).host;
  } else {
    const url = input.url.trim();
    const detected = credsFromM3UUrl(url);
    host = new URL(url).host;
    if (detected) {
      try {
        const r = await tryXtream(detected.server, detected.username, detected.password);
        secret = { type: 'xtream', ...r.creds };
        account = r.account;
        pingMs = r.pingMs;
        converted = true;
      } catch (e) {
        if (e instanceof XtreamError && e.code !== 'network' && e.code !== 'format') throw e;
        secret = { type: 'm3u', url, epgUrl: input.epgUrl?.trim() || undefined };
      }
    } else {
      secret = { type: 'm3u', url, epgUrl: input.epgUrl?.trim() || undefined };
    }
  }

  const id = crypto.randomUUID();
  const order = (await db.playlists.count()) as number;
  await saveSecret(id, secret);
  await db.playlists.put({
    id,
    name: input.name.trim() || host,
    type: secret.type,
    order,
    createdAt: Date.now(),
    hostHint: host,
    account,
    accountCheckedAt: account ? Date.now() : undefined,
    pingMs,
  });
  syncPlaylist(id).catch(() => {});
  return { id, convertedToXtream: converted };
}

export async function removePlaylist(id: string) {
  await db.transaction(
    'rw',
    [db.playlists, db.secrets, db.categories, db.movies, db.series, db.live, db.seriesDetail, db.syncMeta, db.favorites, db.categoryPrefs, db.searchIndex],
    async () => {
      await db.playlists.delete(id);
      await db.secrets.delete(id);
      for (const t of [db.categories, db.movies, db.series, db.live, db.seriesDetail, db.syncMeta]) {
        await (t as unknown as { where: (i: string) => { equals: (v: string) => { delete: () => Promise<number> } } })
          .where('playlistId').equals(id).delete();
      }
      await db.favorites.filter((f) => f.playlistId === id).delete();
      await db.categoryPrefs.filter((f) => f.playlistId === id).delete();
      await db.searchIndex.clear();
    },
  );
  queryClient.invalidateQueries({ queryKey: ['catalog'] });
}

export function daysLeft(account?: AccountInfo): number | null {
  if (!account?.expiresAt) return null;
  return Math.ceil((account.expiresAt - Date.now()) / 86400_000);
}
