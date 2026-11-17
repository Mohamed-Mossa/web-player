import { Heart, Tv } from 'lucide-react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import type { LiveItem } from '@iptv/core';
import { toggleFavorite, useIsFavorite, useItem } from '../../data/items';
import { useApp } from '../../state/app';
import { FocusSection } from '../../nav/focus';
import { Button, Img, Spinner } from '../../components/ui';

/** Placeholder until the player (phase 2) and the live TV screen (phase 4) land. */
export function LiveChannelPage() {
  const { playlistId = '', id = '' } = useParams();
  const { t } = useTranslation();
  const profileId = useApp((s) => s.profileId);
  const ch = useItem('live', playlistId, id) as LiveItem | null | undefined;
  const fav = useIsFavorite(profileId, 'live', playlistId, id);
  if (!ch) return <div className="flex h-full items-center justify-center"><Spinner className="size-8" /></div>;
  return (
    <FocusSection autoFocus className="flex h-full flex-col items-center justify-center gap-6 p-6 text-center">
      <div className="flex size-40 items-center justify-center rounded-3xl bg-surface p-6">
        <Img src={ch.logo} alt={ch.title} className="max-h-full max-w-full object-contain" fallback={<Tv className="size-16 text-muted" />} />
      </div>
      <div>
        <p className="text-sm text-muted tabular-nums">#{ch.num}</p>
        <h1 className="text-3xl font-bold">{ch.title}</h1>
      </div>
      <p className="text-warn">{t('common.comingPhase', { n: 2 })}</p>
      {profileId && (
        <Button icon={<Heart className={clsx('size-4', fav && 'fill-bad text-bad')} />} onClick={() => toggleFavorite({ profileId, kind: 'live', playlistId, itemId: id, title: ch.title, poster: ch.logo })}>
          {fav ? t('details.unfavorite') : t('details.favorite')}
        </Button>
      )}
    </FocusSection>
  );
}
