import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Kind } from '@iptv/core';

export type Lang = 'en' | 'ar';
export type LayoutMode = 'tv' | 'desktop' | 'mobile';
export type SortKey = 'added' | 'name' | 'year' | 'rating';

export interface SubtitleStyle {
  size: 's' | 'm' | 'l' | 'xl';
  color: string;
  background: 'none' | 'shadow' | 'box';
}

export interface CatalogView {
  categoryId: string | null; // null = all
  sort: SortKey;
  genre: string | null;
  decade: number | null; // 2020, 2010 … ; 0 = before 1990
  minRating: number | null;
}

const defaultView: CatalogView = { categoryId: null, sort: 'added', genre: null, decade: null, minRating: null };

interface AppState {
  lang: Lang;
  layoutOverride: LayoutMode | null;
  proxyBase: string;
  refreshHours: number;
  profileId: string | null;
  views: Record<Kind, CatalogView>;
  bufferSec: number;
  autoplayNext: boolean;
  subtitle: SubtitleStyle;
  prefAudio: 'auto' | 'ar' | 'en';
  prefSubs: 'off' | 'ar' | 'en';
  set: (patch: Partial<Pick<AppState, 'bufferSec' | 'autoplayNext' | 'subtitle' | 'prefAudio' | 'prefSubs'>>) => void;
  setLang: (l: Lang) => void;
  setLayoutOverride: (m: LayoutMode | null) => void;
  setProxyBase: (s: string) => void;
  setRefreshHours: (h: number) => void;
  setProfileId: (id: string | null) => void;
  setView: (kind: Kind, patch: Partial<CatalogView>) => void;
}

export const useApp = create<AppState>()(
  persist(
    (set) => ({
      lang: navigator.language?.startsWith('ar') ? 'ar' : 'en',
      layoutOverride: null,
      proxyBase: '',
      refreshHours: 12,
      profileId: null,
      views: { movie: defaultView, series: defaultView, live: { ...defaultView, sort: 'added' } },
      bufferSec: 30,
      autoplayNext: true,
      subtitle: { size: 'm', color: '#ffffff', background: 'shadow' },
      prefAudio: 'auto',
      prefSubs: 'off',
      set: (patch) => set(patch),
      setLang: (lang) => set({ lang }),
      setLayoutOverride: (layoutOverride) => set({ layoutOverride }),
      setProxyBase: (proxyBase) => set({ proxyBase: proxyBase.trim() }),
      setRefreshHours: (refreshHours) => set({ refreshHours }),
      setProfileId: (profileId) => set({ profileId }),
      setView: (kind, patch) => set((s) => ({ views: { ...s.views, [kind]: { ...s.views[kind], ...patch } } })),
    }),
    { name: 'iptv-ui', version: 1 },
  ),
);

/** Session-only state (not persisted): which PIN-protected profile was unlocked. */
export const useSession = create<{ unlocked: string | null; setUnlocked: (id: string | null) => void }>()((set) => ({
  unlocked: null,
  setUnlocked: (unlocked) => set({ unlocked }),
}));
