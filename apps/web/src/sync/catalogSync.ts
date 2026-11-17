import { create } from 'zustand';
import { XtreamClient, XtreamError, type PlaylistSecret } from '@iptv/core';
import { db } from '../db/db';
import { loadSecret } from '../lib/crypto';
import { fetchJson, type NetConfig } from '../lib/http';
import { queryClient } from '../lib/query';
import { useApp } from '../state/app';
import { PROXY_BASE } from '../env';
import { isNative, isTizen } from '../lib/platform';
import { useAuth } from '../state/auth';
import type { SyncMessage, SyncRequest } from '../workers/catalogSync.worker';
import { createCatalogWorker } from 'virtual-worker-factory';

export interface SyncState {
  running: boolean;
  step?: string;
  error?: { code: string; message: string };
}

export const useSync = create<{ byId: Record<string, SyncState> }>()(() => ({ byId: {} }));
const setState = (id: string, s: SyncState) => useSync.setState((st) => ({ byId: { ...st.byId, [id]: s } }));

/**
 * Provider requests: Android uses native HTTP (no proxy); the web build goes through the Worker.
 * The Samsung package calls providers directly unless a proxy was typed in Settings.
 */
export const netConfig = (): NetConfig => {
  if (isNative()) return {};
  const base = isTizen() ? useApp.getState().proxyBase : useApp.getState().proxyBase || PROXY_BASE;
  return base ? { proxyBase: base, proxyToken: useAuth.getState().proxyToken ?? undefined } : {};
};

let worker: Worker | null = null;
const waiters = new Map<string, { resolve: () => void; reject: (e: Error) => void }>();

function getWorker() {
  if (worker) return worker;
  worker = createCatalogWorker();
  worker.onmessage = async (ev: MessageEvent<SyncMessage>) => {
    const m = ev.data;
    if (m.type === 'progress') setState(m.playlistId, { running: true, step: m.step });
    if (m.type === 'done') {
      await db.playlists.update(m.playlistId, { lastSyncAt: Date.now(), syncError: undefined, counts: m.counts });
      setState(m.playlistId, { running: false });
      queryClient.invalidateQueries({ queryKey: ['catalog'] });
      queryClient.invalidateQueries({ queryKey: ['search'] });
      waiters.get(m.playlistId)?.resolve();
      waiters.delete(m.playlistId);
      import('./epgSync').then((x) => x.syncEpg(m.playlistId)).catch(() => {});
    }
    if (m.type === 'error') {
      await db.playlists.update(m.playlistId, { syncError: m.code });
      setState(m.playlistId, { running: false, error: { code: m.code, message: m.message } });
      waiters.get(m.playlistId)?.reject(new XtreamError(m.code as XtreamError['code'], m.message));
      waiters.delete(m.playlistId);
    }
  };
  return worker;
}

export async function syncPlaylist(playlistId: string): Promise<void> {
  if (useSync.getState().byId[playlistId]?.running) return;
  const secret = await loadSecret(playlistId);
  if (!secret) throw new Error('Missing credentials');
  setState(playlistId, { running: true, step: 'categories' });
  return new Promise<void>((resolve, reject) => {
    waiters.set(playlistId, { resolve, reject });
    const req: SyncRequest = { type: 'sync', playlistId, secret, net: netConfig() };
    getWorker().postMessage(req);
  });
}

export async function checkAccount(playlistId: string, secret?: PlaylistSecret | null) {
  const s = secret ?? (await loadSecret(playlistId));
  if (!s || s.type !== 'xtream') return;
  const t0 = performance.now();
  try {
    const account = await new XtreamClient(s, (u) => fetchJson(u, netConfig(), 20_000)).authenticate();
    await db.playlists.update(playlistId, { account, accountCheckedAt: Date.now(), pingMs: Math.round(performance.now() - t0) });
  } catch (e) {
    if (e instanceof XtreamError && e.code !== 'network') {
      await db.playlists.update(playlistId, { syncError: e.code, accountCheckedAt: Date.now() });
    }
  }
}

/** On start: refresh account info (hourly) and catalogs older than the configured interval. */
export async function backgroundRefresh() {
  const hours = useApp.getState().refreshHours;
  const lists = await db.playlists.orderBy('order').toArray();
  for (const p of lists) {
    if (!p.accountCheckedAt || Date.now() - p.accountCheckedAt > 3600_000) checkAccount(p.id).catch(() => {});
  }
  for (const p of lists) {
    if (!p.lastSyncAt || Date.now() - p.lastSyncAt > hours * 3600_000) {
      await syncPlaylist(p.id).catch(() => {});
    }
  }
  const { refreshStaleEpg } = await import('./epgSync');
  await refreshStaleEpg();
}
