import { db } from '../db/db';
import { loadSecret } from '../lib/crypto';
import { useApp } from '../state/app';
import type { EpgMessage, EpgRequest } from '../workers/epg.worker';
import { netConfig, useSync } from './catalogSync';
import { create } from 'zustand';

/** `version` bumps after every import: writes happen in a worker, so screens re-query on this. */
export const useEpgSync = create<{ running: Record<string, boolean>; version: number }>()(() => ({ running: {}, version: 0 }));
const EPG_TTL = 12 * 3600_000;

let worker: Worker | null = null;
const waiters = new Map<string, () => void>();
function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/epg.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = async (ev: MessageEvent<EpgMessage>) => {
    const m = ev.data;
    if (m.type === 'done') await db.playlists.update(m.playlistId, { epgUpdatedAt: Date.now(), epgError: undefined, epgCount: m.count });
    else await db.playlists.update(m.playlistId, { epgError: m.message, epgUpdatedAt: Date.now() });
    useEpgSync.setState((s) => ({ running: { ...s.running, [m.playlistId]: false }, version: s.version + 1 }));
    waiters.get(m.playlistId)?.();
    waiters.delete(m.playlistId);
    waiters.get(`${m.playlistId}#tick`)?.();
    waiters.delete(`${m.playlistId}#tick`);
    if (pending.delete(m.playlistId)) void syncEpg(m.playlistId);
  };
  return worker;
}

export async function epgUrlFor(playlistId: string): Promise<string | null> {
  const s = await loadSecret(playlistId);
  if (!s) return null;
  if (s.type === 'xtream') return `${s.server}/xmltv.php?username=${encodeURIComponent(s.username)}&password=${encodeURIComponent(s.password)}`;
  return s.epgUrl ?? null;
}

const pending = new Set<string>();

export async function syncEpg(playlistId: string): Promise<void> {
  // The guide is filtered to the playlist's channels: never import while the catalog is being written.
  if (useSync.getState().byId[playlistId]?.running) return;
  if (useEpgSync.getState().running[playlistId]) {
    pending.add(playlistId);
    return;
  }
  const url = await epgUrlFor(playlistId);
  if (!url) return;
  const channels = await db.live.where('playlistId').equals(playlistId).toArray();
  const channelIds = [...new Set(channels.map((c) => c.epgChannelId).filter((x): x is string => !!x))];
  if (!channelIds.length) return;
  const archiveDays = Math.min(7, Math.max(1, ...channels.map((c) => c.archiveDays)));
  useEpgSync.setState((s) => ({ running: { ...s.running, [playlistId]: true } }));
  // also refresh screens periodically while a long import is running
  const tick = setInterval(() => useEpgSync.setState((s) => ({ version: s.version + 1 })), 4000);
  waiters.set(`${playlistId}#tick`, () => clearInterval(tick));
  const lang = useApp.getState().lang;
  const req: EpgRequest = { playlistId, url, net: netConfig(), channelIds, archiveDays, langs: [lang, lang === 'ar' ? 'en' : 'ar'] };
  return new Promise((resolve) => {
    waiters.set(playlistId, resolve);
    getWorker().postMessage(req);
  });
}

export async function refreshStaleEpg() {
  for (const p of await db.playlists.toArray()) {
    if (!p.lastSyncAt) continue;
    if (!p.epgUpdatedAt || Date.now() - p.epgUpdatedAt > EPG_TTL) await syncEpg(p.id).catch(() => {});
  }
}
