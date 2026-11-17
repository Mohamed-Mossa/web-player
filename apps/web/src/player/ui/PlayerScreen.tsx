import { pause as pauseNav, resume as resumeNav } from '@noriginmedia/norigin-spatial-navigation';
import { ArrowLeft, Airplay, Cast, Gauge, Languages, Maximize, Moon, Pause, PictureInPicture2, Play, RotateCcw, RotateCw, SkipForward } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { cuesAt, type Episode, type LiveItem, type SeriesItem, type VodItem } from '@iptv/core';
import { db } from '../../db/db';
import { useSeriesDetail } from '../../data/items';
import { getProgress, saveProgress } from '../../data/progress';
import { isNative, useLayout } from '../../lib/platform';
import { FocusSection, setFocus } from '../../nav/focus';
import { useApp } from '../../state/app';
import { Spinner } from '../../components/ui';
import { canAirPlay, castMedia, initCast, showAirPlay, useCast } from '../cast';
import { nextEpisode, resolveStream, type PlayKind } from '../resolve';
import type { StreamSource } from '../types';
import { fmtTime, usePlayer } from '../usePlayer';
import {
  CtrlButton, ErrorOverlay, NextUpCard, ResumeDialog, SeekBar, SleepPanel, SpeedPanel, SubtitleOverlay, TracksPanel,
  type ExternalSubs, type SleepChoice,
} from './parts';

type Panel = 'tracks' | 'speed' | 'sleep' | null;

interface Loaded {
  title: string;
  subtitle?: string;
  poster?: string;
  item: VodItem | Episode | LiveItem;
  seriesId?: string;
}

const HIDE_AFTER = 4000;
const NEXT_COUNTDOWN = 10;

