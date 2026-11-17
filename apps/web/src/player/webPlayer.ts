import Hls, { ErrorTypes, Events as HlsEvents, type ErrorData } from 'hls.js';
import mpegts from 'mpegts.js';
import { Emitter, detectKind, httpStatusToError, type PlayerAdapter, type PlayerErrorCode, type PlayerStatus, type StreamSource, type Track, type TrackKind } from './types';

const BACKOFF = [1000, 2000, 4000, 8000];

/** Web engine: hls.js for HLS, mpegts.js for live MPEG-TS, the native <video> for files (and HLS on Safari). */
export class WebPlayer implements PlayerAdapter {
  readonly video: HTMLVideoElement;
  private ev = new Emitter();
  private hls: Hls | null = null;
  private ts: mpegts.Player | null = null;
  private src: StreamSource | null = null;
  private bufferSec = 30;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private lastProgress = { t: -1, at: 0 };
  private status: PlayerStatus = 'idle';
  private mediaRecoveries = 0;
  private destroyed = false;
  private textTrackHandler: (() => void) | null = null;

  get engine() {
    return this.hls ? 'hls.js' : this.ts ? 'mpegts.js' : 'html5';
  }

  constructor() {
    const v = document.createElement('video');
    v.playsInline = true;
    v.preload = 'auto';
    v.setAttribute('x-webkit-airplay', 'allow');
    v.className = 'absolute inset-0 size-full bg-black object-contain';
    v.dataset.testid = 'video';
    this.video = v;
    v.addEventListener('playing', () => {
      this.setStatus('playing');
    });
    v.addEventListener('pause', () => !v.ended && this.setStatus('paused'));
    v.addEventListener('waiting', () => this.setStatus('buffering'));
    v.addEventListener('ended', () => this.setStatus('ended'));
    v.addEventListener('timeupdate', () => this.emitTime());
    v.addEventListener('durationchange', () => this.emitTime());
    v.addEventListener('loadedmetadata', () => this.emitTracks());
    v.addEventListener('error', () => this.onVideoError());
    v.audioTracks?.addEventListener?.('change', () => this.emitTracks());
    v.textTracks.addEventListener('addtrack', () => this.bindTextTracks());
  }

  get videoElement() {
    return this.video;
  }
  get currentTime() {
    return this.video.currentTime;
  }
  get duration() {
    const d = this.video.duration;
    return Number.isFinite(d) ? d : 0;
  }
  get paused() {
    return this.video.paused;
  }

  attach(container: HTMLElement) {
    container.prepend(this.video);
  }

  on: PlayerAdapter['on'] = (e, cb) => this.ev.on(e, cb);

  private setStatus(s: PlayerStatus) {
    if (s === this.status) return;
    this.status = s;
    this.ev.emit('status', s);
  }

  private emitTime() {
    const v = this.video;
    let buffered = 0;
    for (let i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= v.currentTime + 0.5) buffered = v.buffered.end(i);
    this.ev.emit('time', { current: v.currentTime, duration: this.duration, buffered });
    if (v.currentTime !== this.lastProgress.t) {
      this.lastProgress = { t: v.currentTime, at: Date.now() };
      if (this.attempt > 0 && !v.paused) this.attempt = 0; // healthy again
    }
  }

