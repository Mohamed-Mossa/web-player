import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { GIT_SHA, NATIVE_API, OTA_BASE } from '../env';
import { usePwa } from '../lib/pwa';
import { nativeInfo } from './bridge';

interface OtaManifest {
  version: string;
  sha: string;
  url: string;
  nativeApi: number;
}

/**
 * Self-hosted over-the-air updates: every Pages deploy publishes /ota/version.json + a zip of the web
 * build. The APK downloads it in the background and switches on the next launch (or right away when the
 * user taps "Reload"). Bundles that need newer native code are skipped until the APK is updated.
 */
export async function initOta() {
  await CapacitorUpdater.notifyAppReady(); // confirms this bundle works; a broken bundle is rolled back
  if (!OTA_BASE) return;
  const res = await fetch(`${OTA_BASE}/ota/version.json`, { cache: 'no-store' });
  if (!res.ok) return;
  const m = (await res.json()) as OtaManifest;
  if (m.sha === GIT_SHA) return;
  if ((m.nativeApi ?? 0) > Math.max(nativeInfo.nativeApi, NATIVE_API)) return;
  const bundle = await CapacitorUpdater.download({ url: new URL(m.url, OTA_BASE).toString(), version: m.version });
  await CapacitorUpdater.next({ id: bundle.id });
  usePwa.setState({ needRefresh: true, update: async () => void (await CapacitorUpdater.set({ id: bundle.id })) });
}
