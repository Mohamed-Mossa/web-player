import { create } from 'zustand';
import { IS_TIZEN } from '../env';

export const usePwa = create<{ needRefresh: boolean; update: (() => Promise<void>) | null }>()(() => ({ needRefresh: false, update: null }));

export async function registerPwa() {
  // The Android app updates through OTA bundles (src/native/ota.ts), not the service worker.
  // The Samsung package is installed from a .wgt file; no service worker there either.
  if (IS_TIZEN || import.meta.env.DEV || !('serviceWorker' in navigator) || (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()) return;
  const { registerSW } = await import('virtual:pwa-register');
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      usePwa.setState({ needRefresh: true, update: () => updateSW(true) });
    },
    onRegisteredSW(_url, reg) {
      // Check for a new deploy every 30 minutes, so long-running TV sessions pick it up.
      if (reg) setInterval(() => reg.update().catch(() => {}), 30 * 60_000);
    },
  });
}
