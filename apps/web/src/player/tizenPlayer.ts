import { Emitter, httpStatusToError, type PlayerAdapter, type PlayerErrorCode, type PlayerStatus, type StreamSource, type Track, type TrackKind } from './types';

/** The parts of Samsung's webapis.avplay that we use (Tizen 5.5+). */
interface AVPlayTrack {
  index: number;
  type: 'VIDEO' | 'AUDIO' | 'TEXT' | string;
  extra_info: string;
}
interface AVPlayListener {
  onbufferingstart?: () => void;
  onbufferingprogress?: (percent: number) => void;
  onbufferingcomplete?: () => void;
  oncurrentplaytime?: (ms: number) => void;
  onstreamcompleted?: () => void;
  onevent?: (type: string, data: string) => void;
  onerror?: (type: string) => void;
  onsubtitlechange?: (duration: number, text: string) => void;
}
interface AVPlay {
  open(url: string): void;
  close(): void;
  prepareAsync(ok: () => void, err: (e: { name?: string; message?: string } | string) => void): void;
  play(): void;
  pause(): void;
  stop(): void;
  seekTo(ms: number, ok?: () => void, err?: (e: unknown) => void): void;
  getCurrentTime(): number;
  getDuration(): number;
  getState(): 'NONE' | 'IDLE' | 'READY' | 'PLAYING' | 'PAUSED';
  setListener(l: AVPlayListener): void;
  setDisplayRect(x: number, y: number, w: number, h: number): void;
  setDisplayMethod?(m: string): void;
  setBufferingParam(option: string, unit: string, amount: number): void;
  setStreamingProperty(prop: string, value: string): void;
  setSpeed(speed: number): void;
  getTotalTrackInfo(): AVPlayTrack[];
  getCurrentStreamInfo(): AVPlayTrack[];
  setSelectTrack(type: 'AUDIO' | 'TEXT', index: number): void;
  setSilentSubtitle(silent: boolean): void;
  suspend(): void;
  restore(url?: string, resumeMs?: number, prebuffer?: boolean): void;
}

const avplay = (): AVPlay | null => (window as unknown as { webapis?: { avplay?: AVPlay } }).webapis?.avplay ?? null;
export const hasAvPlay = () => !!avplay();

const BACKOFF = [1000, 2000, 4000, 8000];
const STALL_MS = 20_000;

/** "eng" → "en", leaves 2-letter codes alone. */
function lang2(code: string | undefined): string | undefined {
  if (!code) return undefined;
  const c = code.toLowerCase();
  const map: Record<string, string> = { eng: 'en', ara: 'ar', fre: 'fr', fra: 'fr', ger: 'de', deu: 'de', spa: 'es', ita: 'it', tur: 'tr', por: 'pt', rus: 'ru', hin: 'hi', urd: 'ur', fas: 'fa', per: 'fa', und: '' };
  return c in map ? map[c] || undefined : c.slice(0, 2);
}

function parseExtra(s: string): Record<string, string | number> {
  try {
    return JSON.parse(s) as Record<string, string | number>;
  } catch {
    return {};
  }
}

function mapError(type: string): PlayerErrorCode {
  if (/NOT_SUPPORTED|UNSUPPORTED|CODEC|FORMAT/i.test(type)) return 'unsupported';
  if (/CONNECTION|NETWORK|TIMEOUT|INVALID_URI|STREAMING/i.test(type)) return 'network';
  return 'unknown';
}

/**
 * Samsung TV engine: the built-in AVPlay player (hardware decoding, MKV/HEVC/AC3/EAC3, embedded
 * audio and subtitle tracks). The video plane sits under the web page, which turns transparent.
 */
export class TizenPlayer implements PlayerAdapter {
  private static live = 0;
  readonly engine = 'avplay';
  readonly videoElement = null;
  private ev = new Emitter();
  private obj: HTMLObjectElement;
  private src: StreamSource | null = null;
  private status: PlayerStatus = 'idle';
  private t = { current: 0, duration: 0 };
  private tracks: Track[] = [];
  private bufferSec = 30;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;
  private cueTimer: ReturnType<typeof setTimeout> | null = null;
  private lastProgress = { t: -1, at: 0 };
  private wantPlaying = true;
  private destroyed = false;
  private onVisibility = () => this.handleVisibility();
  private onResize = () => this.fitDisplay();

