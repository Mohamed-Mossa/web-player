import { create } from 'zustand';

export const usePwa = create<{ needRefresh: boolean; update: (() => Promise<void>) | null }>()(() => ({ needRefresh: false, update: null }));

export async function registerPwa() {
  if (import.meta.env.DEV || !('serviceWorker' in navigator)) return;
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
