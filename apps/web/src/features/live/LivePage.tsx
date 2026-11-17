import { useVirtualizer } from '@tanstack/react-virtual';
import clsx from 'clsx';
import { Bell, BellRing, CalendarDays, Grid2x2, Heart, List, Plus, RotateCcw, Trash2, Tv } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { LiveItem } from '@iptv/core';
import { catKey, useCategories, usePlaylists } from '../../data/catalog';
import { useFavorites } from '../../data/items';
import {
  chKey, createGroup, deleteGroup, epgKey, toggleReminder, useAllChannels, useChannelGroups, useLiveCtx, useMinuteTick, useNowNext, useProgrammes, useReminderIds,
} from '../../data/live';
import type { EpgRow } from '../../db/db';
import { useLayout } from '../../lib/platform';
import { Focusable, FocusSection, TextField, setFocus } from '../../nav/focus';
import { useApp } from '../../state/app';
import { useEpgSync } from '../../sync/epgSync';
import { Button, Chip, Empty, Img, Modal, Spinner } from '../../components/ui';
import { NoPlaylists } from '../home/HomePage';
import { scrollToStart } from '../../lib/rtlScroll';

const hm = (t: number, lang: string) => new Date(t).toLocaleTimeString(lang === 'ar' ? 'ar-EG' : 'en-GB', { hour: '2-digit', minute: '2-digit' });