  constructor() {
    document.documentElement.classList.add('native-video');
    let obj = document.getElementById('av-player') as HTMLObjectElement | null;
    if (!obj) {
      obj = document.createElement('object');
      obj.id = 'av-player';
      obj.type = 'application/avplayer';
      obj.setAttribute('style', 'position:fixed;left:0;top:0;width:100%;height:100%;z-index:-1;pointer-events:none');
      document.body.appendChild(obj);
    }
    this.obj = obj;
    TizenPlayer.live++;
    document.addEventListener('visibilitychange', this.onVisibility);
    addEventListener('resize', this.onResize);
  }

  get currentTime() {
    return this.t.current;
  }
  get duration() {
    return this.t.duration;
  }
  get paused() {
    return this.status !== 'playing' && this.status !== 'buffering' && this.status !== 'loading';
  }

  attach() {
    /* AVPlay draws on its own plane; the <object> lives on <body> */
  }
  on: PlayerAdapter['on'] = (e, cb) => this.ev.on(e, cb);

  private setStatus(s: PlayerStatus) {
    if (s === this.status) return;
    this.status = s;
    this.ev.emit('status', s);
  }

  private fitDisplay() {
    try {
      avplay()?.setDisplayRect(0, 0, innerWidth, innerHeight);
    } catch {
      /* not open yet */
    }
  }

  async load(src: StreamSource) {
    this.src = src;
    this.attempt = 0;
    this.wantPlaying = true;
    this.t = { current: src.startAt ?? 0, duration: 0 };
    await this.open(src.startAt ?? 0);
  }

  private open(startAt: number): Promise<void> {
    const av = avplay();
    const src = this.src;
    if (!av || !src) {
      this.fail('unsupported', 'AVPlay is not available');
      return Promise.resolve();
    }
    this.stopPoll();
    this.setStatus('loading');
    try {
      av.stop();
    } catch {
      /* idle */
    }
    try {
      av.close();
    } catch {
      /* idle */
    }
    return new Promise<void>((resolve) => {
      try {
        av.open(src.url);
        av.setListener({
          onbufferingstart: () => this.setStatus('buffering'),
          onbufferingcomplete: () => this.setStatus(this.wantPlaying ? 'playing' : 'paused'),
          oncurrentplaytime: (ms) => this.tick(ms),
          onstreamcompleted: () => {
            if (src.live) return this.retry();
            this.setStatus('ended');
          },
          onerror: (type) => this.onError(type),
          onsubtitlechange: (duration, text) => this.showCue(duration, text),
          onevent: () => {},
        });
        this.fitDisplay();
        try {
          av.setDisplayMethod?.('PLAYER_DISPLAY_MODE_LETTER_BOX');
        } catch {
          /* older firmware */
        }
        const ua = src.headers?.['User-Agent'] ?? src.headers?.['user-agent'];
        if (ua) {
          try {
            av.setStreamingProperty('USER_AGENT', ua);
          } catch {
            /* ignored */
          }
        }
        try {
          av.setBufferingParam('PLAYER_BUFFER_FOR_PLAY', 'PLAYER_BUFFER_SIZE_IN_SECOND', Math.min(10, Math.max(3, Math.round(this.bufferSec / 4))));
          av.setBufferingParam('PLAYER_BUFFER_FOR_RESUME', 'PLAYER_BUFFER_SIZE_IN_SECOND', Math.min(15, Math.max(5, Math.round(this.bufferSec / 2))));
        } catch {
          /* defaults */
        }
      } catch (e) {
        this.fail('unsupported', String((e as Error)?.message ?? e));
        return resolve();
      }
      av.prepareAsync(
        () => {
          if (this.destroyed) return resolve();
          this.t.duration = src.live ? 0 : Math.max(0, av.getDuration() / 1000);
          this.readTracks();
          const startPlay = () => {
            try {
              if (this.wantPlaying) av.play();
              this.setStatus(this.wantPlaying ? 'playing' : 'paused');
            } catch (e) {
              this.fail('unknown', String((e as Error)?.message ?? e));
            }
            this.startPoll();
            resolve();
          };
          if (startAt > 1 && !src.live) {
            av.seekTo(Math.floor(startAt * 1000), startPlay, startPlay);
          } else startPlay();
        },
        (e) => {
          const name = typeof e === 'string' ? e : e?.name ?? e?.message ?? 'PLAYER_ERROR';
          void this.onError(name).then(resolve);
        },
      );
    });
  }

