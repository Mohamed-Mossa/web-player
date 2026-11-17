/**
 * AES-GCM and PBKDF2 with WebCrypto, falling back to @noble (audited, pure JS) where
 * crypto.subtle is missing (some TV browsers). Outputs are identical either way.
 */
export type AesKey = CryptoKey | Uint8Array;

const subtle = (): SubtleCrypto | undefined => (typeof crypto !== 'undefined' ? crypto.subtle : undefined);
export const hasSubtle = () => !!subtle();

export async function aesGcm(mode: 'encrypt' | 'decrypt', key: AesKey, iv: Uint8Array, data: Uint8Array | ArrayBuffer): Promise<ArrayBuffer> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (key instanceof Uint8Array) {
    const { gcm } = await import('@noble/ciphers/aes.js');
    const c = gcm(key, iv);
    const out = mode === 'encrypt' ? c.encrypt(bytes) : c.decrypt(bytes);
    return out.slice().buffer as ArrayBuffer;
  }
  const s = subtle()!;
  return mode === 'encrypt'
    ? s.encrypt({ name: 'AES-GCM', iv: iv as Uint8Array<ArrayBuffer> }, key, bytes as Uint8Array<ArrayBuffer>)
    : s.decrypt({ name: 'AES-GCM', iv: iv as Uint8Array<ArrayBuffer> }, key, bytes as Uint8Array<ArrayBuffer>);
}

/** A 256-bit AES key from raw bytes: a non-extractable CryptoKey when WebCrypto exists. */
export async function importAesKey(raw: Uint8Array): Promise<AesKey> {
  const s = subtle();
  if (!s) return raw;
  return s.importKey('raw', raw as Uint8Array<ArrayBuffer>, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function pbkdf2(pass: string, salt: Uint8Array, iterations: number, bytes = 32): Promise<Uint8Array> {
  const s = subtle();
  const pw = new TextEncoder().encode(pass);
  if (s) {
    const base = await s.importKey('raw', pw, 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await s.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as Uint8Array<ArrayBuffer>, iterations }, base, bytes * 8));
  }
  const [{ pbkdf2Async }, { sha256 }] = await Promise.all([import('@noble/hashes/pbkdf2.js'), import('@noble/hashes/sha2.js')]);
  return pbkdf2Async(sha256, pw, salt, { c: iterations, dkLen: bytes });
}

export function toBase64(b: ArrayBuffer | Uint8Array): string {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(u.subarray(i, i + 0x8000)));
  return btoa(s);
}
