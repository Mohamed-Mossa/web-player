import { create } from 'zustand';
import type { Table, Transaction } from 'dexie';
import { compactOutbox, joinKey, planPull, splitKey, stableJson, type PlaylistSecret, type RemoteRow } from '@iptv/core';
import { db, type OutboxRow } from '../db/db';
import { loadSecret, saveSecret } from '../lib/crypto';
import { queryClient } from '../lib/query';
import { useApp } from '../state/app';
import { syncPlaylist } from '../sync/catalogSync';
import { callFunction, supabase } from './supabase';

/** Local Dexie table ↔ remote Postgres table. `parts` = number of segments in the compound key. */
const TABLES: { local: string; remote: string; parts: number }[] = [
  { local: 'profiles', remote: 'profiles', parts: 1 },
  { local: 'playlists', remote: 'playlists', parts: 1 },
  { local: 'categoryPrefs', remote: 'category_prefs', parts: 4 },
  { local: 'favorites', remote: 'favorites', parts: 4 },
  { local: 'progress', remote: 'watch_progress', parts: 4 },
  { local: 'channelGroups', remote: 'channel_groups', parts: 1 },
  { local: 'reminders', remote: 'reminders', parts: 1 },
  { local: 'kv', remote: 'settings', parts: 1 },
];

// Device-only fields that never leave the device
const PLAYLIST_LOCAL = ['account', 'accountCheckedAt', 'pingMs', 'lastSyncAt', 'syncError', 'counts', 'epgUpdatedAt', 'epgError', 'epgCount'];
// UI settings that sync (layout and proxy are per device)
const SYNCED_SETTINGS = ['lang', 'refreshHours', 'views', 'bufferSec', 'autoplayNext', 'subtitle', 'prefAudio', 'prefSubs', 'afr'] as const;

export const useCloudSync = create<{ status: 'off' | 'idle' | 'syncing' | 'error'; lastSync: number | null; error?: string }>()(() => ({
  status: 'off',
  lastSync: null,
}));

const table = (name: string) => (db as unknown as Record<string, Table>)[name];
const REMOTE_TX = '__remoteApply';

// ---------- 1) capture local changes into the outbox ----------
let pending: OutboxRow[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
function enqueue(entry: OutboxRow) {
  pending.push(entry);
  if (!flushTimer)
    flushTimer = setTimeout(async () => {
      flushTimer = null;
      const batch = pending;
      pending = [];
      await db.outbox.bulkAdd(batch);
      schedulePush();
    }, 0);
}

let hooked = false;
function installHooks() {
  if (hooked) return;
  hooked = true;
  for (const t of TABLES) {
    const tbl = table(t.local);
    const isRemote = (tx: Transaction) => !!(tx as unknown as Record<string, unknown>)[REMOTE_TX];
    tbl.hook('creating', function (primKey, _obj, tx) {
      if (isRemote(tx)) return;
      this.onsuccess = (key: unknown) => enqueue({ table: t.local, key: joinKey((key ?? primKey) as string | string[]), op: 'put', at: Date.now() });
    });
    tbl.hook('updating', function (_mods, primKey, _obj, tx) {
      if (isRemote(tx)) return;
      this.onsuccess = () => enqueue({ table: t.local, key: joinKey(primKey as string | string[]), op: 'put', at: Date.now() });
    });
    tbl.hook('deleting', function (primKey, _obj, tx) {
      if (isRemote(tx)) return;
      this.onsuccess = () => enqueue({ table: t.local, key: joinKey(primKey as string | string[]), op: 'del', at: Date.now() });
    });
  }
  // UI settings → kv row (only when they really changed, so a pulled value does not bounce back)
  let last = '';
  useApp.subscribe((s) => {
    const data = Object.fromEntries(SYNCED_SETTINGS.map((k) => [k, s[k]]));
    const j = stableJson(data);
    if (j === last) return;
    last = j;
    void db.kv.put({ key: 'ui', data });
  });
  appliedSettings = (j) => (last = j);
}
let appliedSettings: (json: string) => void = () => {};

// ---------- 2) push ----------
let pushTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePush() {
  if (!supabase || useCloudSync.getState().status === 'off') return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void push().catch(onError), 1500);
}

