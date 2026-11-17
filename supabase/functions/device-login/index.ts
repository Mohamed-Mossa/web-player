// Sign in on a TV without typing: the TV shows a code + QR, a signed-in phone approves it,
// and the TV receives a one-time magic-link token that it exchanges for its own session.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { cors, json } from '../_shared/http.ts';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randomCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => ALPHABET[b % ALPHABET.length]).join('');
const randomSecret = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const body = await req.json().catch(() => ({}));

  if (body.action === 'start') {
    await admin.from('device_codes').delete().lt('expires_at', new Date().toISOString());
    for (let i = 0; i < 5; i++) {
      const code = randomCode();
      const secret = randomSecret();
      const expires = new Date(Date.now() + 10 * 60_000).toISOString();
      const { error } = await admin.from('device_codes').insert({ code, device_secret: secret, expires_at: expires });
      if (!error) return json({ code, secret, expiresAt: expires });
    }
    return json({ error: 'could not create a code' }, 500);
  }

  if (body.action === 'approve') {
    const user = (await admin.auth.getUser((req.headers.get('Authorization') ?? '').replace('Bearer ', ''))).data.user;
    if (!user?.email) return json({ error: 'not signed in' }, 401);
    const code = String(body.code ?? '').toUpperCase().trim();
    const { data: row } = await admin.from('device_codes').select('*').eq('code', code).maybeSingle();
    if (!row || new Date(row.expires_at) < new Date() || row.user_id) return json({ error: 'invalid or expired code' }, 400);
    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: user.email });
    if (link.error) return json({ error: link.error.message }, 500);
    await admin.from('device_codes').update({ user_id: user.id, token_hash: link.data.properties.hashed_token }).eq('code', code);
    return json({ ok: true });
  }

  if (body.action === 'poll') {
    const { data: row } = await admin.from('device_codes').select('*').eq('code', String(body.code ?? '')).maybeSingle();
    if (!row || row.device_secret !== body.secret) return json({ error: 'unknown code' }, 404);
    if (new Date(row.expires_at) < new Date()) return json({ error: 'expired' }, 410);
    if (!row.token_hash) return json({ pending: true });
    await admin.from('device_codes').delete().eq('code', row.code);
    return json({ token_hash: row.token_hash });
  }

  return json({ error: 'bad request' }, 400);
});