export function LivePage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const layout = useLayout();
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'guide' ? 'guide' : 'list';
  const profileId = useApp((s) => s.profileId);
  const sel = useApp((s) => s.views.live.categoryId);
  const setView = useApp((s) => s.setView);
  const playlists = usePlaylists();
  const all = useAllChannels();
  const cats = useCategories('live', profileId);
  const groups = useChannelGroups(profileId);
  const favs = useFavorites(profileId, 'live');
  const setList = useLiveCtx((s) => s.setList);
  const epgRunning = useEpgSync((s) => Object.values(s.running).some(Boolean));
  const [newGroup, setNewGroup] = useState(false);
  const [groupName, setGroupName] = useState('');

  const channels = useMemo(() => {
    const byKey = new Map(all.map((c) => [chKey(c), c]));
    if (sel === 'fav') return (favs ?? []).map((f) => byKey.get(`${f.playlistId}:${f.itemId}`)).filter((x): x is LiveItem => !!x);
    if (sel?.startsWith('group:')) {
      const g = groups?.find((x) => x.id === sel.slice(6));
      return (g?.channels ?? []).map((c) => byKey.get(chKey(c))).filter((x): x is LiveItem => !!x);
    }
    const hidden = new Set((cats ?? []).filter((c) => c.hidden).map((c) => c.key));
    return all.filter((c) => !hidden.has(catKey(c.playlistId, c.categoryId)) && (!sel || catKey(c.playlistId, c.categoryId) === sel));
  }, [all, sel, favs, groups, cats]);

  const focusedOnce = useRef(false);
  useEffect(() => {
    if (focusedOnce.current || layout === 'mobile' || !channels.length) return;
    focusedOnce.current = true;
    requestAnimationFrame(() => setFocus('live-main'));
  }, [channels.length, layout]);

  if (playlists && playlists.length === 0) return <NoPlaylists />;

  const open = (c: LiveItem) => {
    setList(channels.map((x) => ({ playlistId: x.playlistId, id: x.id })));
    nav(`/live/${c.playlistId}/${c.id}`);
  };
  const selectedGroup = sel?.startsWith('group:') ? groups?.find((g) => g.id === sel.slice(6)) : null;
  const mobile = layout === 'mobile';

  const sidebar = (
    <FocusSection focusKey="live-groups" className="scroll-thin min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
      <GroupBtn active={sel === 'fav'} onClick={() => setView('live', { categoryId: 'fav' })} icon={<Heart className="size-4" />} label={t('live.favorites')} testId="group-fav" />
      {groups?.map((g) => (
        <GroupBtn key={g.id} active={sel === `group:${g.id}`} onClick={() => setView('live', { categoryId: `group:${g.id}` })} icon={<List className="size-4" />} label={`${g.name} (${g.channels.length})`} testId="group-custom" />
      ))}
      <GroupBtn active={false} onClick={() => setNewGroup(true)} icon={<Plus className="size-4" />} label={t('live.newGroup')} testId="new-group" />
      <div className="my-2 border-t border-line/60" />
      <GroupBtn active={!sel} onClick={() => setView('live', { categoryId: null })} label={t('catalog.allCategories')} />
      {cats?.filter((c) => !c.hidden).map((c) => (
        <GroupBtn key={c.key} active={sel === c.key} onClick={() => setView('live', { categoryId: c.key })} label={c.label} testId="category" />
      ))}
    </FocusSection>
  );

  return (
    <div className="flex h-full min-h-0">
      {!mobile && <aside className="flex w-64 shrink-0 flex-col border-e border-line/60 bg-surface/40 pt-5 xl:w-72">{sidebar}</aside>}
      <div className="flex min-w-0 flex-1 flex-col">
        <FocusSection focusKey="live-toolbar" className="flex flex-wrap items-center gap-2 border-b border-line/60 px-3 py-3 md:px-6 md:py-4">
          <h1 className="me-2 text-xl font-bold tracking-tight md:text-2xl">{t('nav.live')}</h1>
          <span className="text-sm text-muted" data-testid="channel-count">{t('catalog.channels', { count: channels.length })}</span>
          {epgRunning && <span className="inline-flex items-center gap-1.5 text-xs text-muted"><Spinner className="size-3.5" />{t('live.epgUpdating')}</span>}
          <div className="ms-auto flex gap-1.5">
            <Chip testId="view-list" active={view === 'list'} onClick={() => setParams({}, { replace: true })}><List className="me-1 inline size-4" />{t('live.channels')}</Chip>
            <Chip testId="view-guide" active={view === 'guide'} onClick={() => setParams({ view: 'guide' }, { replace: true })}><CalendarDays className="me-1 inline size-4" />{t('live.guide')}</Chip>
            {layout === 'desktop' && <Button variant="ghost" testId="open-multiview" icon={<Grid2x2 className="size-4" />} onClick={() => nav('/multiview')}>{t('live.multiview')}</Button>}
            {selectedGroup && <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={async () => { await deleteGroup(selectedGroup.id); setView('live', { categoryId: null }); }} title={t('live.deleteGroup')} />}
          </div>
          {mobile && (
            <div className="no-scrollbar -mx-3 flex w-full gap-1.5 overflow-x-auto px-3">
              <Chip active={sel === 'fav'} onClick={() => setView('live', { categoryId: 'fav' })}>♥ {t('live.favorites')}</Chip>
              <Chip active={!sel} onClick={() => setView('live', { categoryId: null })}>{t('catalog.allCategories')}</Chip>
              {cats?.filter((c) => !c.hidden).map((c) => <Chip key={c.key} active={sel === c.key} onClick={() => setView('live', { categoryId: c.key })}>{c.label}</Chip>)}
            </div>
          )}
        </FocusSection>
        <div className="min-h-0 flex-1">
          {!channels.length ? (
            <Empty title={sel === 'fav' || selectedGroup ? t('live.emptyGroup') : t('catalog.empty')} icon={<Tv className="size-10" />} />
          ) : view === 'guide' ? (
            <EpgGuide channels={channels} onPlay={open} />
          ) : (
            <ChannelList channels={channels} onOpen={open} />
          )}
        </div>
      </div>
      <Modal open={newGroup} onClose={() => setNewGroup(false)} title={t('live.newGroup')}>
        <TextField value={groupName} onChange={setGroupName} autoFocus testId="group-name" placeholder={t('live.groupName')} onSubmit={async () => {
          if (!profileId || !groupName.trim()) return;
          const g = await createGroup(profileId, groupName.trim());
          setGroupName('');
          setNewGroup(false);
          setView('live', { categoryId: `group:${g.id}` });
        }} />
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => setNewGroup(false)}>{t('common.cancel')}</Button>
          <Button variant="primary" testId="group-save" onClick={async () => {
            if (!profileId || !groupName.trim()) return;
            const g = await createGroup(profileId, groupName.trim());
            setGroupName('');
            setNewGroup(false);
            setView('live', { categoryId: `group:${g.id}` });
          }}>{t('common.save')}</Button>
        </div>
      </Modal>
    </div>
  );
}

function GroupBtn({ active, onClick, label, icon, testId }: { active: boolean; onClick: () => void; label: string; icon?: React.ReactNode; testId?: string }) {
  return (
    <Focusable onSelect={onClick} testId={testId} ariaPressed={active} className={clsx('flex w-full items-center gap-2 truncate rounded-lg px-3 py-2 text-start text-sm', active ? 'bg-accent/15 font-semibold text-accent-2' : 'text-text/85 hover:bg-surface-2')}>
      {icon}
      <span className="truncate">{label}</span>
    </Focusable>
  );
}

