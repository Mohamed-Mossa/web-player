import { pause as pauseNav, resume as resumeNav } from '@noriginmedia/norigin-spatial-navigation';
import clsx from 'clsx';
import { ArrowLeft, CalendarDays, FolderPlus, Heart, History, Languages, ListVideo, Moon, Pause, PictureInPicture2, Play, Radio, Tv } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { XtreamClient, type LiveItem } from '@iptv/core';
import { chKey, epgKey, toggleInGroup, useAllChannels, useChannelGroups, useLiveCtx, useMinuteTick, useNowNext } from '../../data/live';
import { toggleFavorite, useIsFavorite } from '../../data/items';
import { db } from '../../db/db';
import { loadSecret } from '../../lib/crypto';
import { viaProxy } from '../../lib/http';
import { isNative, directNet } from '../../lib/platform';
import { Focusable, FocusSection } from '../../nav/focus';
import { useApp } from '../../state/app';
import { netConfig } from '../../sync/catalogSync';
import { Img, Spinner } from '../../components/ui';
import { resolveStream } from '../../player/resolve';
import { usePlayer, fmtTime } from '../../player/usePlayer';
import { CtrlButton, ErrorOverlay, SeekBar, SidePanel, SleepPanel, SubtitleOverlay, TracksPanel, type ExternalSubs, type SleepChoice } from '../../player/ui/parts';
import { useGoBack } from '../../lib/nav';

const OSD_MS = 5000;
const DIGIT_MS = 1500;
const hm = (t: number, lang: string) => new Date(t).toLocaleTimeString(lang === 'ar' ? 'ar-EG' : 'en-GB', { hour: '2-digit', minute: '2-digit' });

type Overlay = 'list' | 'tracks' | 'sleep' | 'groups' | null;