export function PlayerScreen() {
  const { kind = 'movie', playlistId = '', id: rawId = '' } = useParams() as { kind: PlayKind; playlistId: string; id: string };
  const id = decodeURIComponent(rawId);
  const [params] = useSearchParams();
  const seriesId = params.get('s') ?? undefined;
  const { t } = useTranslation();
  const nav = useNavigate();
  const layout = useLayout();
  const profileId = useApp((s) => s.profileId);
  const { bufferSec, autoplayNext, prefAudio, prefSubs } = useApp();
  const container = useRef<HTMLDivElement>(null);
  const { player, state, stateRef } = usePlayer(container);
  const series = useSeriesDetail(playlistId, seriesId ?? '__none__');
  const cast = useCast();

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [source, setSource] = useState<StreamSource | null>(null);
  const [resumeAt, setResumeAt] = useState<number | null>(null);
  const [started, setStarted] = useState(false);
  const [controls, setControls] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);
  const [rate, setRate] = useState(1);
  const [external, setExternal] = useState<ExternalSubs | null>(null);
  const [subsOff, setSubsOff] = useState(prefSubs === 'off');
  const [offset, setOffset] = useState(0);
  const [sleep, setSleep] = useState<{ choice: SleepChoice; until: number | null }>({ choice: null, until: null });
  const [nextIn, setNextIn] = useState<number | null>(null);
  const [nextCancelled, setNextCancelled] = useState(false);
  const [castActive, setCastActive] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefApplied = useRef(false);

  const live = kind === 'live';
  const next = useMemo(() => (kind === 'episode' ? nextEpisode(series.data, id) : null), [kind, series.data, id]);

  // 1) Load the item and its saved position
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let l: Loaded | null = null;
      if (kind === 'movie') {
        const m = await db.movies.get([playlistId, id]);
        if (m) l = { title: m.title, poster: m.poster, item: m };
      } else if (kind === 'live') {
        const c = await db.live.get([playlistId, id]);
        if (c) l = { title: c.title, poster: c.logo, item: c };
      } else if (series.data) {
        const ep = series.data.seasons.flatMap((s) => s.episodes).find((e) => e.id === id);
        const s = seriesId ? ((await db.series.get([playlistId, seriesId])) as SeriesItem | undefined) : undefined;
        if (ep) l = { title: s?.title ?? ep.title, subtitle: `S${ep.season} · E${ep.episode}${ep.title && !/S\d+E\d+/i.test(ep.title) ? ` · ${ep.title}` : ''}`, poster: s?.poster, item: ep, seriesId };
      }
      if (!l || cancelled) return;
      setLoaded(l);
      const src = await resolveStream(kind, playlistId, l.item);
      if (cancelled) return;
      setSource({ ...src, title: l.title, poster: l.poster });
      if (!live && profileId) {
        const p = await getProgress(profileId, kind === 'episode' ? 'episode' : 'movie', playlistId, id);
        if (p && !p.completed && p.positionSec > 5 && (!p.durationSec || p.positionSec < p.durationSec * 0.92)) return setResumeAt(p.positionSec);
      }
      setResumeAt(0);
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, playlistId, id, seriesId, series.data, profileId, live]);

  // 2) Start playback once the resume choice is known
  const start = useCallback(
    (at: number) => {
      if (!player || !source) return;
      player.setBuffer(bufferSec);
      void player.load({ ...source, startAt: at });
      setStarted(true);
      prefApplied.current = false;
    },
    [player, source, bufferSec],
  );
  useEffect(() => {
    if (resumeAt === 0 && !started) start(0);
  }, [resumeAt, started, start]);

  // Preferred audio/subtitle language, once tracks are known
  useEffect(() => {
    if (!player || prefApplied.current || !state.tracks.length) return;
    prefApplied.current = true;
    const match = (lang: string, l?: string) => !!l && (l.toLowerCase().startsWith(lang) || (lang === 'ar' && /arab/i.test(l)));
    if (prefAudio !== 'auto') {
      const a = state.tracks.find((x) => x.kind === 'audio' && match(prefAudio, x.lang ?? x.label));
      if (a && !a.active) player.selectTrack('audio', a.id);
    }
    if (prefSubs !== 'off') {
      const s = state.tracks.find((x) => x.kind === 'text' && match(prefSubs, x.lang ?? x.label));
      if (s) {
        player.selectTrack('text', s.id);
        setSubsOff(false);
      }
    }
  }, [player, state.tracks, prefAudio, prefSubs]);

  // 3) Save progress every 5 s, on pause and on exit
  const persist = useCallback(() => {
    if (!profileId || !loaded || live) return;
    // Read from the last rendered state: on unmount the engine may already be torn down.
    const pos = stateRef.current.current;
    const dur = stateRef.current.duration;
    if (pos < 1) return;
    void saveProgress({
      profileId, kind: kind === 'episode' ? 'episode' : 'movie', playlistId, itemId: id, seriesId: loaded.seriesId,
      season: (loaded.item as Episode).season, episode: (loaded.item as Episode).episode,
      title: loaded.subtitle ? `${loaded.title} · ${loaded.subtitle}` : loaded.title, poster: loaded.poster,
      positionSec: pos, durationSec: dur, completed: stateRef.current.status === 'ended' ? true : undefined,
    });
  }, [profileId, loaded, live, kind, playlistId, id, stateRef]);
  useEffect(() => {
    const iv = setInterval(() => stateRef.current.status === 'playing' && persist(), 5000);
    // The app can be closed or killed (TV home button): save when the page is hidden too.
    const onHide = () => document.visibilityState === 'hidden' && persist();
    addEventListener('pagehide', persist);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      clearInterval(iv);
      removeEventListener('pagehide', persist);
      document.removeEventListener('visibilitychange', onHide);
      persist();
    };
  }, [persist, stateRef]);
  useEffect(() => {
    if (state.status === 'paused' || state.status === 'ended') persist();
  }, [state.status, persist]);

  // Keep the screen awake while playing
  useEffect(() => {
    if (state.status !== 'playing' || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    navigator.wakeLock.request('screen').then((l) => (lock = l)).catch(() => {});
    return () => void lock?.release().catch(() => {});
  }, [state.status]);

  // 4) Next episode: countdown at the end
  useEffect(() => {
    if (!next || !autoplayNext || nextIn !== null || nextCancelled) return;
    const remaining = state.duration - state.current;
    if (state.status === 'ended' || (state.duration > 120 && remaining > 0 && remaining <= 15)) setNextIn(NEXT_COUNTDOWN);
  }, [next, autoplayNext, state.status, state.current, state.duration, nextIn, nextCancelled]);
  const goNext = useCallback(() => {
    if (!next) return;
    persist();
    setNextIn(null);
    nav(`/play/episode/${playlistId}/${encodeURIComponent(next.id)}?s=${encodeURIComponent(seriesId ?? '')}`, { replace: true });
  }, [next, nav, playlistId, seriesId, persist]);
  useEffect(() => {
    if (nextIn === null) return;
    if (nextIn <= 0) return goNext();
    const tm = setTimeout(() => setNextIn((n) => (n === null ? null : n - 1)), 1000);
    return () => clearTimeout(tm);
  }, [nextIn, goNext]);
  // reset per item
  useEffect(() => {
    setStarted(false);
    setResumeAt(null);
    setNextIn(null);
    setNextCancelled(false);
    setExternal(null);
    setOffset(0);
  }, [id]);

  // 5) Sleep timer
  useEffect(() => {
    if (sleep.choice === null) return;
    const iv = setInterval(() => {
      const s = stateRef.current;
      const end = sleep.choice === 'end' ? s.status === 'ended' : sleep.until !== null && Date.now() >= sleep.until;
      if (end) {
        player?.pause();
        setNextIn(null);
        setSleep({ choice: null, until: null });
        showControls();
      }
    }, 1000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sleep, player]);

  // ---------- controls visibility & remote keys ----------
  const showControls = useCallback((focus?: string) => {
    setControls(true);
    resumeNav();
    if (focus) requestAnimationFrame(() => setFocus(focus));
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (stateRef.current.status === 'playing') {
        setControls(false);
      }
    }, HIDE_AFTER);
  }, [stateRef]);

  useEffect(() => {
    if (!controls && !panel && nextIn === null && resumeAt !== null && !state.error) pauseNav();
    else resumeNav();
  }, [controls, panel, nextIn, resumeAt, state.error]);
  useEffect(() => () => resumeNav(), []);
  useEffect(() => {
    if (state.status === 'paused' || state.status === 'error') showControls();
  }, [state.status, showControls]);

  const togglePlay = useCallback(() => {
    if (!player) return;
    if (player.paused) void player.play();
    else player.pause();
  }, [player]);
  const seekBy = useCallback((d: number) => player && !live && player.seek(player.currentTime + d), [player, live]);
  const exit = useCallback(() => {
    persist();
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    nav(-1);
  }, [persist, nav]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (panel || resumeAt === null || nextIn !== null || state.error) return;
      const k = e.key;
      const back = ['Escape', 'GoBack', 'BrowserBack', 'Backspace'].includes(k);
      if (k === 'MediaPlayPause' || k === ' ') return e.preventDefault(), togglePlay(), showControls();
      if (k === 'MediaPlay') return void player?.play();
      if (k === 'MediaPause' || k === 'MediaStop') return player?.pause();
      if (k === 'MediaFastForward') return seekBy(30), showControls();
      if (k === 'MediaRewind') return seekBy(-30), showControls();
      if (k === 'MediaTrackNext') return goNext();
      if (!controls) {
        e.preventDefault();
        e.stopPropagation();
        if (back) return exit();
        if (k === 'ArrowLeft') return seekBy(-10), showControls('player-seek');
        if (k === 'ArrowRight') return seekBy(10), showControls('player-seek');
        if (k === 'Enter') return togglePlay(), showControls('player-play');
        return showControls('player-play');
      }
      if (back) {
        e.preventDefault();
        if (stateRef.current.status === 'playing') {
          setControls(false);
          return;
        }
        return exit();
      }
      showControls();
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, [controls, panel, resumeAt, nextIn, state.error, togglePlay, seekBy, showControls, exit, goNext, player, stateRef]);

  useEffect(() => {
    initCast();
    showControls('player-play');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doCast = async () => {
    if (!source || !player) return;
    const ok = await castMedia({
      url: source.url, title: loaded?.title ?? '', poster: loaded?.poster, startAt: player.currentTime, live,
      contentType: source.kindHint === 'hls' ? 'application/x-mpegURL' : source.kindHint === 'ts' ? 'video/mp2t' : 'video/mp4',
    }).catch(() => false);
    if (ok) {
      player.pause();
      setCastActive(true);
    }
  };

  const lines = external ? cuesAt(external.cues, state.current, offset).map((c) => c.text) : subsOff ? [] : state.cues;
  const busy = !state.error && (state.status === 'loading' || state.status === 'buffering' || !started);
  const video = player?.videoElement ?? null;

  return (
    <div
      ref={container}
      className="fixed inset-0 z-50 select-none bg-black text-white [html.native-video_&]:bg-transparent"
      data-testid="player"
      onMouseMove={() => showControls()}
      onClick={(e) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === 'VIDEO') {
          if (controls) togglePlay();
          showControls();
        }
      }}
    >
      <SubtitleOverlay lines={lines} controlsVisible={controls} />

      {busy && resumeAt !== null && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3">
          <Spinner className="size-12 border-4" />
          {state.retry && <p className="rounded-lg bg-black/60 px-3 py-1 text-sm" data-testid="reconnecting">{t('player.reconnecting', { a: state.retry.attempt, m: state.retry.max })}</p>}
        </div>
      )}

      {castActive && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/80">
          <Cast className="size-12 text-accent-2" />
          <p>{t('player.castingTo', { d: cast.device ?? 'TV' })}</p>
        </div>
      )}

      <div className={`absolute inset-0 z-20 flex flex-col justify-between bg-gradient-to-b from-black/70 via-transparent to-black/80 transition-opacity duration-300 ${controls ? 'opacity-100' : 'pointer-events-none opacity-0'}`} data-testid="controls" data-visible={controls}>
        <FocusSection focusKey="player-top" className="flex items-center gap-3 p-4 md:p-6">
          <CtrlButton label={t('common.back')} onClick={exit} testId="player-back"><ArrowLeft className="size-6 rtl:rotate-180" /></CtrlButton>
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold md:text-xl" data-testid="player-title">{loaded?.title}</p>
            {loaded?.subtitle && <p className="truncate text-sm text-white/70">{loaded.subtitle}</p>}
          </div>
          {live && <span className="ms-2 rounded bg-bad px-2 py-0.5 text-xs font-bold">{t('player.live')}</span>}
          {sleep.until && <span className="ms-auto flex items-center gap-1 text-sm text-white/70"><Moon className="size-4" />{t('player.sleepIn', { m: Math.max(1, Math.ceil((sleep.until - Date.now()) / 60000)) })}</span>}
        </FocusSection>

        <FocusSection focusKey="player-bottom" preferredChildFocusKey="player-play" className="space-y-3 p-4 md:p-6">
          {!live && <SeekBar current={state.current} duration={state.duration} buffered={state.buffered} onSeek={(x) => player?.seek(x)} onToggle={togglePlay} />}
          <div className="flex items-center gap-1" dir="ltr">
            <CtrlButton focusKey="player-play" testId="player-play" label={state.status === 'playing' ? t('player.pause') : t('player.play')} onClick={togglePlay}>
              {state.status === 'playing' || state.status === 'buffering' ? <Pause className="size-7 fill-current" /> : <Play className="size-7 fill-current" />}
            </CtrlButton>
            {!live && (
              <>
                <CtrlButton label={t('player.back10')} onClick={() => seekBy(-10)}><RotateCcw className="size-6" /></CtrlButton>
                <CtrlButton label={t('player.fwd10')} onClick={() => seekBy(10)}><RotateCw className="size-6" /></CtrlButton>
              </>
            )}
            {next && <CtrlButton testId="player-next" label={t('player.next')} onClick={goNext}><SkipForward className="size-6" /></CtrlButton>}
            <div className="flex-1" />
            <CtrlButton testId="player-tracks" label={t('player.tracks')} onClick={() => setPanel('tracks')}><Languages className="size-6" /></CtrlButton>
            {!live && <CtrlButton testId="player-speed" label={t('player.speed')} onClick={() => setPanel('speed')}><Gauge className="size-6" /></CtrlButton>}
            <CtrlButton testId="player-sleep" label={t('player.sleep')} active={sleep.choice !== null} onClick={() => setPanel('sleep')}><Moon className="size-6" /></CtrlButton>
            {player?.canPip() && <CtrlButton label={t('player.pip')} onClick={() => void player.enterPip().catch(() => {})}><PictureInPicture2 className="size-6" /></CtrlButton>}
            {cast.available && <CtrlButton label={t('player.cast')} active={cast.connected} onClick={doCast}><Cast className="size-6" /></CtrlButton>}
            {canAirPlay(video) && <CtrlButton label={t('player.airplay')} onClick={() => video && showAirPlay(video)}><Airplay className="size-6" /></CtrlButton>}
            {!isNative() && layout !== 'tv' && (
              <CtrlButton label={t('player.fullscreen')} onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {})}>
                <Maximize className="size-6" />
              </CtrlButton>
            )}
          </div>
        </FocusSection>
      </div>

      {resumeAt !== null && resumeAt > 0 && !started && (
        <ResumeDialog at={resumeAt} onResume={() => start(resumeAt)} onRestart={() => start(0)} />
      )}
      {nextIn !== null && next && (
        <NextUpCard title={`S${next.season} · E${next.episode}`} seconds={nextIn} onPlay={goNext} onCancel={() => { setNextCancelled(true); setNextIn(null); showControls('player-play'); }} />
      )}
      {state.error && <ErrorOverlay error={state.error} onRetry={() => start(player?.currentTime ?? 0)} onBack={exit} />}

      {panel === 'tracks' && (
        <TracksPanel
          tracks={state.tracks}
          title={loaded?.title ?? ''}
          onSelect={(k, tid) => {
            player?.selectTrack(k, tid);
            if (k === 'text') setSubsOff(tid === null);
          }}
          external={external}
          onExternal={(s) => {
            setExternal(s);
            if (s) setSubsOff(false);
          }}
          subsOff={subsOff && !external}
          offset={offset}
          setOffset={setOffset}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === 'speed' && <SpeedPanel rate={rate} onRate={(r) => { setRate(r); player?.setRate(r); }} onClose={() => setPanel(null)} />}
      {panel === 'sleep' && (
        <SleepPanel
          value={sleep.choice}
          onPick={(c) => setSleep({ choice: c, until: typeof c === 'number' ? Date.now() + c * 60_000 : null })}
          onClose={() => setPanel(null)}
        />
      )}
      {!started && resumeAt === null && <div className="absolute bottom-6 start-6 text-sm text-white/50">{fmtTime(0)}</div>}
    </div>
  );
}
