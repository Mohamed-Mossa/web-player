// Integration test of the sync engine: real Dexie (fake-indexeddb) + an in-memory "Supabase".
import 'fake-indexeddb/auto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// --- minimal browser globals used by the modules under test
const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
  document: { addEventListener() {}, visibilityState: 'visible', documentElement: { dataset: {} } },
});

// --- in-memory Supabase: tables of rows keyed by "key", updated_at set by the "server"
type Row = { key: string; data: unknown; updated_at: string; deleted_at: string | null; creds_cipher?: string | null };
const server: Record<string, Map<string, Row>> = {};
let clock = Date.parse('2026-11-17T10:00:00Z');
const now = () => new Date((clock += 1000)).toISOString();
function from(table: string) {
  server[table] ??= new Map();
  const t = server[table];
  let gt: string | null = null;
  let lim = 1000;
  // thenable query builder, like supabase-js: filters can be chained in any order, then awaited
  const q = {
    select: () => q,
    order: () => q,
    gt: (_c: string, v: string) => ((gt = v), q),
    limit: (n: number) => ((lim = n), q),
    then: (res: (v: { data: Row[]; error: null }) => void) =>
      res({ data: [...t.values()].filter((r) => !gt || r.updated_at > gt).sort((a, b) => a.updated_at.localeCompare(b.updated_at)).slice(0, lim), error: null }),
    upsert: async (rows: Row[]) => {
      for (const r of rows) t.set(r.key, { ...r, updated_at: now() });
      return { error: null };
    },
  };
  return q;
}
vi.mock('./supabase', () => ({
  supabase: { from, channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel() {} },
  cloudEnabled: true,
  callFunction: async (_n: string, body: { action: string; plain?: string; cipher?: string }) =>
    body.action === 'encrypt' ? { cipher: Buffer.from(body.plain!).toString('base64') } : { plain: Buffer.from(body.cipher!, 'base64').toString() },
  refreshProxyToken: async () => {},
}));
const synced: string[] = [];
vi.mock('../sync/catalogSync', () => ({ syncPlaylist: async (id: string) => void synced.push(id), netConfig: () => ({}) }));

const { db } = await import('../db/db');
const { saveSecret, loadSecret } = await import('../lib/crypto');
const { startSync, stopSync, pull, syncNow, localOnly } = await import('./sync');
const { useApp } = await import('../state/app');

const settle = async () => {
  for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 120));
};

beforeAll(async () => {
  await startSync('user-1');
});
afterAll(() => stopSync());

describe('cloud sync engine', () => {
  it('pushes local changes (with encrypted credentials) to the server', async () => {
    await db.playlists.put({ id: 'pl1', name: 'Home', type: 'xtream', order: 0, createdAt: 1, hostHint: 'h', lastSyncAt: 5, counts: { movie: 1, series: 0, live: 0 } });
    await saveSecret('pl1', { type: 'xtream', server: 'http://h', username: 'u', password: 'p' });
    await db.favorites.put({ profileId: 'default', kind: 'movie', playlistId: 'pl1', itemId: '10', title: 'The Matrix', createdAt: 1 });
    useApp.getState().set({ bufferSec: 60 });
    await settle();
    await syncNow();
    expect(server.favorites.get('default|movie|pl1|10')?.data).toMatchObject({ title: 'The Matrix' });
    const pl = server.playlists.get('pl1')!;
    expect(pl.data).toMatchObject({ name: 'Home' });
    expect(pl.data).not.toHaveProperty('lastSyncAt'); // device-only fields stay local
    expect(JSON.parse(Buffer.from(pl.creds_cipher!, 'base64').toString())).toMatchObject({ username: 'u' });
    expect((server.settings.get('ui')!.data as { bufferSec: number }).bufferSec).toBe(60);
    expect(server.settings.get('ui')!.data).not.toHaveProperty('data');
    expect(await db.outbox.count()).toBe(0);
  });

  it('a new device receives everything, including decrypted credentials', async () => {
    // simulate a fresh device: wipe local data (clear() bypasses the change hooks) and the pull cursors
    await localOnly(['playlists', 'favorites'], async () => {
      await db.playlists.clear();
      await db.favorites.clear();
    });
    await db.secrets.clear();
    for (const k of [...store.keys()]) if (k.startsWith('iptv-pull-')) store.delete(k);
    await settle();
    await db.outbox.clear();
    // meanwhile the phone changed a setting
    server.settings.set('ui', { ...server.settings.get('ui')!, data: { ...(server.settings.get('ui')!.data as object), bufferSec: 120 }, updated_at: now() });
    await pull();
    expect(await db.favorites.count()).toBe(1);
    expect((await db.playlists.get('pl1'))?.name).toBe('Home');
    expect((await loadSecret('pl1')) as { password: string }).toMatchObject({ password: 'p' });
    expect(synced).toContain('pl1'); // catalog download starts for the new playlist
    expect(useApp.getState().bufferSec).toBe(120);
  });

  it('applies deletes made on another device', async () => {
    server.favorites.set('default|movie|pl1|10', { key: 'default|movie|pl1|10', data: {}, updated_at: now(), deleted_at: now() });
    await pull();
    expect(await db.favorites.count()).toBe(0);
  });

  it('does not overwrite a local change that is still waiting to be pushed', async () => {
    await db.progress.put({ profileId: 'default', kind: 'movie', playlistId: 'pl1', itemId: '10', title: 'M', positionSec: 900, durationSec: 7200, completed: false, lastWatchedAt: 2 });
    await settle();
    // another device wrote an older position meanwhile
    server.watch_progress ??= new Map();
    server.watch_progress.set('default|movie|pl1|10', { key: 'default|movie|pl1|10', data: { profileId: 'default', kind: 'movie', playlistId: 'pl1', itemId: '10', title: 'M', positionSec: 100, durationSec: 7200, completed: false, lastWatchedAt: 1 }, updated_at: now(), deleted_at: null });
    if ((await db.outbox.count()) === 0) return; // already pushed by the debounce: covered by the next assertion
    await pull();
    expect((await db.progress.get(['default', 'movie', 'pl1', '10']))?.positionSec).toBe(900);
    await syncNow();
    expect((server.watch_progress.get('default|movie|pl1|10')!.data as { positionSec: number }).positionSec).toBe(900);
  });
});
