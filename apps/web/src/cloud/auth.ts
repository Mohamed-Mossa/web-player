import type { RealtimeChannel } from '@supabase/supabase-js';
import { create } from 'zustand';
import { useAuth } from '../state/auth';
import { detectLayout } from '../lib/platform';
import { callFunction, refreshProxyToken, supabase } from './supabase';
import { startSync, stopSync } from './sync';

export interface Device {
  id: string;
  name: string;
  kind: 'tv' | 'phone' | 'tablet' | 'desktop';
  last_seen: string;
}

export const useDevices = create<{ list: Device[]; selfId: string | null }>()(() => ({ list: [], selfId: null }));

export type RemoteCommand = { type: 'play'; path: string; title?: string } | { type: 'search'; q: string } | { type: 'key'; key: string };
let onCommand: (c: RemoteCommand) => void = () => {};
export const setCommandHandler = (fn: (c: RemoteCommand) => void) => (onCommand = fn);

function deviceKind(): Device['kind'] {
  const l = detectLayout();
  if (l === 'tv') return 'tv';
  if (l === 'mobile') return /iPad|Tablet/i.test(navigator.userAgent) ? 'tablet' : 'phone';
  return 'desktop';
}
function deviceName(kind: Device['kind']) {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Linux';
  return `${kind === 'tv' ? 'TV' : kind === 'phone' ? 'Phone' : kind === 'tablet' ? 'Tablet' : 'Computer'} · ${os}`;
}

let cmdChannel: RealtimeChannel | null = null;

async function registerDevice(userId: string) {
  if (!supabase) return;
  const kind = deviceKind();
  let id = localStorage.getItem(`iptv-device-${userId}`);
  if (id) {
    const { data } = await supabase.from('devices').update({ last_seen: new Date().toISOString(), kind }).eq('id', id).select('id');
    if (!data?.length) id = null;
  }
  if (!id) {
    const { data } = await supabase.from('devices').insert({ name: deviceName(kind), kind }).select('id').single();
    id = (data as { id: string } | null)?.id ?? null;
    if (id) localStorage.setItem(`iptv-device-${userId}`, id);
  }
  useDevices.setState({ selfId: id });
  await loadDevices();
  if (!id) return;
  cmdChannel = supabase
    .channel(`cmd-${id}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'remote_commands', filter: `target_device=eq.${id}` }, async (p) => {
      const row = p.new as { id: number; command: RemoteCommand };
      onCommand(row.command);
      await supabase!.from('remote_commands').delete().eq('id', row.id);
    })
    .subscribe();
}

export async function loadDevices() {
  if (!supabase) return;
  const { data } = await supabase.from('devices').select('*').order('last_seen', { ascending: false });
  useDevices.setState({ list: (data ?? []) as Device[] });
}

export async function sendCommand(target: string, command: RemoteCommand) {
  if (!supabase) return;
  const { error } = await supabase.from('remote_commands').insert({ target_device: target, command });
  if (error) throw error;
}

export async function renameDevice(id: string, name: string) {
  await supabase?.from('devices').update({ name }).eq('id', id);
  await loadDevices();
}

export async function removeDevice(id: string) {
  await supabase?.from('devices').delete().eq('id', id);
  await loadDevices();
}

let started = false;
/** Watches the Supabase session: sign-in starts sync, device registration and the proxy token. */
export function initAuth() {
  if (!supabase || started) return;
  started = true;
  const onSession = async (session: { user: { id: string; email?: string } } | null) => {
    const prev = useAuth.getState().userId;
    useAuth.setState({ userId: session?.user.id ?? null, email: session?.user.email ?? null });
    if (session && session.user.id !== prev) {
      await refreshProxyToken();
      await registerDevice(session.user.id);
      await startSync(session.user.id);
    }
    if (!session && prev) {
      stopSync();
      if (cmdChannel) void supabase!.removeChannel(cmdChannel);
      useAuth.setState({ proxyToken: null, proxyTokenExp: 0 });
    }
  };
  supabase.auth.getSession().then(({ data }) => onSession(data.session));
  supabase.auth.onAuthStateChange((_e, session) => void onSession(session));
}

export async function signIn(email: string, password: string) {
  const { error } = await supabase!.auth.signInWithPassword({ email, password });
  if (error) throw error;
}
export async function signUp(email: string, password: string) {
  const { data, error } = await supabase!.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + '/account' } });
  if (error) throw error;
  return !data.session; // true = confirmation email sent
}
export async function sendMagicLink(email: string) {
  const { error } = await supabase!.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + '/account' } });
  if (error) throw error;
}
export async function signOut() {
  const uid = useAuth.getState().userId;
  const id = uid && localStorage.getItem(`iptv-device-${uid}`);
  if (id) await supabase?.from('devices').delete().eq('id', id);
  await supabase?.auth.signOut();
}

// ---------- TV sign-in by code ----------
export async function startDeviceLogin() {
  return callFunction<{ code: string; secret: string; expiresAt: string }>('device-login', { action: 'start' }, false);
}
/** Polls until a phone approves the code, then exchanges the one-time token for a session on this device. */
export async function waitForDeviceLogin(code: string, secret: string, signal: AbortSignal) {
  while (!signal.aborted) {
    await new Promise((r) => setTimeout(r, 2500));
    const r = await callFunction<{ pending?: boolean; token_hash?: string; error?: string }>('device-login', { action: 'poll', code, secret }, false).catch(() => ({ pending: true }) as { pending?: boolean; token_hash?: string });
    if (r.token_hash) {
      const { error } = await supabase!.auth.verifyOtp({ token_hash: r.token_hash, type: 'magiclink' });
      if (error) throw error;
      return true;
    }
  }
  return false;
}
export async function approveDeviceLogin(code: string) {
  await callFunction('device-login', { action: 'approve', code });
}
