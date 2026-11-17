import { App } from '@capacitor/app';
import { registerPlugin } from '@capacitor/core';
import { isNative, setNativeTv } from '../lib/platform';
import { useApp } from '../state/app';
import { initOta } from './ota';
import { Exo } from '../player/nativePlayer';

export interface TvBridgePlugin {
  info(): Promise<{ isTv: boolean; voice: boolean; nativeApi: number }>;
  voiceSearch(o: { lang: string }): Promise<{ text: string }>;
}
export const TvBridge = registerPlugin<TvBridgePlugin>('TvBridge');

export const nativeInfo = { isTv: false, voice: false, nativeApi: 0 };

/** Android start-up: TV detection, Back button → Escape, OTA updates. Safe to call on the web (no-op). */
export async function initNative() {
  if (!isNative()) return;
  try {
    Object.assign(nativeInfo, await Promise.race([TvBridge.info(), new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), 1500))]));
    setNativeTv(nativeInfo.isTv);
  } catch {
    /* older APK without the bridge */
  }
  App.addListener('backButton', () => {
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    const notHandled = window.dispatchEvent(ev);
    if (notHandled && location.pathname === '/') void App.exitApp();
  });
  void Exo.setFrameRateMatching({ enabled: useApp.getState().afr }).catch(() => {});
  useApp.subscribe((s, p) => {
    if (s.afr !== p.afr) void Exo.setFrameRateMatching({ enabled: s.afr }).catch(() => {});
  });
  initOta().catch(() => {});
  // Tapping a programme reminder opens its channel
  import('@capacitor/local-notifications').then(({ LocalNotifications }) =>
    LocalNotifications.addListener('localNotificationActionPerformed', (a) => {
      const path = (a.notification.extra as { path?: string } | undefined)?.path;
      if (path) location.assign(path);
    }),
  ).catch(() => {});
}

export async function voiceSearch(lang: 'ar' | 'en'): Promise<string> {
  const r = await TvBridge.voiceSearch({ lang: lang === 'ar' ? 'ar-EG' : 'en-US' });
  return r.text;
}
