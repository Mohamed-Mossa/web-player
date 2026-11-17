import { useEffect, useState } from 'react';
import { useApp, type LayoutMode } from '../state/app';

const TV_UA = /Android TV|AFT[A-Z0-9]|BRAVIA|SmartTV|SMART-TV|GoogleTV|Chromecast|AndroidTV|Leanback|MiBOX|SHIELD/i;

export function detectLayout(): LayoutMode {
  const params = new URLSearchParams(location.search);
  const forced = params.get('layout');
  if (forced === 'tv' || forced === 'desktop' || forced === 'mobile') return forced;
  if (TV_UA.test(navigator.userAgent)) return 'tv';
  const coarse = matchMedia('(pointer: coarse)').matches;
  if (coarse && Math.min(screen.width, screen.height) < 820) return 'mobile';
  if (innerWidth < 720) return 'mobile';
  return 'desktop';
}

export function useLayout(): LayoutMode {
  const override = useApp((s) => s.layoutOverride);
  const [auto, setAuto] = useState<LayoutMode>(detectLayout);
  useEffect(() => {
    const onResize = () => setAuto(detectLayout());
    addEventListener('resize', onResize);
    return () => removeEventListener('resize', onResize);
  }, []);
  const mode = override ?? auto;
  useEffect(() => {
    document.documentElement.dataset.layout = mode;
  }, [mode]);
  return mode;
}

export const isNative = () => !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