  private tick(ms: number) {
    const cur = ms / 1000;
    if (cur !== this.t.current) {
      this.lastProgress = { t: cur, at: Date.now() };
      if (this.attempt > 0 && cur > 0) this.attempt = 0; // healthy again
    }
    this.t.current = cur;
    this.ev.emit('time', { current: cur, duration: this.t.duration, buffered: cur });
  }

  private startPoll() {
    this.stopPoll();
    this.lastProgress = { t: this.t.current, at: Date.now() };
    this.poll = setInterval(() => {
      const av = avplay();
      if (!av) return;
      try {
        const state = av.getState();
        if (state === 'PLAYING') this.tick(av.getCurrentTime());
        if (!this.src?.live && !this.t.duration) this.t.duration = Math.max(0, av.getDuration() / 1000);
      } catch {
        /* closed */
      }
      // a live stream that stops moving is reopened
      if (this.wantPlaying && this.status !== 'paused' && Date.now() - this.lastProgress.at > STALL_MS) {
        this.lastProgress.at = Date.now();
        this.retry();
      }
    }, 500);
  }

  private stopPoll() {
    if (this.poll) clearInterval(this.poll);
    this.poll = null;
  }

  private readTracks() {
    const av = avplay();
    if (!av) return;
    let all: AVPlayTrack[] = [];
    let current: AVPlayTrack[] = [];
    try {
      all = av.getTotalTrackInfo() ?? [];
      current = av.getCurrentStreamInfo() ?? [];
    } catch {
      return;
    }
    const isActive = (t: AVPlayTrack) => current.some((c) => c.type === t.type && c.index === t.index);
    const tracks: Track[] = [];
    for (const t of all) {
      const x = parseExtra(t.extra_info);
      if (t.type === 'AUDIO') {
        const lang = lang2(String(x.language ?? ''));
        const codec = String(x.fourCC ?? '').toUpperCase();
        const ch = Number(x.channels ?? 0);
        tracks.push({ id: String(t.index), kind: 'audio', lang, active: isActive(t), label: [lang?.toUpperCase() || `#${t.index}`, codec, ch > 2 ? `${ch === 6 ? '5.1' : ch}` : ''].filter(Boolean).join(' · ') });
      } else if (t.type === 'TEXT') {
        const lang = lang2(String(x.track_lang ?? x.language ?? ''));
        tracks.push({ id: String(t.index), kind: 'text', lang, active: false, label: lang?.toUpperCase() || `#${t.index}` });
      }
    }
    const activeText = this.tracks.find((t) => t.kind === 'text' && t.active)?.id;
    for (const t of tracks) if (t.kind === 'text') t.active = t.id === activeText;
    this.tracks = tracks;
    this.ev.emit('tracks', tracks);
    // subtitles stay hidden until the user (or the preferred-language logic) picks one
    if (!activeText) {
      try {
        av.setSilentSubtitle(true);
      } catch {
        /* no subtitles */
      }
    }
  }

