import type { PlaylistSecret } from '@iptv/core';
import { db } from '../db/db';
import { aesGcm, hasSubtle, pbkdf2, type AesKey } from './cipher';

/**
 * Credentials are encrypted with AES-GCM. The key is a non-extractable CryptoKey kept in
 * IndexedDB, so the raw key bytes can never be read back by scripts. Nothing sensitive
 * goes to localStorage. (On Android the key moves to the Keystore in phase 3.)
 */
async function getKey(): Promise<AesKey> {
  const row = await db.keys.get('main');
  if (row) return row.key;
  // Without WebCrypto (rare TV browsers) the key has to be kept as raw bytes.
  const key: AesKey = hasSubtle()
    ? await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    : crypto.getRandomValues(new Uint8Array(32));
  await db.keys.put({ id: 'main', key });
  return key;
}

export async function saveSecret(playlistId: string, secret: PlaylistSecret): Promise<void> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await aesGcm('encrypt', key, iv, new TextEncoder().encode(JSON.stringify(secret)));
  await db.secrets.put({ playlistId, iv, data });
}

export async function loadSecret(playlistId: string): Promise<PlaylistSecret | null> {
  const row = await db.secrets.get(playlistId);
  if (!row) return null;
  const key = await getKey();
  const plain = await aesGcm('decrypt', key, new Uint8Array(row.iv), row.data);
  return JSON.parse(new TextDecoder().decode(plain)) as PlaylistSecret;
}

// ---------- profile PIN (a parental lock, not a security boundary) ----------
function toHex(buf: ArrayBuffer | Uint8Array) {
  return [...(buf instanceof Uint8Array ? buf : new Uint8Array(buf))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashPin(pin: string, saltHex?: string): Promise<{ hash: string; salt: string }> {
  const salt = saltHex
    ? new Uint8Array(saltHex.match(/../g)!.map((h) => parseInt(h, 16)))
    : crypto.getRandomValues(new Uint8Array(16));
  const bits = await pbkdf2(pin, salt, 120_000);
  return { hash: toHex(bits), salt: toHex(salt) };
}

export async function verifyPin(pin: string, hash: string, salt: string): Promise<boolean> {
  return (await hashPin(pin, salt)).hash === hash;
}