const ROW = 72;

function ChannelList({ channels, onOpen }: { channels: LiveItem[]; onOpen: (c: LiveItem) => void }) {
  const { i18n } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const now = useMinuteTick();
  const v = useVirtualizer({ count: channels.length, getScrollElement: () => ref.current, estimateSize: () => ROW, overscan: 4 });
  const visible = v.getVirtualItems().map((r) => channels[r.index]).filter(Boolean);
  const nn = useNowNext(visible, now);
  return (
    <div ref={ref} className="scroll-thin h-full overflow-y-auto" data-testid="channel-list">
      <FocusSection focusKey="live-main" className="relative w-full px-2 md:px-4" >
        <div style={{ height: v.getTotalSize(), position: 'relative' }}>
          {v.getVirtualItems().map((r) => {
            const c = channels[r.index];
            const e = c.epgChannelId ? nn?.get(epgKey(c)) : undefined;
            const pct = e?.now ? ((now - e.now.start) / (e.now.stop - e.now.start)) * 100 : 0;
            return (
              <div key={chKey(c)} className="absolute inset-x-0 py-1" style={{ top: r.start, height: ROW }}>
                <Focusable onSelect={() => onOpen(c)} onFocused={() => v.scrollToIndex(r.index, { align: 'auto' })} testId="channel-row" ariaLabel={c.title} className="flex h-full w-full items-center gap-3 rounded-xl px-3 text-start hover:bg-surface-2">
                  <span className="w-10 shrink-0 text-end text-sm text-muted tabular-nums">{c.num}</span>
                  <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-2 p-1">
                    <Img src={c.logo} alt="" className="max-h-full max-w-full object-contain" fallback={<Tv className="size-5 text-muted" />} />
                  </span>
                  <span className="w-44 shrink-0 truncate font-medium md:w-56">{c.title}</span>
                  <span className="hidden min-w-0 flex-1 md:block">
                    {e?.now ? (
                      <>
                        <span className="flex items-center gap-2 text-sm">
                          <span className="truncate" data-testid="now-title">{e.now.title}</span>
                          <span className="shrink-0 text-xs text-muted tabular-nums">{hm(e.now.start, i18n.language)}–{hm(e.now.stop, i18n.language)}</span>
                        </span>
                        <span className="mt-1 block h-1 overflow-hidden rounded-full bg-line"><span className="block h-full bg-accent" style={{ width: `${pct}%` }} /></span>
                        {e.next && <span className="mt-1 block truncate text-xs text-muted">{e.next.title}</span>}
                      </>
                    ) : null}
                  </span>
                  {c.archiveDays > 0 && <RotateCcw className="size-4 shrink-0 text-accent-2" />}
                </Focusable>
              </div>
            );
          })}
        </div>
      </FocusSection>
    </div>
  );
}

// ---------- EPG grid ----------
const PX_PER_MIN = 4;
const GRID_ROW = 64;
const NAME_W = 200;

