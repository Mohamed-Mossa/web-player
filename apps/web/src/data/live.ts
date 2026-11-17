import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { nowNext, type EpgProgramme, type LiveItem } from '@iptv/core';
import { db, type ChannelGroup, type EpgRow } from '../db/db';
import { useCatalog } from './catalog';
import { useEpgSync } from '../sync/epgSync';

export type ChannelRef = { playlistId: string; id: string };
export const chKey = (c: ChannelRef) => `${c.playlistId}:${c.id}`;

export function useAllChannels() {
  const { data } = useCatalog('live');
  return useMemo(() => ((data ?? []) as unknown as LiveItem[]).slice().sort((a, b) => a.num - b.num), [data]);
}

/** Re-render every minute so now/next and progress bars stay current. */
export function useMinuteTick() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(iv);
  }, []);
  return now;
}

/** Now/next for a set of channels (typically the visible rows). */
/** Stable signature so a new array with the same channels does not restart the query. */
function useEpgKeys(channels: LiveItem[]) {
  const sig = channels.map((c) => (c.epgChannelId ? `${c.playlistId}\u0001${c.epgChannelId}` : '')).filter(Boolean).join('\u0002');
  return useMemo(() => (sig ? sig.split('\u0002').map((k) => k.split('\u0001') as [string, string]) : []), [sig]);
}

export function useNowNext(channels: LiveItem[], now: number) {
  const keys = useEpgKeys(channels);
  const version = useEpgSync((s) => s.version);
  return useLiveQuery(async () => {
    const out = new Map<string, { now?: EpgProgramme; next?: EpgProgramme }>();
    if (!keys.length) return out;
    const rows = await db.epg.where('[playlistId+channelId]').anyOf(keys).filter((r) => r.stop > now - 60_000 && r.start < now + 12 * 3600_000).toArray();
    const by = new Map<string, EpgRow[]>();
    for (const r of rows) {
      const k = `${r.playlistId}:${r.channelId}`;
      if (!by.has(k)) by.set(k, []);
      by.get(k)!.push(r);
    }
    for (const [k, list] of by) out.set(k, nowNext(list.sort((a, b) => a.start - b.start), now));
    return out;
  }, [keys, Math.floor(now / 60_000), version]);
}

export const epgKey = (c: LiveItem) => `${c.playlistId}:${c.epgChannelId}`;

export function useProgrammes(channels: LiveItem[], from: number, to: number) {
  const keys = useEpgKeys(channels);
  const version = useEpgSync((s) => s.version);
  return useLiveQuery(async () => {
    const out = new Map<string, EpgRow[]>();
    if (!keys.length) return out;
    const rows = await db.epg.where('[playlistId+channelId]').anyOf(keys).filter((r) => r.stop > from && r.start < to).toArray();
    for (const r of rows) {
      const k = `${r.playlistId}:${r.channelId}`;
      if (!out.has(k)) out.set(k, []);
      out.get(k)!.push(r);
    }
    for (const l of out.values()) l.sort((a, b) => a.start - b.start);
    return out;
  }, [keys, from, to, version]);
}

// ---------- favorite channel groups ----------
export function useChannelGroups(profileId: string | null) {
  return useLiveQuery(async () => (profileId ? (await db.channelGroups.where('profileId').equals(profileId).toArray()).sort((a, b) => a.order - b.order) : []), [profileId]);
}

export async function createGroup(profileId: string, name: string): Promise<ChannelGroup> {
  const order = await db.channelGroups.where('profileId').equals(profileId).count();
  const g: ChannelGroup = { id: crypto.randomUUID(), profileId, name, order, channels: [] };
  await db.channelGroups.put(g);
  return g;
}

export async function toggleInGroup(groupId: string, ch: ChannelRef) {
  const g = await db.channelGroups.get(groupId);
  if (!g) return;
  const has = g.channels.some((c) => chKey(c) === chKey(ch));
  g.channels = has ? g.channels.filter((c) => chKey(c) !== chKey(ch)) : [...g.channels, { playlistId: ch.playlistId, id: ch.id }];
  await db.channelGroups.put(g);
}

export async function deleteGroup(id: string) {
  await db.channelGroups.delete(id);
}

// ---------- zapping context ----------
interface LiveCtx {
  list: ChannelRef[]; // channels in the group the user opened the player from
  last: ChannelRef | null;
  setList: (l: ChannelRef[]) => void;
  setLast: (c: ChannelRef | null) => void;
}
export const useLiveCtx = create<LiveCtx>()((set) => ({
  list: [],
  last: null,
  setList: (list) => set({ list }),
  setLast: (last) => set({ last }),
}));

// ---------- reminders ----------
export async function toggleReminder(r: { profileId: string; playlistId: string; channelId: string; channelName: string; title: string; start: number; stop: number }) {
  const id = `${r.profileId}:${r.playlistId}:${r.channelId}:${r.start}`;
  if (await db.reminders.get(id)) return db.reminders.delete(id);
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  await db.reminders.put({ id, ...r });
}

export function useReminderIds(profileId: string | null) {
  return useLiveQuery(async () => new Set(profileId ? (await db.reminders.where('profileId').equals(profileId).primaryKeys()) : []), [profileId]);
}
