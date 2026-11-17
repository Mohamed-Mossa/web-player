import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { API_BASE, SUPABASE_ANON_KEY, SUPABASE_URL } from '../env';
import { useAuth } from '../state/auth';

export const cloudEnabled = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

export const supabase: SupabaseClient | null = cloudEnabled
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;

let tokenTimer: ReturnType<typeof setTimeout> | null = null;

/** Asks the Worker for a short-lived proxy token (only allowed accounts get one) and refreshes it before it expires. */
export async function refreshProxyToken() {
  if (!supabase || !API_BASE) return;
  const { data } = await supabase.auth.getSession();
  const jwt = data.session?.access_token;
  if (!jwt) return useAuth.setState({ proxyToken: null, proxyTokenExp: 0 });
  try {
    const r = await fetch(`${API_BASE}/token`, { method: 'POST', headers: { Authorization: `Bearer ${jwt}` } });
    if (!r.ok) {
      useAuth.setState({ proxyToken: null, proxyTokenExp: 0, proxyDenied: r.status === 403 });
      return;
    }
    const { token, expiresIn } = (await r.json()) as { token: string; expiresIn: number };
    useAuth.setState({ proxyToken: token, proxyTokenExp: Date.now() + expiresIn * 1000, proxyDenied: false });
    if (tokenTimer) clearTimeout(tokenTimer);
    tokenTimer = setTimeout(refreshProxyToken, Math.max(60_000, (expiresIn - 600) * 1000));
  } catch {
    tokenTimer = setTimeout(refreshProxyToken, 60_000);
  }
}

export async function callFunction<T>(name: string, body: Record<string, unknown>, auth = true): Promise<T> {
  if (!supabase) throw new Error('Cloud sync is not configured');
  const { data, error } = await supabase.functions.invoke(name, { body, headers: auth ? undefined : { Authorization: `Bearer ${SUPABASE_ANON_KEY}` } });
  if (error) throw error;
  return data as T;
}
