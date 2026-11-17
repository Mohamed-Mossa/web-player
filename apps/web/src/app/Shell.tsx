import { Clapperboard, Film, Home, Search, Settings, Tv } from 'lucide-react';
import clsx from 'clsx';
import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLayout } from '../lib/platform';
import { usePwa } from '../lib/pwa';
import { Focusable, FocusSection, setFocus } from '../nav/focus';
import { getCurrentFocusKey } from '@noriginmedia/norigin-spatial-navigation';
import { useApp } from '../state/app';
import { Avatar, useProfiles } from '../features/profiles/ProfilesPage';
import { Button } from '../components/ui';

const ITEMS = [
  { to: '/', icon: Home, label: 'nav.home', match: (p: string) => p === '/' },
  { to: '/search', icon: Search, label: 'nav.search', match: (p: string) => p.startsWith('/search') },
  { to: '/movies', icon: Film, label: 'nav.movies', match: (p: string) => p.startsWith('/movie') },
  { to: '/series', icon: Clapperboard, label: 'nav.series', match: (p: string) => p.startsWith('/series') },
  { to: '/live', icon: Tv, label: 'nav.live', match: (p: string) => p.startsWith('/live') },
  { to: '/settings', icon: Settings, label: 'nav.settings', match: (p: string) => p.startsWith('/settings') || p.startsWith('/sources') },
];

const BACK_KEYS = new Set(['Escape', 'GoBack', 'BrowserBack', 'XF86Back']);

/** Remote Back / Esc / Backspace (outside text fields) goes back in history. */
function useBackKey() {
  const nav = useNavigate();
  const loc = useLocation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.startsWith('Arrow')) {
        const cur = getCurrentFocusKey();
        if (!cur || cur === 'SN:ROOT') setFocus('nav-rail');
      }
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA';
      const isBack = BACK_KEYS.has(e.key) || e.keyCode === 10009 || e.keyCode === 461 || (e.key === 'Backspace' && !typing);
      if (!isBack || e.defaultPrevented) return;
      if (loc.pathname === '/') return;
      e.preventDefault();
      if (history.length > 1) nav(-1);
      else nav('/');
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [nav, loc.pathname]);
}

export function Shell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const layout = useLayout();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const profiles = useProfiles();
  const profileId = useApp((s) => s.profileId);
  const profile = profiles?.find((p) => p.id === profileId);
  const pwa = usePwa();
  useBackKey();

  if (layout === 'mobile') {
    return (
      <div className="flex h-full flex-col">
        <main className="min-h-0 flex-1">{children}</main>
        <nav className="flex border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur" data-testid="bottom-tabs">
          {ITEMS.map((it) => (
            <button key={it.to} onClick={() => nav(it.to)} className={clsx('flex flex-1 flex-col items-center gap-0.5 py-2 text-[0.65rem]', it.match(pathname) ? 'text-accent-2' : 'text-muted')}>
              <it.icon className="size-5" />
              {t(it.label)}
            </button>
          ))}
        </nav>
      </div>
    );
  }

  const tv = layout === 'tv';
  return (
    <div className="flex h-full">
      <FocusSection
        as="nav"
        focusKey="nav-rail"
        testId="nav-rail"
        className={clsx('flex shrink-0 flex-col gap-1 border-e border-line/60 bg-surface/60 py-5', tv ? 'w-20 items-center px-2' : 'w-56 px-3')}
      >
        <div className={clsx('mb-6 flex items-center gap-2 px-2', tv && 'justify-center')}>
          <img src="/icon.svg" alt="" className="size-8" />
          {!tv && <span className="text-lg font-bold tracking-tight">IPTV</span>}
        </div>
        {ITEMS.map((it) => {
          const active = it.match(pathname);
          return (
            <Focusable
              key={it.to}
              focusKey={`nav-${it.to}`}
              onSelect={() => nav(it.to)}
              testId={`nav-${it.to.replace('/', '') || 'home'}`}
              title={t(it.label)}
              ariaLabel={t(it.label)}
              className={clsx(
                'flex items-center gap-3 rounded-xl text-sm font-medium',
                tv ? 'size-12 justify-center' : 'px-3 py-2.5',
                active ? 'bg-accent/15 text-accent-2' : 'text-muted hover:bg-surface-2 hover:text-text',
              )}
            >
              <it.icon className="size-5 shrink-0" />
              {!tv && t(it.label)}
            </Focusable>
          );
        })}
        <div className="flex-1" />
        {profile && (
          <Focusable onSelect={() => nav('/profiles')} testId="nav-profile" title={profile.name} className={clsx('flex items-center gap-3 rounded-xl', tv ? 'justify-center p-1' : 'px-2 py-2 hover:bg-surface-2')}>
            <Avatar p={profile} size="sm" />
            {!tv && <span className="truncate text-sm">{profile.name}</span>}
          </Focusable>
        )}
      </FocusSection>
      <main className="relative min-w-0 flex-1">
        {children}
        {pwa.needRefresh && (
          <div className="absolute bottom-4 end-4 z-40 flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-2xl">
            <span className="text-sm">{t('settings.updateReady')}</span>
            <Button variant="primary" onClick={() => pwa.update?.()}>{t('settings.reload')}</Button>
          </div>
        )}
      </main>
    </div>
  );
}