  private showCue(durationMs: number, text: string) {
    if (this.cueTimer) clearTimeout(this.cueTimer);
    const lines = String(text ?? '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    this.ev.emit('cues', lines);
    this.cueTimer = setTimeout(() => this.ev.emit('cues', []), Math.max(500, durationMs || 3000));
  }

  private async onError(type: string) {
    if (this.destroyed) return;
    const code = mapError(type);
    if (code === 'unsupported') return this.fail('unsupported', type);
    // Find out why: an expired account or too many connections looks like a dropped stream otherwise.
    const status = await this.probe();
    if (status && status >= 400) {
      const c = httpStatusToError(status);
      if (c !== 'network') return this.fail(c, `HTTP ${status}`);
    }
    this.retry();
  }

  private async probe(): Promise<number | null> {
    if (!this.src) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await fetch(this.src.url, { headers: { Range: 'bytes=0-1' }, signal: ctrl.signal });
      void res.body?.cancel().catch(() => {});
      return res.status;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private retry() {
    if (this.destroyed || this.retryTimer || !this.src) return;
    if (this.attempt >= BACKOFF.length) return this.fail('network', 'Stream dropped');
    const delay = BACKOFF[this.attempt++];
    this.ev.emit('retry', { attempt: this.attempt, max: BACKOFF.length });
    this.setStatus('buffering');
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.open(this.src?.live ? 0 : this.t.current);
    }, delay);
  }

  private fail(code: PlayerErrorCode, message: string) {
    this.stopPoll();
    this.setStatus('error');
    this.ev.emit('error', { code, message });
  }

  private handleVisibility() {
    const av = avplay();
    if (!av || !this.src) return;
    try {
      if (document.hidden) av.suspend();
      else {
        av.restore();
        this.fitDisplay();
      }
    } catch {
      /* not playing */
    }
  }

  async play() {
    this.wantPlaying = true;
    const av = avplay();
    if (!av) return;
    if (this.status === 'ended' && this.src) return void (await this.open(0));
    if (this.status === 'error' && this.src) {
      this.attempt = 0;
      return void (await this.open(this.src.live ? 0 : this.t.current));
    }
    try {
      av.play();
      this.setStatus('playing');
      this.lastProgress.at = Date.now();
    } catch {
      /* not ready */
    }
  }

  pause() {
    this.wantPlaying = false;
    try {
      avplay()?.pause();
      this.setStatus('paused');
    } catch {
      /* not ready */
    }
  }

  seek(sec: number) {
    const av = avplay();
    if (!av || this.src?.live) return;
    const target = Math.max(0, this.t.duration ? Math.min(sec, this.t.duration - 1) : sec);
    this.t.current = target;
    this.lastProgress.at = Date.now();
    try {
      av.seekTo(Math.floor(target * 1000));
    } catch {
      /* not seekable */
    }
  }

  setRate(rate: number) {
    // AVPlay only does whole-number speeds forwards
    try {
      avplay()?.setSpeed(rate >= 2 ? Math.round(rate) : 1);
    } catch {
      /* live streams */
    }
  }

  setBuffer(seconds: number) {
    this.bufferSec = seconds; // used on the next open()
  }

  selectTrack(kind: TrackKind, id: string | null) {
    const av = avplay();
    if (!av) return;
    try {
      if (kind === 'audio' && id !== null) av.setSelectTrack('AUDIO', Number(id));
      if (kind === 'text') {
        if (id === null) av.setSilentSubtitle(true);
        else {
          av.setSelectTrack('TEXT', Number(id));
          av.setSilentSubtitle(false);
        }
        if (id === null) this.ev.emit('cues', []);
      }
    } catch {
      /* unsupported track */
    }
    this.tracks = this.tracks.map((t) => (t.kind === kind ? { ...t, active: t.id === id } : t));
    this.ev.emit('tracks', this.tracks);
  }

  getTracks() {
    return this.tracks;
  }
  canPip() {
    return false;
  }
  async enterPip() {
    /* not on TVs */
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    const last = --TizenPlayer.live === 0;
    this.stopPoll();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.cueTimer) clearTimeout(this.cueTimer);
    document.removeEventListener('visibilitychange', this.onVisibility);
    removeEventListener('resize', this.onResize);
    this.ev.clear();
    if (!last) return; // a newer player already owns AVPlay
    try {
      avplay()?.stop();
    } catch {
      /* idle */
    }
    try {
      avplay()?.close();
    } catch {
      /* idle */
    }
    this.obj.remove();
    document.documentElement.classList.remove('native-video');
  }
}
