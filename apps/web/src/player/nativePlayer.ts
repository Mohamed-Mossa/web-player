import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { Emitter, type PlayerAdapter, type PlayerErrorCode, type PlayerStatus, type StreamSource, type Track, type TrackKind } from './types';

/** Bridge to the Kotlin plugin in android/app/src/main/java/…/ExoPlayerPlugin.kt */
interface ExoPlugin {
  create(): Promise<void>;
  load(o: { url: string; live: boolean; startAt: number; headers?: Record<string, string>; title?: string; bufferMs: number }): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(o: { position: number }): Promise<void>;
  setRate(o: { rate: number }): Promise<void>;
  setBuffer(o: { bufferMs: number }): Promise<void>;
  selectTrack(o: { kind: TrackKind; id: string | null }): Promise<void>;
  enterPip(): Promise<void>;
  setFrameRateMatching(o: { enabled: boolean }): Promise<void>;
  destroy(): Promise<void>;
  addListener(event: 'state', cb: (e: { status: PlayerStatus }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'time', cb: (e: { current: number; duration: number; buffered: number }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'tracks', cb: (e: { tracks: Track[] }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'cues', cb: (e: { lines: string[] }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'error', cb: (e: { code: PlayerErrorCode; message: string; httpStatus?: number }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'retry', cb: (e: { attempt: number; max: number }) => void): Promise<PluginListenerHandle>;
}

export const Exo = registerPlugin<ExoPlugin>('ExoPlayer');

export class NativePlayer implements PlayerAdapter {
  readonly engine = 'exoplayer';
  readonly videoElement = null;
  private ev = new Emitter();
  private handles: Promise<PluginListenerHandle>[] = [];
  private t = { current: 0, duration: 0 };
  private tracks: Track[] = [];
  private status: PlayerStatus = 'idle';
  private bufferMs = 30_000;
  private ready: Promise<void>;

  constructor() {
    document.documentElement.classList.add('native-video'); // makes page backgrounds transparent so the video shows
    this.ready = Exo.create();
    this.handles.push(
      Exo.addListener('state', (e) => {
        this.status = e.status;
        this.ev.emit('status', e.status);
      }),
      Exo.addListener('time', (e) => {
        this.t = e;
        this.ev.emit('time', e);
      }),
      Exo.addListener('tracks', (e) => {
        this.tracks = e.tracks;
        this.ev.emit('tracks', e.tracks);
      }),
      Exo.addListener('cues', (e) => this.ev.emit('cues', e.lines)),
      Exo.addListener('error', (e) => this.ev.emit('error', { code: e.code, message: e.message })),
      Exo.addListener('retry', (e) => this.ev.emit('retry', e)),
    );
  }

  get currentTime() {
    return this.t.current;
  }
  get duration() {
    return this.t.duration;
  }
  get paused() {
    return this.status !== 'playing' && this.status !== 'buffering';
  }

  attach() {
    /* the native view sits behind the WebView; nothing to attach in the DOM */
  }
  on: PlayerAdapter['on'] = (e, cb) => this.ev.on(e, cb);

  async load(src: StreamSource) {
    await this.ready;
    await Exo.load({ url: src.url, live: src.live, startAt: src.startAt ?? 0, headers: src.headers, title: src.title, bufferMs: this.bufferMs });
  }
  play() {
    return Exo.play();
  }
  pause() {
    void Exo.pause();
  }
  seek(sec: number) {
    this.t.current = sec;
    void Exo.seek({ position: sec });
  }
  setRate(rate: number) {
    void Exo.setRate({ rate });
  }
  setBuffer(seconds: number) {
    this.bufferMs = seconds * 1000;
    void Exo.setBuffer({ bufferMs: this.bufferMs });
  }
  selectTrack(kind: TrackKind, id: string | null) {
    void Exo.selectTrack({ kind, id });
  }
  getTracks() {
    return this.tracks;
  }
  canPip() {
    return true;
  }
  enterPip() {
    return Exo.enterPip();
  }
  destroy() {
    document.documentElement.classList.remove('native-video');
    this.handles.forEach((h) => h.then((x) => x.remove()));
    void Exo.destroy();
    this.ev.clear();
  }
}
