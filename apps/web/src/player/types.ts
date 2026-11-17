export type TrackKind = 'audio' | 'text' | 'video';

export interface Track {
  id: string;
  kind: TrackKind;
  label: string;
  lang?: string;
  active: boolean;
}

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'ended' | 'error';

export type PlayerErrorCode = 'network' | 'unsupported' | 'forbidden' | 'notFound' | 'maxConnections' | 'unknown';

export interface PlayerError {
  code: PlayerErrorCode;
  message: string;
}

export interface StreamSource {
  url: string;
  live: boolean;
  startAt?: number;
  kindHint?: 'hls' | 'ts' | 'file';
  title?: string;
  poster?: string;
  /** Extra HTTP headers (native player only; the web player sends them through the proxy). */
  headers?: Record<string, string>;
}

export interface PlayerEvents {
  status: PlayerStatus;
  time: { current: number; duration: number; buffered: number };
  tracks: Track[];
  cues: string[]; // active embedded subtitle lines
  error: PlayerError;
  retry: { attempt: number; max: number };
}

export type Listener<K extends keyof PlayerEvents> = (v: PlayerEvents[K]) => void;

/** One interface for every engine: hls.js / mpegts.js / <video> on the web, Media3 ExoPlayer on Android. */
export interface PlayerAdapter {
  readonly engine: string;
  attach(container: HTMLElement): void;
  load(src: StreamSource): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  seek(sec: number): void;
  setRate(rate: number): void;
  setBuffer(seconds: number): void;
  selectTrack(kind: TrackKind, id: string | null): void;
  getTracks(): Track[];
  readonly currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  canPip(): boolean;
  enterPip(): Promise<void>;
  /** The underlying <video> on the web (for AirPlay); null on native. */
  readonly videoElement: HTMLVideoElement | null;
  on<K extends keyof PlayerEvents>(event: K, cb: Listener<K>): () => void;
  destroy(): void;
}

export class Emitter {
  private map = new Map<string, Set<(v: unknown) => void>>();
  on<K extends keyof PlayerEvents>(event: K, cb: Listener<K>) {
    if (!this.map.has(event)) this.map.set(event, new Set());
    this.map.get(event)!.add(cb as (v: unknown) => void);
    return () => this.map.get(event)!.delete(cb as (v: unknown) => void);
  }
  emit<K extends keyof PlayerEvents>(event: K, v: PlayerEvents[K]) {
    this.map.get(event)?.forEach((cb) => cb(v));
  }
  clear() {
    this.map.clear();
  }
}

export function detectKind(url: string): 'hls' | 'ts' | 'file' {
  const path = url.split('?')[0].toLowerCase();
  // proxied URLs carry the real one in ?u=
  const inner = /[?&]u=([^&]+)/.exec(url)?.[1];
  const p = inner ? decodeURIComponent(inner).split('?')[0].toLowerCase() : path;
  if (p.endsWith('.m3u8') || p.endsWith('.m3u')) return 'hls';
  if (p.endsWith('.ts') || p.endsWith('.mpegts')) return 'ts';
  return 'file';
}

export function httpStatusToError(status: number): PlayerErrorCode {
  if (status === 401 || status === 403) return 'forbidden';
  if (status === 404) return 'notFound';
  if (status === 429 || status === 458 || status === 509) return 'maxConnections';
  return 'network';
}

// Safari / Chromium-with-flag only; not in lib.dom.
declare global {
  interface AudioTrackLike {
    id: string;
    label: string;
    language: string;
    enabled: boolean;
  }
  interface AudioTrackListLike extends EventTarget {
    readonly length: number;
    [index: number]: AudioTrackLike;
  }
  interface HTMLVideoElement {
    readonly audioTracks?: AudioTrackListLike;
  }
}