async function toRemote(localTable: string, key: string, parts: number): Promise<Record<string, unknown> | null> {
  const k = splitKey(key, parts);
  const row = (await table(localTable).get(k as never)) as Record<string, unknown> | undefined;
  if (!row) return null;
  if (localTable === 'playlists') {
    const data = Object.fromEntries(Object.entries(row).filter(([f]) => !PLAYLIST_LOCAL.includes(f)));
    const secret = await loadSecret(row.id as string);
    const { cipher } = secret ? await callFunction<{ cipher: string }>('secrets', { action: 'encrypt', plain: JSON.stringify(secret) }) : { cipher: null };
    return { key, data, creds_cipher: cipher, deleted_at: null };
  }
  if (localTable === 'kv') return { key, data: row.data, deleted_at: null };
  return { key, data: row, deleted_at: null };
}

async function push() {
  if (!supabase) return;
  const entries = await db.outbox.toArray();
  if (!entries.length) return;
  useCloudSync.setState({ status: 'syncing' });
  const latest = compactOutbox(entries.map((e) => ({ ...e, seq: e.seq! })));
  for (const t of TABLES) {
    const mine = latest.filter((e) => e.table === t.local);
    if (!mine.length) continue;
    const rows: Record<string, unknown>[] = [];
    for (const e of mine) {
      const r = e.op === 'put' ? await toRemote(t.local, e.key, t.parts) : null;
      rows.push(r ?? { key: e.key, data: {}, deleted_at: new Date().toISOString() });
    }
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from(t.remote).upsert(rows.slice(i, i + 500), { onConflict: 'user_id,key' });
      if (error) throw error;
    }
  }
  await db.outbox.bulkDelete(entries.map((e) => e.seq!));
  useCloudSync.setState({ status: 'idle', lastSync: Date.now() });
}

// ---------- 3) pull ----------
const cursorKey = (t: string) => `iptv-pull-${t}`;
let pulling: Promise<void> | null = null;
export function pull(): Promise<void> {
  pulling ??= doPull().finally(() => (pulling = null));
  return pulling;
}

async function doPull() {
  if (!supabase) return;
  useCloudSync.setState({ status: 'syncing' });
  const outbox = await db.outbox.toArray();
  let changed = false;
  for (const t of TABLES) {
    const pendingKeys = new Set(outbox.filter((o) => o.table === t.local).map((o) => o.key));
    let cursor = localStorage.getItem(cursorKey(t.remote));
    for (;;) {
      let q = supabase.from(t.remote).select('key,data,updated_at,deleted_at' + (t.remote === 'playlists' ? ',creds_cipher' : '')).order('updated_at').limit(1000);
      if (cursor) q = q.gt('updated_at', cursor);
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as unknown as (RemoteRow<Record<string, unknown>> & { creds_cipher?: string | null })[];
      if (!rows.length) break;
      const plan = planPull(rows, pendingKeys, cursor);
      await applyRemote(t.local, t.parts, plan.upserts as typeof rows, plan.deletes);
      changed ||= plan.upserts.length + plan.deletes.length > 0;
      cursor = plan.cursor;
      if (cursor) localStorage.setItem(cursorKey(t.remote), cursor);
      if (rows.length < 1000) break;
    }
  }
  if (changed) queryClient.invalidateQueries();
  useCloudSync.setState({ status: 'idle', lastSync: Date.now() });
}

