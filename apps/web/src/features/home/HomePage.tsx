import { AlertTriangle, ListPlus, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import type { SeriesItem, VodItem } from '@iptv/core';
import { useCatalog, usePlaylists, type GridItem } from '../../data/catalog';
import { useFavorites } from '../../data/items';
import { daysLeft } from '../../data/playlists';
import { db } from '../../db/db';
import { useApp } from '../../state/app';
import { useSync } from '../../sync/catalogSync';
import { FocusSection, setFocus } from '../../nav/focus';
import { useLayout } from '../../lib/platform';
import { Button, Empty, SectionTitle } from '../../components/ui';
import { PosterCard } from '../../components/cards';

export function NoPlaylists() {
  const { t } = useTranslation();
  const nav = useNavigate();
  return (
    <FocusSection autoFocus className="h-full">
      <Empty title={t('home.welcome')} icon={<ListPlus className="size-12 text-accent" />}>
        <Button variant="primary" testId="welcome-add" onClick={() => nav('/sources/add')}>{t('home.addPlaylist')}</Button>
      </Empty>
    </FocusSection>
  );
}

export function HomePage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const playlists = usePlaylists();
  const profileId = useApp((s) => s.profileId);
  const favorites = useFavorites(profileId);
  const syncing = useSync((s) => s.byId);
  const { data: movies } = useCatalog('movie');
  const { data: series } = useCatalog('series');
  const progress = useLiveQuery(
    async () => (profileId ? (await db.progress.where('profileId').equals(profileId).toArray()).filter((p) => !p.completed && p.positionSec > 0).sort((a, b) => b.lastWatchedAt - a.lastWatchedAt).slice(0, 20) : []),
    [profileId],
  );

  const recentMovies = useMemo(() => [...(movies ?? [])].sort((a, b) => (b as VodItem).addedAt - (a as VodItem).addedAt).slice(0, 24), [movies]);
  const recentSeries = useMemo(() => [...(series ?? [])].sort((a, b) => (b as SeriesItem).addedAt - (a as SeriesItem).addedAt).slice(0, 24), [series]);

  // Rows load asynchronously: move focus onto the first poster once they appear.
  const layout = useLayout();
  const focused = useRef(false);
  const hasRows = recentMovies.length > 0 || !!favorites?.length;
  useEffect(() => {
    if (!hasRows || focused.current || layout === 'mobile') return;
    focused.current = true;
    requestAnimationFrame(() => setFocus('home-rows'));
  }, [hasRows, layout]);

  if (playlists && playlists.length === 0) return <NoPlaylists />;

  const open = (it: { kind: string; playlistId: string; id: string }) => nav(`/${it.kind}/${it.playlistId}/${encodeURIComponent(it.id)}`);

  const banners = (playlists ?? []).flatMap((p) => {
    const out: { key: string; tone: 'warn' | 'bad' | 'info'; text: string }[] = [];
    const d = daysLeft(p.account);
    if (d !== null && d <= 0) out.push({ key: `${p.id}-exp`, tone: 'bad', text: t('home.expired', { name: p.name }) });
    else if (d !== null && d <= 7) out.push({ key: `${p.id}-soon`, tone: 'warn', text: t('home.expiresSoon', { name: p.name, count: d }) });
    const s = syncing[p.id];
    if (s?.running) out.push({ key: `${p.id}-sync`, tone: 'info', text: t('home.syncing', { name: p.name }) });
    else if (s?.error) out.push({ key: `${p.id}-err`, tone: 'bad', text: t('home.syncFailed', { name: p.name, error: t(`sources.errors.${s.error.code}`, { defaultValue: s.error.message }) }) });
    return out;
  });

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <FocusSection autoFocus preferredChildFocusKey="home-rows" className="space-y-10 px-4 py-6 md:px-10 md:py-10">
        {banners.length > 0 && (
          <div className="space-y-2" data-testid="banners">
            {banners.map((b) => (
              <div key={b.key} className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm ${b.tone === 'bad' ? 'bg-bad/10 text-bad' : b.tone === 'warn' ? 'bg-warn/10 text-warn' : 'bg-accent/10 text-accent-2'}`}>
                {b.tone === 'info' ? <Loader2 className="size-4 animate-spin" /> : <AlertTriangle className="size-4" />}
                <span className="flex-1">{b.text}</span>
                {b.tone !== 'info' && <Button variant="ghost" className="!py-1" onClick={() => nav('/sources')}>{t('sources.title')}</Button>}
              </div>
            ))}
          </div>
        )}
        <FocusSection focusKey="home-rows" className="space-y-10">
        {!!progress?.length && (
          <Row title={t('home.continue')} items={progress.map((p) => ({ key: `${p.playlistId}:${p.itemId}`, title: p.title, poster: p.poster, open: () => nav(p.kind === 'episode' ? `/play/episode/${p.playlistId}/${encodeURIComponent(p.itemId)}?s=${encodeURIComponent(p.seriesId ?? '')}` : `/play/movie/${p.playlistId}/${encodeURIComponent(p.itemId)}`) }))} testId="row-continue" />
        )}
        {!!favorites?.length && (
          <Row testId="row-favorites" title={t('home.favorites')} items={favorites.map((f) => ({ key: `${f.kind}:${f.playlistId}:${f.itemId}`, title: f.title, poster: f.poster, open: () => (f.kind === 'live' ? nav(`/live/${f.playlistId}/${f.itemId}`) : open({ kind: f.kind, playlistId: f.playlistId, id: f.itemId })) }))} />
        )}
        {recentMovies.length > 0 && <Row testId="row-recent-movies" title={t('home.recentMovies')} items={recentMovies.map((m) => toRow(m, () => open(m)))} />}
        {recentSeries.length > 0 && <Row title={t('home.recentSeries')} items={recentSeries.map((m) => toRow(m, () => open(m)))} />}
        </FocusSection>
      </FocusSection>
    </div>
  );
}

const toRow = (m: GridItem, open: () => void) => ({
  key: `${m.playlistId}:${m.id}`, title: m.title, poster: (m as VodItem).poster, year: (m as VodItem).year, rating: (m as VodItem).rating, open,
});

function Row({ title, items, testId }: { title: string; items: { key: string; title: string; poster?: string; year?: number; rating?: number; open: () => void }[]; testId?: string }) {
  return (
    <section data-testid={testId}>
      <SectionTitle>{title}</SectionTitle>
      <FocusSection className="no-scrollbar -mx-2 flex gap-4 overflow-x-auto px-2 py-3">
        {items.map((it) => (
          <div key={it.key} className="w-32 shrink-0 md:w-40 [html[data-layout=tv]_&]:w-44">
            <PosterCard item={it} onOpen={it.open} />
          </div>
        ))}
      </FocusSection>
    </section>
  );
}