  private cleanup() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.watchdog) clearInterval(this.watchdog);
    this.hls?.destroy();
    this.hls = null;
    if (this.ts) {
      this.ts.pause();
      this.ts.unload();
      this.ts.detachMediaElement();
      this.ts.destroy();
      this.ts = null;
    }
    this.video.removeAttribute('src');
    this.video.load();
  }

  async load(src: StreamSource) {
    this.src = src;
    this.mediaRecoveries = 0;
    this.start(src.startAt ?? 0);
  }

  private start(startAt: number) {
    const src = this.src!;
    this.cleanup();
    this.setStatus('loading');
    const kind = src.kindHint ?? detectKind(src.url);
    const v = this.video;

    if (kind === 'hls' && Hls.isSupported()) {
      const hls = new Hls({
        maxBufferLength: this.bufferSec,
        maxMaxBufferLength: this.bufferSec * 2,
        backBufferLength: 30,
        liveSyncDurationCount: 3,
        enableWorker: true,
        startPosition: src.live ? -1 : startAt,
        renderTextTracksNatively: true,
        manifestLoadingMaxRetry: 2,
        fragLoadingMaxRetry: 3,
      });
      this.hls = hls;
      hls.on(HlsEvents.MANIFEST_PARSED, () => this.emitTracks());
      hls.on(HlsEvents.AUDIO_TRACKS_UPDATED, () => this.emitTracks());
      hls.on(HlsEvents.AUDIO_TRACK_SWITCHED, () => this.emitTracks());
      hls.on(HlsEvents.SUBTITLE_TRACKS_UPDATED, () => this.emitTracks());
      hls.on(HlsEvents.SUBTITLE_TRACK_SWITCH, () => this.emitTracks());
      hls.on(HlsEvents.LEVEL_SWITCHED, () => this.emitTracks());
      hls.on(HlsEvents.ERROR, (_e, d) => this.onHlsError(d));
      hls.subtitleDisplay = false;
      hls.loadSource(src.url);
      hls.attachMedia(v);
    } else if (kind === 'ts' && mpegts.isSupported()) {
      const p = mpegts.createPlayer(
        { type: 'mpegts', isLive: src.live, url: src.url },
        { enableWorker: true, lazyLoad: false, liveBufferLatencyChasing: src.live, stashInitialSize: 256 * 1024, autoCleanupSourceBuffer: true },
      );
      this.ts = p;
      p.on(mpegts.Events.ERROR, (type: string, detail: string, info: { code?: number; msg?: string }) => {
        if (type === mpegts.ErrorTypes.NETWORK_ERROR) {
          const code = info?.code ?? 0;
          if (code >= 400 && code !== 408) return this.fail(httpStatusToError(code), `HTTP ${code}`);
          return this.scheduleRetry();
        }
        if (type === mpegts.ErrorTypes.MEDIA_ERROR && /CodecUnsupported|FormatUnsupported/.test(detail)) return this.fail('unsupported', detail);
        this.scheduleRetry();
      });
      p.attachMediaElement(v);
      p.load();
    } else {
      v.src = src.url;
      if (startAt > 0 && !src.live) {
        v.addEventListener('loadedmetadata', () => (v.currentTime = startAt), { once: true });
      }
    }
    v.play().catch(() => {
      /* autoplay may need a gesture on some browsers; the UI shows a play button */
    });
    this.startWatchdog();
  }

  /** Live streams stall silently; if time stops moving while we should be playing, reload. */
  private startWatchdog() {
    this.lastProgress = { t: this.video.currentTime, at: Date.now() };
    this.watchdog = setInterval(() => {
      const v = this.video;
      if (v.paused || v.ended || this.status === 'error') return;
      if (Date.now() - this.lastProgress.at > 10_000) this.scheduleRetry();
    }, 2000);
  }

  private onHlsError(d: ErrorData) {
    const code = (d.response as { code?: number } | undefined)?.code ?? 0;
    if (!d.fatal) return;
    if (d.type === ErrorTypes.NETWORK_ERROR) {
      if (code >= 400 && code < 500 && code !== 408) return this.fail(httpStatusToError(code), `HTTP ${code}`);
      return this.scheduleRetry();
    }
    if (d.type === ErrorTypes.MEDIA_ERROR && this.mediaRecoveries < 2) {
      this.mediaRecoveries++;
      if (this.mediaRecoveries === 2) this.hls?.swapAudioCodec();
      this.hls?.recoverMediaError();
      return;
    }
    if (/codec|incompatible|bufferAddCodecError/i.test(d.details)) return this.fail('unsupported', d.details);
    this.scheduleRetry();
  }

  private onVideoError() {
    if (this.hls || this.ts) return; // engines report their own errors
    const err = this.video.error;
    if (!err || !this.video.getAttribute('src')) return;
    if (err.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED || err.code === MediaError.MEDIA_ERR_DECODE) {
      if (err.code === MediaError.MEDIA_ERR_DECODE && this.mediaRecoveries++ < 1) return this.scheduleRetry();
      // Could be a codec problem or an HTTP error hidden behind it; probe once to tell them apart.
      return void this.probe().then((status) => (status && status >= 400 ? this.fail(httpStatusToError(status), `HTTP ${status}`) : this.fail('unsupported', err.message)));
    }
    this.scheduleRetry();
  }

  private async probe(): Promise<number | null> {
    try {
      const r = await fetch(this.src!.url, { method: 'GET', headers: { Range: 'bytes=0-1' } });
      return r.status;
    } catch {
      return null;
    }
  }

  private scheduleRetry() {
    if (this.destroyed || this.retryTimer) return;
    if (this.attempt >= BACKOFF.length) return this.fail('network', 'Stream dropped');
    const delay = BACKOFF[this.attempt++];
    this.ev.emit('retry', { attempt: this.attempt, max: BACKOFF.length });
    this.setStatus('buffering');
    const resumeAt = this.src?.live ? 0 : this.video.currentTime || this.src?.startAt || 0;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.start(resumeAt);
    }, delay);
  }

  private fail(code: PlayerErrorCode, message: string) {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.watchdog) clearInterval(this.watchdog);
    this.setStatus('error');
    this.ev.emit('error', { code, message });
  }

  // ---------- tracks ----------
  getTracks(): Track[] {
    const out: Track[] = [];
    const h = this.hls;
    if (h) {
      h.audioTracks.forEach((t, i) => out.push({ id: String(i), kind: 'audio', label: t.name || t.lang || `Audio ${i + 1}`, lang: t.lang, active: h.audioTrack === i }));
      h.subtitleTracks.forEach((t, i) => out.push({ id: String(i), kind: 'text', label: t.name || t.lang || `Subtitles ${i + 1}`, lang: t.lang, active: h.subtitleTrack === i }));
      if (h.levels.length > 1) {
        out.push({ id: '-1', kind: 'video', label: 'Auto', active: h.autoLevelEnabled });
        h.levels.forEach((l, i) => out.push({ id: String(i), kind: 'video', label: l.height ? `${l.height}p` : `${Math.round(l.bitrate / 1000)} kbps`, active: !h.autoLevelEnabled && h.currentLevel === i }));
      }
      return out;
    }
    const at = this.video.audioTracks;
    if (at && at.length > 1) for (let i = 0; i < at.length; i++) out.push({ id: at[i].id || String(i), kind: 'audio', label: at[i].label || at[i].language || `Audio ${i + 1}`, lang: at[i].language, active: at[i].enabled });
    const tt = this.video.textTracks;
    for (let i = 0; i < tt.length; i++) {
      if (tt[i].kind !== 'subtitles' && tt[i].kind !== 'captions') continue;
      out.push({ id: String(i), kind: 'text', label: tt[i].label || tt[i].language || `Subtitles ${i + 1}`, lang: tt[i].language, active: tt[i].mode !== 'disabled' });
    }
    return out;
  }

  private emitTracks() {
    this.ev.emit('tracks', this.getTracks());
  }

  selectTrack(kind: TrackKind, id: string | null) {
    const h = this.hls;
    if (kind === 'audio') {
      if (h) h.audioTrack = Number(id);
      else {
        const at = this.video.audioTracks;
        for (let i = 0; i < (at?.length ?? 0); i++) at![i].enabled = (at![i].id || String(i)) === id;
      }
    } else if (kind === 'text') {
      if (h) h.subtitleTrack = id === null ? -1 : Number(id);
      const tt = this.video.textTracks;
      for (let i = 0; i < tt.length; i++) {
        const on = h ? id !== null && tt[i].mode !== 'disabled' : String(i) === id;
        if (!h) tt[i].mode = on ? 'hidden' : 'disabled';
      }
      if (id === null) this.ev.emit('cues', []);
      setTimeout(() => this.bindTextTracks(), 200);
    } else if (kind === 'video' && h) {
      h.currentLevel = Number(id);
    }
    setTimeout(() => this.emitTracks(), 50);
  }

  /** Embedded subtitles are never drawn by the browser: we read cues and render them ourselves (styling + offset). */
  private bindTextTracks() {
    const tt = this.video.textTracks;
    if (this.textTrackHandler) for (let i = 0; i < tt.length; i++) tt[i].removeEventListener('cuechange', this.textTrackHandler);
    this.textTrackHandler = () => {
      const lines: string[] = [];
      for (let i = 0; i < tt.length; i++) {
        const t = tt[i];
        if (t.mode === 'showing') t.mode = 'hidden';
        if (t.mode !== 'hidden' || !t.activeCues) continue;
        for (let j = 0; j < t.activeCues.length; j++) lines.push(((t.activeCues[j] as VTTCue).text ?? '').replace(/<[^>]+>/g, ''));
      }
      this.ev.emit('cues', lines);
    };
    for (let i = 0; i < tt.length; i++) {
      if (tt[i].mode === 'showing') tt[i].mode = 'hidden';
      tt[i].addEventListener('cuechange', this.textTrackHandler);
    }
  }

  // ---------- controls ----------
  play() {
    return this.video.play();
  }
  pause() {
    this.video.pause();
  }
  seek(sec: number) {
    const d = this.duration;
    this.video.currentTime = Math.max(0, d ? Math.min(sec, d - 0.5) : sec);
  }
  setRate(rate: number) {
    this.video.playbackRate = rate;
  }
  setBuffer(seconds: number) {
    this.bufferSec = seconds;
    if (this.hls) {
      this.hls.config.maxBufferLength = seconds;
      this.hls.config.maxMaxBufferLength = seconds * 2;
    }
  }
  canPip() {
    return !!document.pictureInPictureEnabled || 'webkitSetPresentationMode' in this.video;
  }
  async enterPip() {
    const v = this.video as HTMLVideoElement & { webkitSetPresentationMode?: (m: string) => void };
    if (document.pictureInPictureElement) return void (await document.exitPictureInPicture());
    if (v.requestPictureInPicture) await v.requestPictureInPicture();
    else v.webkitSetPresentationMode?.('picture-in-picture');
  }

  destroy() {
    this.destroyed = true;
    this.cleanup();
    this.video.remove();
    this.ev.clear();
  }
}
