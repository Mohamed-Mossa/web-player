/// <reference lib="webworker" />
import 'virtual-worker-polyfills';
import { textDecoderStream } from '../lib/streams';
import {
  M3UCatalogBuilder, M3UParser, XtreamClient, XtreamError, credsFromM3UUrl, diffRows,
  type CatalogItem, type CatalogSnapshot, type Kind, type PlaylistSecret,
} from '@iptv/core';
import type { Table } from 'dexie';
import { db, catalogTable } from '../db/db';
import { HttpError, fetchJson, fetchWithTimeout, type NetConfig } from '../lib/http';
import { saveSecret } from '../lib/crypto';

export type SyncRequest = { type: 'sync'; playlistId: string; secret: PlaylistSecret; net: NetConfig };
export type SyncMessage =
  | { type: 'progress'; playlistId: string; step: string }
  | { type: 'done'; playlistId: string; counts: Record<Kind, number>; changed: number; ms: number }
  | { type: 'error'; playlistId: string; code: string; message: string };

const post = (m: SyncMessage) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);
const CHUNK = 2000;

async function writeRows<T extends CatalogItem>(table: Table<T, [string, string]>, playlistId: string, rows: T[]) {
  const existing = new Map<string, string>();
  await table.where('playlistId').equals(playlistId).each((r) => existing.set(r.id, r.hash));
  const d = diffRows(existing, rows);
  for (let i = 0; i < d.upserts.length; i += CHUNK) await table.bulkPut(d.upserts.slice(i, i + CHUNK));
  if (d.deletes.length) await table.bulkDelete(d.deletes.map((id) => [playlistId, id] as [string, string]));
  return d.upserts.length + d.deletes.length;
}

async function save(playlistId: string, snap: CatalogSnapshot) {
  post({ type: 'progress', playlistId, step: 'saving' });
  await db.transaction('rw', db.categories, async () => {
    await db.categories.where('playlistId').equals(playlistId).delete();
    await db.categories.bulkPut(snap.categories);
  });
  let changed = 0;
  changed += await writeRows(catalogTable('live') as Table<CatalogItem, [string, string]>, playlistId, snap.live);
  changed += await writeRows(catalogTable('movie') as Table<CatalogItem, [string, string]>, playlistId, snap.movies);
  changed += await writeRows(catalogTable('series') as Table<CatalogItem, [string, string]>, playlistId, snap.series);
  if (snap.seriesDetails?.length) {
    await db.seriesDetail.where('playlistId').equals(playlistId).delete();
    await db.seriesDetail.bulkPut(snap.seriesDetails);
  }
  const now = Date.now();
  await db.syncMeta.bulkPut([
    { playlistId, kind: 'movie', lastFullSync: now, itemCount: snap.movies.length },
    { playlistId, kind: 'series', lastFullSync: now, itemCount: snap.series.length },
    { playlistId, kind: 'live', lastFullSync: now, itemCount: snap.live.length },
  ]);
  if (changed) await db.searchIndex.clear();
  return changed;
}

async function m3uSnapshot(playlistId: string, url: string, net: NetConfig): Promise<CatalogSnapshot> {
  post({ type: 'progress', playlistId, step: 'm3u' });
  const creds = credsFromM3UUrl(url) ?? undefined;
  const res = await fetchWithTimeout(url, net, 180_000);
  const parser = new M3UParser();
  const builder = new M3UCatalogBuilder(playlistId, creds);
  if (res.body) {
    const reader = res.body.pipeThrough(textDecoderStream()).getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      builder.add(parser.push(value));
    }
  } else {
    builder.add(parser.push(await res.text()));
  }
  builder.add(parser.end());
  return builder.build(parser.header.epgUrl);
}

self.onmessage = async (ev: MessageEvent<SyncRequest>) => {
  const { playlistId, secret, net } = ev.data;
  const t0 = performance.now();
  try {
    let snap: CatalogSnapshot;
    if (secret.type === 'xtream') {
      const client = new XtreamClient(secret, (u) => fetchJson(u, net, 180_000));
      snap = await client.snapshot(playlistId, (step) => post({ type: 'progress', playlistId, step }));
    } else {
      snap = await m3uSnapshot(playlistId, secret.url, net);
      if (snap.epgUrl && !secret.epgUrl) await saveSecret(playlistId, { ...secret, epgUrl: snap.epgUrl });
    }
    const changed = await save(playlistId, snap);
    post({
      type: 'done', playlistId, changed, ms: Math.round(performance.now() - t0),
      counts: { movie: snap.movies.length, series: snap.series.length, live: snap.live.length },
    });
  } catch (e) {
    const code = e instanceof XtreamError ? e.code : e instanceof HttpError ? (e.status === 0 ? 'network' : 'format') : 'network';
    post({ type: 'error', playlistId, code, message: (e as Error)?.message ?? String(e) });
  }
};