export function LivePlayerScreen() {
  const { playlistId = '', id = '' } = useParams();
  const [params] = useSearchParams();
  const catchupStart = Number(params.get('catchup') || 0);
  const catchupStop = Number(params.get('stop') || 0);
  const catchupTitle = params.get('title') ?? '';
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  const container = useRef<HTMLDivElement>(null);
  const { player, state, stateRef } = usePlayer(container);
  const all = useAllChannels();
  const { list, last, setLast } = useLiveCtx();
  const profileId = useApp((s) => s.profileId);
  const bufferSec = useApp((s) => s.bufferSec);
  const groups = useChannelGroups(profileId);
  const now = useMinuteTick();
  const [ch, setCh] = useState<LiveItem | null>(null);
  const [osd, setOsd] = useState(true);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [digits, setDigits] = useState('');
  const [external, setExternal] = useState<ExternalSubs | null>(null);
  const [sleep, setSleep] = useState<{ choice: SleepChoice; until: number | null }>({ choice: null, until: null });
  const osdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const digitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fav = useIsFavorite(profileId, 'live', playlistId, id);
  const catchup = catchupStart > 0;

  // zapping order: the list the user came from, else every channel by number
  const order = useMemo(() => (list.length ? list : all.map((c) => ({ playlistId: c.playlistId, id: c.id }))), [list, all]);
  const nn = useNowNext(ch ? [ch] : [], now);
  const epg = ch?.epgChannelId ? nn?.get(epgKey(ch)) : undefined;

  const showOsd = useCallback(() => {
    setOsd(true);
    resumeNav();
    if (osdTimer.current) clearTimeout(osdTimer.current);
    osdTimer.current = setTimeout(() => stateRef.current.status === 'playing' && setOsd(false), OSD_MS);
  }, [stateRef]);

  // load channel + start
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const c = await db.live.get([playlistId, id]);
      if (!c || cancelled || !player) return;
      setCh(c);
      setExternal(null);
      player.setBuffer(bufferSec);
      if (catchup) {
        const secret = await loadSecret(playlistId);
        const pl = await db.playlists.get(playlistId);
        if (secret?.type !== 'xtream') return;
        const url = new XtreamClient(secret, async () => ({})).catchupUrl(c.id, catchupStart, Math.ceil((catchupStop - catchupStart) / 60_000), pl?.account?.serverTimezone);
        await player.load({ url: directNet() ? url : viaProxy(url, netConfig()), live: false, kindHint: 'file', title: c.title });
      } else {
        const src = await resolveStream('live', playlistId, c);
        if (!cancelled) await player.load({ ...src, title: c.title, poster: c.logo });
      }
      showOsd();
    })();
    return () => {
      cancelled = true;
    };
  }, [playlistId, id, player, catchup, catchupStart, catchupStop, bufferSec, showOsd]);

  const zapTo = useCallback(
    (target: { playlistId: string; id: string }) => {
      if (chKey(target) === `${playlistId}:${id}` && !catchup) return;
      setLast({ playlistId, id });
      nav(`/live/${target.playlistId}/${target.id}`, { replace: true });
    },
    [playlistId, id, nav, setLast, catchup],
  );
  const zap = useCallback(
    (dir: 1 | -1) => {
      if (!order.length) return;
      const i = order.findIndex((c) => c.playlistId === playlistId && c.id === id);
      const next = order[(i + dir + order.length) % order.length];
      zapTo(next);
    },
    [order, playlistId, id, zapTo],
  );
  const commitDigits = useCallback(
    (d: string) => {
      setDigits('');
      const n = Number(d);
      const target = all.find((c) => c.num === n);
      if (target) zapTo(target);
    },
    [all, zapTo],
  );
  const goBack = useGoBack();
  const exit = useCallback(() => goBack('/live'), [goBack]);
  const togglePlay = useCallback(() => (player?.paused ? void player.play() : player?.pause()), [player]);

  // remote keys (when no panel is open)
  useEffect(() => {
    if (!overlay && !osd && !state.error) pauseNav();
    else resumeNav();
  }, [overlay, osd, state.error]);
  useEffect(() => () => resumeNav(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (overlay || state.error) return;
      const k = e.key;
      const back = ['Escape', 'GoBack', 'BrowserBack', 'Backspace'].includes(k);
      if (/^\d$/.test(k)) {
        e.preventDefault();
        const d = (digits + k).slice(0, 4);
        setDigits(d);
        if (digitTimer.current) clearTimeout(digitTimer.current);
        digitTimer.current = setTimeout(() => commitDigits(d), DIGIT_MS);
        return;
      }
      if (k === 'ChannelUp' || k === 'PageUp') return e.preventDefault(), zap(-1);
      if (k === 'ChannelDown' || k === 'PageDown') return e.preventDefault(), zap(1);
      if (k === 'l' || k === 'L' || k === 'Recall') return last && zapTo(last);
      if (k === 'MediaPlayPause' || k === ' ') return e.preventDefault(), togglePlay();
      if (!osd) {
        e.preventDefault();
        e.stopPropagation();
        if (back) return exit();
        if (k === 'ArrowUp') return zap(-1);
        if (k === 'ArrowDown') return zap(1);
        if (k === 'Enter' || k === 'ArrowLeft') return setOverlay('list');
        if (catchup && k === 'ArrowRight') return player?.seek(player.currentTime + 30), showOsd();
        return showOsd();
      }
      if (back) {
        e.preventDefault();
        setOsd(false);
        return;
      }
      showOsd();
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, [overlay, state.error, osd, digits, commitDigits, zap, zapTo, last, togglePlay, exit, showOsd, catchup, player]);

  // sleep timer
  useEffect(() => {
    if (sleep.until === null) return;
    const iv = setInterval(() => {
      if (Date.now() >= sleep.until!) {
        player?.pause();
        setSleep({ choice: null, until: null });
        showOsd();
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [sleep, player, showOsd]);

  const lines = external ? [] : state.cues;
  const busy = !state.error && (state.status === 'loading' || state.status === 'buffering' || state.status === 'idle');
  const progress = epg?.now ? ((now - epg.now.start) / (epg.now.stop - epg.now.start)) * 100 : 0;

  return (
    <div ref={container} className="fixed inset-0 z-50 select-none bg-black text-white [html.native-video_&]:bg-transparent" data-testid="live-player" onMouseMove={showOsd}>
      <SubtitleOverlay lines={lines} controlsVisible={osd} />
      {busy && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3">
          <Spinner className="size-12 border-4" />
          {state.retry && <p className="rounded-lg bg-black/60 px-3 py-1 text-sm">{t('player.reconnecting', { a: state.retry.attempt, m: state.retry.max })}</p>}
        </div>
      )}
      {digits && (
        <div className="absolute end-8 top-8 z-30 rounded-2xl bg-black/70 px-6 py-3 text-5xl font-bold tabular-nums" data-testid="digits">{digits}</div>
      )}

      {/* channel banner / controls */}
      <div className={clsx('absolute inset-0 z-20 flex flex-col justify-between bg-gradient-to-b from-black/60 via-transparent to-black/85 transition-opacity duration-300', osd ? 'opacity-100' : 'pointer-events-none opacity-0')} data-testid="live-osd" data-visible={osd}>
        <FocusSection focusKey="live-top" className="flex items-center gap-3 p-4 md:p-6">
          <CtrlButton label={t('common.back')} onClick={exit}><ArrowLeft className="size-6 rtl:rotate-180" /></CtrlButton>
          {catchup ? (
            <span className="rounded bg-accent px-2 py-0.5 text-xs font-bold">{t('live.catchup')}</span>
          ) : (
            <span className="flex items-center gap-1 rounded bg-bad px-2 py-0.5 text-xs font-bold"><Radio className="size-3" />{t('player.live')}</span>
          )}
          {sleep.until && <span className="ms-auto flex items-center gap-1 text-sm text-white/70"><Moon className="size-4" />{t('player.sleepIn', { m: Math.max(1, Math.ceil((sleep.until - Date.now()) / 60000)) })}</span>}
        </FocusSection>

        <div className="space-y-4 p-4 md:p-8">
          <div className="flex items-center gap-4">
            <span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/10 p-1.5 md:size-20">
              <Img src={ch?.logo} alt="" className="max-h-full max-w-full object-contain" fallback={<Tv className="size-8 text-white/60" />} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-baseline gap-3">
                <span className="text-3xl font-bold tabular-nums text-white/70" data-testid="live-num">{ch?.num}</span>
                <span className="truncate text-2xl font-bold" data-testid="live-name">{ch?.title}</span>
              </p>
              {catchup ? (
                <p className="mt-1 truncate text-lg">{catchupTitle} <span className="text-sm text-white/60">{hm(catchupStart, i18n.language)}–{hm(catchupStop, i18n.language)}</span></p>
              ) : epg?.now ? (
                <>
                  <p className="mt-1 flex items-center gap-3 text-lg">
                    <span className="truncate" data-testid="live-now">{epg.now.title}</span>
                    <span className="shrink-0 text-sm text-white/60 tabular-nums">{hm(epg.now.start, i18n.language)}–{hm(epg.now.stop, i18n.language)}</span>
                  </p>
                  <div className="mt-2 h-1 max-w-xl overflow-hidden rounded-full bg-white/20"><div className="h-full bg-accent" style={{ width: `${progress}%` }} /></div>
                  {epg.next && <p className="mt-2 truncate text-sm text-white/70">{t('live.next')}: {epg.next.title} · {hm(epg.next.start, i18n.language)}</p>}
                </>
              ) : null}
            </div>
          </div>
          {catchup && <SeekBar current={state.current} duration={state.duration} buffered={state.buffered} onSeek={(x) => player?.seek(x)} onToggle={togglePlay} />}
          <FocusSection focusKey="live-buttons" preferredChildFocusKey="live-list-btn" className="flex flex-wrap items-center gap-1" >
            <CtrlButton label={state.status === 'playing' ? t('player.pause') : t('player.play')} onClick={togglePlay}>
              {state.status === 'playing' ? <Pause className="size-6 fill-current" /> : <Play className="size-6 fill-current" />}
            </CtrlButton>
            <CtrlButton focusKey="live-list-btn" testId="live-list-btn" label={t('live.channelList')} onClick={() => setOverlay('list')}><ListVideo className="size-6" /></CtrlButton>
            <CtrlButton label={t('live.guide')} onClick={() => nav('/live?view=guide')}><CalendarDays className="size-6" /></CtrlButton>
            {last && <CtrlButton testId="live-last" label={t('live.lastChannel')} onClick={() => zapTo(last)}><History className="size-6" /></CtrlButton>}
            {catchup && <CtrlButton label={t('live.goLive')} onClick={() => nav(`/live/${playlistId}/${id}`, { replace: true })}><Radio className="size-6" /></CtrlButton>}
            <div className="flex-1" />
            {profileId && ch && (
              <CtrlButton testId="live-fav" label={fav ? t('details.unfavorite') : t('details.favorite')} active={fav} onClick={() => toggleFavorite({ profileId, kind: 'live', playlistId, itemId: id, title: ch.title, poster: ch.logo })}>
                <Heart className={clsx('size-6', fav && 'fill-current')} />
              </CtrlButton>
            )}
            {profileId && <CtrlButton testId="live-add-group" label={t('live.addToGroup')} onClick={() => setOverlay('groups')}><FolderPlus className="size-6" /></CtrlButton>}
            <CtrlButton label={t('player.tracks')} onClick={() => setOverlay('tracks')}><Languages className="size-6" /></CtrlButton>
            <CtrlButton label={t('player.sleep')} active={sleep.choice !== null} onClick={() => setOverlay('sleep')}><Moon className="size-6" /></CtrlButton>
            {player?.canPip() && <CtrlButton label={t('player.pip')} onClick={() => void player.enterPip().catch(() => {})}><PictureInPicture2 className="size-6" /></CtrlButton>}
          </FocusSection>
        </div>
      </div>

      {overlay === 'list' && (
        <ChannelOverlay current={{ playlistId, id }} order={order} all={all} onPick={(c) => { setOverlay(null); zapTo(c); }} onClose={() => setOverlay(null)} />
      )}
      {overlay === 'groups' && ch && (
        <SidePanel title={t('live.addToGroup')} onClose={() => setOverlay(null)} testId="groups-panel">
          {!groups?.length && <p className="text-sm text-muted">{t('live.noGroups')}</p>}
          {groups?.map((g) => {
            const inG = g.channels.some((c) => chKey(c) === chKey(ch));
            return (
              <Focusable key={g.id} testId="group-toggle" onSelect={() => toggleInGroup(g.id, ch)} ariaPressed={inG} className={clsx('flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm', inG ? 'bg-accent/20' : 'hover:bg-white/10')}>
                <span>{g.name}</span>
                <span>{inG ? '✓' : '+'}</span>
              </Focusable>
            );
          })}
        </SidePanel>
      )}
      {overlay === 'tracks' && (
        <TracksPanel tracks={state.tracks} title={ch?.title ?? ''} onSelect={(k, tid) => player?.selectTrack(k, tid)} external={external} onExternal={setExternal} subsOff={false} offset={0} setOffset={() => {}} onClose={() => setOverlay(null)} />
      )}
      {overlay === 'sleep' && (
        <SleepPanel value={sleep.choice} onPick={(c) => setSleep({ choice: c, until: typeof c === 'number' ? Date.now() + c * 60_000 : null })} onClose={() => setOverlay(null)} />
      )}
      {state.error && <ErrorOverlay error={state.error} onRetry={() => nav(0)} onBack={exit} />}
      {catchup && !osd && state.duration > 0 && <span className="absolute bottom-3 end-4 text-xs text-white/50 tabular-nums">{fmtTime(state.current)}</span>}
    </div>
  );
}

/** Channel list on top of the video: current group, now playing, OK to switch. */
function ChannelOverlay({ current, order, all, onPick, onClose }: { current: { playlistId: string; id: string }; order: { playlistId: string; id: string }[]; all: LiveItem[]; onPick: (c: LiveItem) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const now = useMinuteTick();
  const byKey = useMemo(() => new Map(all.map((c) => [chKey(c), c])), [all]);
  const items = useMemo(() => order.map((o) => byKey.get(chKey(o))).filter((x): x is LiveItem => !!x), [order, byKey]);
  const idx = Math.max(0, items.findIndex((c) => chKey(c) === chKey(current)));
  // show a window around the current channel (lists can be thousands long)
  const start = Math.max(0, idx - 40);
  const slice = items.slice(start, idx + 60);
  const nn = useNowNext(slice, now);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (['Escape', 'GoBack', 'BrowserBack', 'Backspace'].includes(e.key)) {
        e.stopImmediatePropagation();
        e.preventDefault();
        onClose();
      }
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div className="absolute inset-0 z-40 flex bg-black/30" onClick={onClose}>
      <div className="scroll-thin h-full w-full max-w-md overflow-y-auto bg-surface/95 p-3 backdrop-blur" onClick={(e) => e.stopPropagation()} data-testid="channel-overlay">
        <p className="px-2 pt-2 pb-3 text-lg font-semibold">{t('live.channelList')}</p>
        <FocusSection boundary autoFocus preferredChildFocusKey={`ov-${chKey(current)}`}>
          {slice.map((c) => {
            const e = c.epgChannelId ? nn?.get(epgKey(c)) : undefined;
            const active = chKey(c) === chKey(current);
            return (
              <Focusable key={chKey(c)} focusKey={`ov-${chKey(c)}`} onSelect={() => onPick(c)} testId="overlay-channel" ariaLabel={c.title} className={clsx('flex w-full items-center gap-3 rounded-lg px-2 py-2 text-start', active && 'bg-accent/20')}>
                <span className="w-9 text-end text-sm text-muted tabular-nums">{c.num}</span>
                <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded bg-white/10 p-0.5">
                  <Img src={c.logo} alt="" className="max-h-full max-w-full object-contain" fallback={<Tv className="size-4 text-white/50" />} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{c.title}</span>
                  {e?.now && <span className="block truncate text-xs text-muted">{e.now.title}</span>}
                </span>
              </Focusable>
            );
          })}
        </FocusSection>
      </div>
    </div>
  );
}
