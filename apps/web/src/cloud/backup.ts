import type { PlaylistSecret } from '@iptv/core';
import { db } from '../db/db';
import { loadSecret, saveSecret } from '../lib/crypto';
import { aesGcm, importAesKey, pbkdf2, toBase64 } from '../lib/cipher';
import { queryClient } from '../lib/query';
import { syncPlaylist } from '../sync/catalogSync';
import { useApp } from '../state/app';

/**
 * Full backup: playlists (with credentials), profiles, favorites, category settings, progress, channel
 * groups, reminders and UI settings — encrypted with a passphrase (PBKDF2 + AES-GCM) because it holds logins.
 */
interface BackupFile {
  format: 'iptv-backup';
  version: 1;
  createdAt: string;
  salt: string;
  iv: string;
  data: string;
}

const b64 = toBase64;
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;

// Same result as WebCrypto deriveKey(PBKDF2 → AES-256), so old backups still open.
async function keyFrom(pass: string, salt: Uint8Array) {
  return importAesKey(await pbkdf2(pass, salt, 250_000));
}

const TABLES = ['profiles', 'favorites', 'categoryPrefs', 'progress', 'channelGroups', 'reminders'] as const;

export async function exportBackup(passphrase: string): Promise<Blob> {
  const playlists = await db.playlists.toArray();
  const secrets: Record<string, PlaylistSecret | null> = {};
  for (const p of playlists) secrets[p.id] = await loadSecret(p.id);
  const tables: Record<string, unknown[]> = {};
  for (const t of TABLES) tables[t] = await (db as unknown as Record<string, { toArray(): Promise<unknown[]> }>)[t].toArray();
  const s = useApp.getState();
  const settings = { lang: s.lang, refreshHours: s.refreshHours, views: s.views, bufferSec: s.bufferSec, autoplayNext: s.autoplayNext, subtitle: s.subtitle, prefAudio: s.prefAudio, prefSubs: s.prefSubs, afr: s.afr };
  const plain = JSON.stringify({ playlists: playlists.map(({ account, accountCheckedAt, pingMs, lastSyncAt, syncError, counts, epgUpdatedAt, epgError, epgCount, ...p }) => p), secrets, tables, settings });
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await aesGcm('encrypt', await keyFrom(passphrase, salt), iv, new TextEncoder().encode(plain));
  const file: BackupFile = { format: 'iptv-backup', version: 1, createdAt: new Date().toISOString(), salt: b64(salt), iv: b64(iv), data: b64(data) };
  return new Blob([JSON.stringify(file)], { type: 'application/json' });
}

export class BadPassphrase extends Error {}

export async function importBackup(text: string, passphrase: string): Promise<{ playlists: number }> {
  const file = JSON.parse(text) as BackupFile;
  if (file.format !== 'iptv-backup') throw new Error('Not a backup file');
  let plain: ArrayBuffer;
  try {
    plain = await aesGcm('decrypt', await keyFrom(passphrase, unb64(file.salt)), unb64(file.iv), unb64(file.data));
  } catch {
    throw new BadPassphrase('Wrong passphrase');
  }
  const b = JSON.parse(new TextDecoder().decode(plain)) as {
    playlists: { id: string }[];
    secrets: Record<string, PlaylistSecret | null>;
    tables: Record<string, unknown[]>;
    settings: Record<string, unknown>;
  };
  await db.playlists.bulkPut(b.playlists as never[]);
  for (const [id, s] of Object.entries(b.secrets)) if (s) await saveSecret(id, s);
  for (const t of TABLES) if (b.tables[t]?.length) await (db as unknown as Record<string, { bulkPut(r: unknown[]): Promise<unknown> }>)[t].bulkPut(b.tables[t]);
  useApp.setState(b.settings as never);
  queryClient.invalidateQueries();
  for (const p of b.playlists) syncPlaylist(p.id).catch(() => {});
  return { playlists: b.playlists.length };
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
