import { Star, Tv } from 'lucide-react';
import type { FocusableComponentLayout } from '@noriginmedia/norigin-spatial-navigation';
import { Focusable } from '../nav/focus';
import { Img, PosterFallback } from './ui';
import type { GridItem } from '../data/catalog';

export function PosterCard({
  item, onOpen, focusKey, onFocused, width, testId,
}: {
  item: { title: string; poster?: string; year?: number; rating?: number; alternates?: unknown[] };
  onOpen: () => void;
  focusKey?: string;
  onFocused?: (layout: FocusableComponentLayout) => void;
  width?: number | string;
  testId?: string;
}) {
  return (
    <Focusable
      focusKey={focusKey}
      onSelect={onOpen}
      onFocused={(l) => onFocused?.(l)}
      grow
      testId={testId}
      ariaLabel={item.title}
      className="group flex w-full flex-col rounded-xl text-start"
    >
      <div className="relative w-full overflow-hidden rounded-xl bg-surface-2" style={{ aspectRatio: '2 / 3', width }}>
        <Img
          src={item.poster}
          alt={item.title}
          className="absolute inset-0 size-full object-cover"
          fallback={<PosterFallback title={item.title} className="absolute inset-0" />}
        />
        {!!item.rating && (
          <span className="absolute top-1.5 end-1.5 inline-flex items-center gap-0.5 rounded-md bg-black/65 px-1.5 py-0.5 text-[0.7rem] font-semibold text-white">
            <Star className="size-3 fill-warn text-warn" />
            {item.rating.toFixed(1)}
          </span>
        )}
        {!!item.alternates?.length && (
          <span className="absolute bottom-1.5 start-1.5 rounded-md bg-accent/90 px-1.5 py-0.5 text-[0.7rem] font-semibold text-white">
            +{item.alternates.length}
          </span>
        )}
      </div>
      <div className="mt-2 w-full px-0.5">
        <p className="truncate text-sm font-medium text-text">{item.title}</p>
        <p className="text-xs text-muted">{item.year ?? ' '}</p>
      </div>
    </Focusable>
  );
}

export function ChannelTile({
  item, onOpen, focusKey, onFocused, testId,
}: {
  item: GridItem & { kind: 'live' };
  onOpen: () => void;
  focusKey?: string;
  onFocused?: (layout: FocusableComponentLayout) => void;
  testId?: string;
}) {
  return (
    <Focusable
      focusKey={focusKey}
      onSelect={onOpen}
      onFocused={(l) => onFocused?.(l)}
      grow
      testId={testId}
      ariaLabel={item.title}
      className="flex h-full w-full flex-col overflow-hidden rounded-xl bg-surface text-start"
    >
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-surface-2 p-3">
        <Img
          src={item.logo}
          alt={item.title}
          className="max-h-full max-w-full object-contain"
          fallback={<Tv className="size-8 text-muted" />}
        />
        <span className="absolute top-1.5 start-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[0.7rem] font-semibold tabular-nums text-white">
          {item.num}
        </span>
        {item.archiveDays > 0 && (
          <span className="absolute top-1.5 end-1.5 rounded-md bg-accent/80 px-1.5 py-0.5 text-[0.65rem] font-semibold text-white">
            ⟲ {item.archiveDays}d
          </span>
        )}
      </div>
      <p className="shrink-0 truncate px-2.5 py-2 text-sm font-medium">{item.title}</p>
    </Focusable>
  );
}
