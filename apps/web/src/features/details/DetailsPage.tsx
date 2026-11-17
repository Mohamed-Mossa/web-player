import { Clock, Heart, Play, Star, Clapperboard } from 'lucide-react';
import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { matchKey, type SeriesItem, type VodItem } from '@iptv/core';
import { useCatalog, usePlaylists, type GridItem } from '../../data/catalog';
import { toggleFavorite, useIsFavorite, useItem, useSeriesDetail } from '../../data/items';
import { tmdbImg, useTmdb } from '../../data/tmdb';
import { useApp } from '../../state/app';
import { Focusable, FocusSection } from '../../nav/focus';
import { Button, Chip, Empty, Img, PosterFallback, SectionTitle, Spinner } from '../../components/ui';
import { PosterCard } from '../../components/cards';

export function DetailsPage({ kind }: { kind: 'movie' | 'series' }) {
  const { playlistId = '', id: rawId = '' } = useParams();
  const id = decodeURIComponent(rawId);
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  const profileId = useApp((s) => s.profileId);
  const item = useItem(kind, playlistId, id) as VodItem | SeriesItem | null | undefined;
  const fav = useIsFavorite(profileId, kind, playlistId, id);
  const playlists = usePlaylists();
  const { data: catalog } = useCatalog(kind);
  const [notice, setNotice] = useState('');

  const tm = useTmdb(
    item ? { type: kind === 'movie' ? 'movie' : 'tv', title: item.title, year: item.year, tmdbId: item.tmdbId, lang: i18n.language, full: true } : null,
  ).data;

  const merged = catalog?.find((c) => c.playlistId === playlistId && c.id === id);
  const local = useMemo(() => {
    const m = new Map<string, GridItem>();
    for (const c of catalog ?? []) m.set(matchKey(c.title, undefined), c);
    return m;
  }, [catalog]);

  if (item === undefined) return <div className="flex h-full items-center justify-center"><Spinner className="size-8" /></div>;
  if (item === null) return <Empty title={t('details.notFound')}><Button onClick={() => nav(-1)}>{t('common.back')}</Button></Empty>;

  const poster = item.poster ?? tmdbImg(tm?.poster, 'w342');
  const backdrop = tmdbImg(tm?.backdrop, 'w1280');
  const overview = tm?.overview ?? (item as SeriesItem).plot;
  const genres = item.genres.length ? item.genres : tm?.genres ?? [];
  const rating = item.rating ?? tm?.rating;
  const year = item.year ?? tm?.year;

  const similar = (tm?.similar ?? []).map((s) => ({ ...s, local: local.get(matchKey(s.title, undefined)) }));
  similar.sort((a, b) => Number(!!b.local) - Number(!!a.local));

  return (
    <div className="scroll-thin relative h-full overflow-y-auto">
      {backdrop && (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[70vh]">
          <img src={backdrop} alt="" className="size-full object-cover opacity-35" />
          <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/70 to-bg/20" />
          <div className="absolute inset-0 bg-gradient-to-r rtl:bg-gradient-to-l from-bg/90 to-transparent" />
        </div>
      )}
      <FocusSection autoFocus preferredChildFocusKey="details-play" className="relative z-10 mx-auto max-w-6xl px-4 pt-6 pb-16 md:px-10 md:pt-14">
        <div className="flex flex-col gap-6 md:flex-row md:gap-10">
          <div className="mx-auto w-40 shrink-0 md:mx-0 md:w-60">
            <div className="overflow-hidden rounded-2xl shadow-2xl" style={{ aspectRatio: '2/3' }}>
              <Img src={poster} alt={item.title} className="size-full object-cover" fallback={<PosterFallback title={item.title} className="size-full" />} />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold tracking-tight md:text-4xl" data-testid="details-title">{item.title}</h1>
            {tm?.title && tm.title !== item.title && <p className="mt-1 text-muted">{tm.title}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
              {year && <span>{year}</span>}
              {!!rating && (
                <span className="inline-flex items-center gap-1"><Star className="size-4 fill-warn text-warn" />{rating.toFixed(1)}</span>
              )}
              {tm?.runtime && kind === 'movie' && (
                <span className="inline-flex items-center gap-1"><Clock className="size-4" />{t('common.minutes', { count: tm.runtime })}</span>
              )}
              {(item as VodItem).ext && <span className="rounded border border-line px-1.5 text-xs uppercase">{(item as VodItem).ext}</span>}
            </div>
            {genres.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {genres.slice(0, 5).map((g) => <span key={g} className="rounded-full bg-surface-2 px-3 py-1 text-xs">{g}</span>)}
              </div>
            )}
            <div className="mt-6 flex flex-wrap gap-2">
              <Button variant="primary" focusKey="details-play" testId="play" icon={<Play className="size-4 fill-current" />} onClick={() => setNotice(t('common.comingPhase', { n: 2 }))}>
                {t('details.play')}
              </Button>
              {tm?.trailerKey && (
                <Button icon={<Clapperboard className="size-4" />} onClick={() => window.open(`https://www.youtube.com/watch?v=${tm.trailerKey}`, '_blank', 'noopener')}>
                  {t('details.trailer')}
                </Button>
              )}
              {profileId && (
                <Button
                  testId="favorite"
                  icon={<Heart className={clsx('size-4', fav && 'fill-bad text-bad')} />}
                  onClick={() => toggleFavorite({ profileId, kind, playlistId, itemId: id, title: item.title, poster })}
                >
                  {fav ? t('details.unfavorite') : t('details.favorite')}
                </Button>
              )}
            </div>
            {notice && <p className="mt-3 text-sm text-warn" role="status">{notice}</p>}
            {overview && <p className="mt-6 max-w-3xl leading-relaxed text-text/85">{overview}</p>}
            {merged && merged.alternates.length > 0 && (
              <p className="mt-4 text-sm text-muted">
                {t('details.alsoIn')}:{' '}
                {merged.alternates.map((a) => playlists?.find((p) => p.id === a.playlistId)?.name).filter(Boolean).join('، ')}
              </p>
            )}
          </div>
        </div>

        {kind === 'series' && <SeasonsBlock playlistId={playlistId} seriesId={id} />}

        {!!tm?.cast.length && (
          <section className="mt-12">
            <SectionTitle>{t('details.cast')}</SectionTitle>
            <div className="no-scrollbar -mx-1 flex gap-4 overflow-x-auto px-1 pb-2">
              {tm.cast.map((c) => (
                <div key={c.name + c.character} className="w-24 shrink-0 text-center">
                  <div className="mx-auto size-20 overflow-hidden rounded-full bg-surface-2">
                    <Img src={tmdbImg(c.photo, 'w185')} alt={c.name} className="size-full object-cover" />
                  </div>
                  <p className="mt-2 truncate text-xs font-medium">{c.name}</p>
                  {c.character && <p className="truncate text-[0.7rem] text-muted">{c.character}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {similar.length > 0 && (
          <section className="mt-10">
            <SectionTitle>{t('details.similar')}</SectionTitle>
            <FocusSection className="no-scrollbar -mx-2 flex gap-4 overflow-x-auto px-2 py-3">
              {similar.map((s) => (
                <div key={s.id} className="w-32 shrink-0 md:w-36">
                  <PosterCard
                    item={{ title: s.local?.title ?? s.title, poster: (s.local as { poster?: string } | undefined)?.poster ?? tmdbImg(s.poster, 'w342') }}
                    onOpen={() => s.local && nav(`/${kind}/${s.local.playlistId}/${encodeURIComponent(s.local.id)}`)}
                  />
                  {s.local && <p className="mt-0.5 text-[0.7rem] font-semibold text-good">{t('details.inLibrary')}</p>}
                </div>
              ))}
            </FocusSection>
          </section>
        )}
      </FocusSection>
    </div>
  );
}

function SeasonsBlock({ playlistId, seriesId }: { playlistId: string; seriesId: string }) {
  const { t } = useTranslation();
  const { data, isLoading, error, refetch } = useSeriesDetail(playlistId, seriesId);
  const [season, setSeason] = useState<number | null>(null);
  if (isLoading) return <div className="mt-10"><Spinner /></div>;
  if (error) return <div className="mt-10"><Button onClick={() => refetch()}>{t('common.retry')}</Button></div>;
  if (!data?.seasons.length) return null;
  const current = data.seasons.find((s) => s.season === season) ?? data.seasons[0];
  return (
    <section className="mt-12" data-testid="seasons">
      <SectionTitle>{t('details.episodes')}</SectionTitle>
      <FocusSection className="no-scrollbar mb-4 flex gap-1.5 overflow-x-auto">
        {data.seasons.map((s) => (
          <Chip key={s.season} active={s.season === current.season} onClick={() => setSeason(s.season)} testId="season-chip">
            {t('details.season', { n: s.season })}
          </Chip>
        ))}
      </FocusSection>
      <FocusSection className="grid gap-2 md:grid-cols-2">
        {current.episodes.map((e) => (
          <Focusable key={e.id} testId="episode" className="flex items-center gap-4 rounded-xl bg-surface p-3 text-start hover:bg-surface-2">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-sm font-semibold tabular-nums">{e.episode}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{e.title}</p>
              {e.durationSec && <p className="text-xs text-muted">{t('common.minutes', { count: Math.round(e.durationSec / 60) })}</p>}
            </div>
          </Focusable>
        ))}
      </FocusSection>
    </section>
  );
}