async function applyRemote(localTable: string, parts: number, upserts: (RemoteRow<Record<string, unknown>> & { creds_cipher?: string | null })[], deletes: string[]) {
  const tbl = table(localTable);
  const newPlaylists: string[] = [];
  // Decrypt credentials outside the Dexie transaction (network call)
  const secrets = new Map<string, PlaylistSecret>();
  if (localTable === 'playlists') {
    for (const u of upserts) {
      if (u.creds_cipher && !(await db.secrets.get(u.key))) {
        const { plain } = await callFunction<{ plain: string }>('secrets', { action: 'decrypt', cipher: u.creds_cipher });
        secrets.set(u.key, JSON.parse(plain) as PlaylistSecret);
        newPlaylists.push(u.key);
      }
    }
  }
  await db.transaction('rw', tbl, async (tx) => {
    (tx as unknown as Record<string, unknown>)[REMOTE_TX] = true;
    for (const k of deletes) await tbl.delete(splitKey(k, parts) as never);
    for (const u of upserts) {
      if (localTable === 'playlists') {
        const cur = (await tbl.get(u.key)) as Record<string, unknown> | undefined;
        const keep = cur ? Object.fromEntries(PLAYLIST_LOCAL.map((f) => [f, cur[f]])) : {};
        await tbl.put({ ...u.data, ...keep });
      } else if (localTable === 'kv') {
        await tbl.put({ key: u.key, data: u.data });
      } else {
        await tbl.put(u.data);
      }
    }
  });
  for (const [id, s] of secrets) await saveSecret(id, s);
  for (const id of newPlaylists) syncPlaylist(id).catch(() => {});
  if (localTable === 'kv') {
    const ui = upserts.find((u) => u.key === 'ui')?.data as Record<string, unknown> | undefined;
    if (ui) {
      appliedSettings(stableJson(ui));
      useApp.setState(ui as never);
    }
  }
}

function onError(e: unknown) {
  useCloudSync.setState({ status: 'error', error: (e as Error)?.message ?? String(e) });
}

// ---------- 4) lifecycle ----------
let timer: ReturnType<typeof setInterval> | null = null;
let channel: ReturnType<NonNullable<typeof supabase>['channel']> | null = null;

/** Starts syncing for a signed-in user: first pull, then push; then Realtime + every minute. */
export async function startSync(userId: string) {
  if (!supabase) return;
  installHooks();
  useCloudSync.setState({ status: 'idle' });
  // first time on this device for this account: push everything we already have
  const seededFor = localStorage.getItem('iptv-sync-seeded');
  if (seededFor !== userId) {
    // Settings are not seeded: a new device takes the account's settings instead of overwriting them.
    for (const t of TABLES.filter((x) => x.local !== 'kv')) {
      const keys = (await table(t.local).toCollection().primaryKeys()) as (string | string[])[];
      await db.outbox.bulkAdd(keys.map((k) => ({ table: t.local, key: joinKey(k), op: 'put' as const, at: Date.now() })));
    }
    for (const t of TABLES) localStorage.removeItem(cursorKey(t.remote));
    localStorage.setItem('iptv-sync-seeded', userId);
  }
  await pull().catch(onError);
  await push().catch(onError);
  timer = setInterval(() => void pull().then(push).catch(onError), 60_000);
  let debounce: ReturnType<typeof setTimeout> | null = null;
  channel = supabase.channel(`sync-${userId}`);
  for (const t of TABLES) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table: t.remote, filter: `user_id=eq.${userId}` }, () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void pull().catch(onError), 800);
    });
  }
  channel.subscribe();
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void pull().catch(onError));
}

export function stopSync() {
  if (timer) clearInterval(timer);
  timer = null;
  if (channel) void supabase?.removeChannel(channel);
  channel = null;
  useCloudSync.setState({ status: 'off' });
}

export const syncNow = () => pull().then(push).catch(onError);

/** Change local data without syncing it (e.g. "remove all data from this device" after sign-out). */
export function localOnly<T>(tables: string[], fn: () => Promise<T>): Promise<T> {
  return db.transaction('rw', tables.map(table), async (tx) => {
    (tx as unknown as Record<string, unknown>)[REMOTE_TX] = true;
    return fn();
  });
}
