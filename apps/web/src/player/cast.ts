import { create } from 'zustand';
import { isNative } from '../lib/platform';

/* Minimal typings for the Google Cast Web Sender SDK (loaded at runtime from gstatic). */
type CastWindow = Window & {
  __onGCastApiAvailable?: (ok: boolean) => void;
  cast?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  chrome?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export const useCast = create<{ available: boolean; connected: boolean; device: string | null }>()(() => ({
  available: false,
  connected: false,
  device: null,
}));

let loading: Promise<void> | null = null;

/** Loads the Cast SDK on Chrome desktop/Android browsers. Not used inside the Android app. */
export function initCast(): Promise<void> {
  const w = window as CastWindow;
  if (isNative() || !/Chrome/.test(navigator.userAgent) || /Edg\//.test(navigator.userAgent)) return Promise.resolve();
  loading ??= new Promise<void>((resolve) => {
    w.__onGCastApiAvailable = (ok) => {
      if (!ok || !w.cast?.framework) return resolve();
      const ctx = w.cast.framework.CastContext.getInstance();
      ctx.setOptions({
        receiverApplicationId: w.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
        autoJoinPolicy: w.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
      });
      ctx.addEventListener(w.cast.framework.CastContextEventType.CAST_STATE_CHANGED, (e: { castState: string }) => {
        const s = w.cast.framework.CastState;
        const session = ctx.getCurrentSession();
        useCast.setState({
          available: e.castState !== s.NO_DEVICES_AVAILABLE,
          connected: e.castState === s.CONNECTED,
          device: session?.getCastDevice()?.friendlyName ?? null,
        });
      });
      resolve();
    };
    const sc = document.createElement('script');
    sc.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
    sc.async = true;
    sc.onerror = () => resolve();
    document.head.appendChild(sc);
  });
  return loading;
}

/** Starts (or reuses) a session and loads the stream on the TV. The URL must be reachable by the Chromecast (use the proxy). */
export async function castMedia(m: { url: string; title: string; poster?: string; startAt?: number; live: boolean; contentType: string }) {
  const w = window as CastWindow;
  if (!w.cast?.framework) return false;
  const ctx = w.cast.framework.CastContext.getInstance();
  if (!ctx.getCurrentSession()) await ctx.requestSession();
  const session = ctx.getCurrentSession();
  if (!session) return false;
  const info = new w.chrome.cast.media.MediaInfo(m.url, m.contentType);
  info.streamType = m.live ? w.chrome.cast.media.StreamType.LIVE : w.chrome.cast.media.StreamType.BUFFERED;
  info.metadata = new w.chrome.cast.media.GenericMediaMetadata();
  info.metadata.title = m.title;
  if (m.poster) info.metadata.images = [new w.chrome.cast.Image(m.poster)];
  const req = new w.chrome.cast.media.LoadRequest(info);
  req.currentTime = m.startAt ?? 0;
  await session.loadMedia(req);
  return true;
}

export function stopCasting() {
  const w = window as CastWindow;
  w.cast?.framework?.CastContext.getInstance().endCurrentSession(true);
}

export function canAirPlay(video: HTMLVideoElement | null) {
  return !!video && 'webkitShowPlaybackTargetPicker' in video;
}
export function showAirPlay(video: HTMLVideoElement) {
  (video as HTMLVideoElement & { webkitShowPlaybackTargetPicker: () => void }).webkitShowPlaybackTargetPicker();
}