export function EpgGuide({ channels, onPlay }: { channels: LiveItem[]; onPlay: (c: LiveItem) => void }) {
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  const profileId = useApp((s) => s.profileId);
  const reminders = useReminderIds(profileId);
  const now = useMinuteTick();
  const ref = useRef<HTMLDivElement>(null);
  // window: 3 h back (catch-up) to 12 h ahead, aligned to the half hour
  const from = useMemo(() => Math.floor(now / 1_800_000) * 1_800_000 - 3 * 3600_000, [Math.floor(now / 1_800_000)]); // eslint-disable-line react-hooks/exhaustive-deps
  const to = from + 15 * 3600_000;
  const x = (ms: number) => ((ms - from) / 60_000) * PX_PER_MIN;
  const width = x(to);
  const v = useVirtualizer({ count: channels.length, getScrollElement: () => ref.current, estimateSize: () => GRID_ROW, overscan: 3, paddingStart: 36 });
  const visible = v.getVirtualItems().map((r) => channels[r.index]).filter(Boolean);
  const progs = useProgrammes(visible, from, to);
  const slots = Array.from({ length: 30 }, (_, i) => from + i * 1_800_000);

  useEffect(() => {
    if (ref.current) scrollToStart(ref.current, Math.abs(x(now) - 240));
  }, [from]); // eslint-disable-line react-hooks/exhaustive-deps

  const select = (c: LiveItem, p: EpgRow) => {
    if (p.start <= now && p.stop > now) return onPlay(c);
    if (p.stop <= now) {
      if (c.archiveDays > 0 && p.start >= now - c.archiveDays * 86400_000) {
        nav(`/live/${c.playlistId}/${c.id}?catchup=${p.start}&stop=${p.stop}&title=${encodeURIComponent(p.title)}`);
      }
      return;
    }
    if (profileId) void toggleReminder({ profileId, playlistId: c.playlistId, channelId: c.id, channelName: c.title, title: p.title, start: p.start, stop: p.stop });
  };

  return (
    <div ref={ref} className="scroll-thin relative h-full overflow-auto" data-testid="epg-guide">
      <FocusSection focusKey="live-main" className="relative" >
        <div style={{ width: NAME_W + width, height: v.getTotalSize(), position: 'relative' }}>
          {/* time header */}
          <div className="sticky top-0 z-20 flex h-9 bg-bg/95 backdrop-blur" style={{ width: NAME_W + width }}>
            <div className="sticky start-0 z-10 shrink-0 bg-bg" style={{ width: NAME_W }} />
            <div className="relative" style={{ width }}>
              {slots.map((s) => (
                <span key={s} className="absolute top-2 text-xs text-muted tabular-nums" style={{ insetInlineStart: x(s) + 4 }}>{hm(s, i18n.language)}</span>
              ))}
            </div>
          </div>
          {/* now line */}
          <div className="pointer-events-none absolute top-0 bottom-0 z-10 w-0.5 bg-bad/80" style={{ insetInlineStart: NAME_W + x(now) }} />
          {v.getVirtualItems().map((r) => {
            const c = channels[r.index];
            const list = c.epgChannelId ? progs?.get(epgKey(c)) ?? [] : [];
            return (
              <div key={chKey(c)} className="absolute flex" style={{ top: r.start, height: GRID_ROW, width: NAME_W + width }}>
                <div className="sticky start-0 z-10 flex shrink-0 items-center gap-2 border-e border-line/60 bg-bg px-3" style={{ width: NAME_W }}>
                  <span className="w-8 text-xs text-muted tabular-nums">{c.num}</span>
                  <span className="truncate text-sm font-medium">{c.title}</span>
                </div>
                <div className="relative" style={{ width }}>
                  {list.length === 0 && (
                    <Focusable onSelect={() => onPlay(c)} testId="epg-empty" className="absolute inset-y-1 rounded-lg bg-surface px-3 text-start text-sm text-muted" >
                      <span style={{ width: x(now + 3600_000) - x(now - 1800_000) }} className="block truncate">{t('live.noEpg')}</span>
                    </Focusable>
                  )}
                  {list.map((p) => {
                    const s = Math.max(p.start, from);
                    const e = Math.min(p.stop, to);
                    const live = p.start <= now && p.stop > now;
                    const past = p.stop <= now;
                    const catchup = past && c.archiveDays > 0 && p.start >= now - c.archiveDays * 86400_000;
                    const remind = reminders?.has(`${profileId}:${c.playlistId}:${c.id}:${p.start}`);
                    return (
                      <div key={p.start} className="absolute inset-y-1 px-0.5" style={{ insetInlineStart: x(s), width: Math.max(4, x(e) - x(s)) }}>
                        <Focusable
                          onSelect={() => select(c, p)}
                          testId={live ? 'epg-now' : past ? (catchup ? 'epg-catchup' : 'epg-past') : 'epg-future'}
                          ariaLabel={p.title}
                          className={clsx('flex size-full flex-col justify-center overflow-hidden rounded-lg px-2.5 text-start', live ? 'bg-accent/25' : past ? 'bg-surface/60 text-muted' : 'bg-surface')}
                        >
                          <span className="flex items-center gap-1 truncate text-sm font-medium">
                            {catchup && <RotateCcw className="size-3 shrink-0 text-accent-2" />}
                            {remind && <BellRing className="size-3 shrink-0 text-warn" data-testid="reminder-on" />}
                            <span className="truncate">{p.title}</span>
                          </span>
                          <span className="truncate text-xs text-muted tabular-nums">{hm(p.start, i18n.language)}{!past && !live && !remind && <Bell className="ms-1 inline size-3 opacity-50" />}</span>
                        </Focusable>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </FocusSection>
    </div>
  );
}
