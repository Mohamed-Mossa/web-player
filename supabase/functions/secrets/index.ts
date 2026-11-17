// Encrypts/decrypts playlist credentials for the signed-in user with a server-side key.
// Postgres only ever stores ciphertext; the key lives in this function's secrets (SECRETS_KEY).
// The user id is bound as additional data, so a ciphertext cannot be decrypted under another account.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { cors, json } from '../_shared/http.ts';

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function key() {
  const raw = unb64(Deno.env.get('SECRETS_KEY') ?? '');
  if (raw.length !== 32) throw new Error('SECRETS_KEY must be 32 random bytes, base64');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: 'not signed in' }, 401);
  const body = await req.json().catch(() => ({}));
  const aad = new TextEncoder().encode(user.id);
  try {
    if (body.action === 'encrypt' && typeof body.plain === 'string') {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, await key(), new TextEncoder().encode(body.plain)));
      const out = new Uint8Array(iv.length + ct.length);
      out.set(iv);
      out.set(ct, iv.length);
      return json({ cipher: b64(out) });
    }
    if (body.action === 'decrypt' && typeof body.cipher === 'string') {
      const all = unb64(body.cipher);
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12), additionalData: aad }, await key(), all.slice(12));
      return json({ plain: new TextDecoder().decode(plain) });
    }
    return json({ error: 'bad request' }, 400);
  } catch (e) {
    return json({ error: String(e) }, 400);
  }
});
