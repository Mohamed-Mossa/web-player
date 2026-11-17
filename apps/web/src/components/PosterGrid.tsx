import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { GridItem } from '../data/catalog';
import { useLayout } from '../lib/platform';
import { FocusSection } from '../nav/focus';
import { ChannelTile, PosterCard } from './cards';

const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

/**
 * Virtualized grid: only visible rows (+3 overscan, so D-pad Down always has a mounted target)
 * are rendered, which keeps 50k items at a few dozen DOM nodes.
 */
export function PosterGrid({ items, onOpen, kind }: { items: GridItem[]; onOpen: (it: GridItem) => void; kind: 'movie' | 'series' | 'live' }) {
  const layout = useLayout();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = scrollRef.current!;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const rem = remPx();
  const gap = (layout === 'mobile' ? 0.75 : 1.25) * rem;
  const pad = (layout === 'mobile' ? 0.75 : 1.5) * rem;
  const minCard = (kind === 'live' ? (layout === 'mobile' ? 8.5 : 11) : layout === 'tv' ? 9.5 : layout === 'mobile' ? 6.6 : 9.5) * rem;
  const inner = Math.max(0, width - pad * 2);
  const cols = Math.max(2, Math.floor((inner + gap) / (minCard + gap)));
  const cardW = (inner - gap * (cols - 1)) / cols;
  const rowH = kind === 'live' ? cardW * 0.62 + 2.4 * rem : cardW * 1.5 + 2.9 * rem;
  const rows = Math.ceil(items.length / cols);

  const v = useVirtualizer({
    count: rows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowH + gap,
    overscan: 3,
    paddingStart: pad,
    paddingEnd: pad,
  });

  useEffect(() => {
    v.measure();
  }, [rowH, gap, v]);

  // Back to top when the list itself changes (category, sort, filter).
  const sig = useMemo(() => `${items.length}:${items[0]?.id}:${items[items.length - 1]?.id}`, [items]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [sig]);

  return (
    <div ref={scrollRef} className="scroll-thin h-full overflow-y-auto overflow-x-hidden" data-testid="poster-grid">
      <FocusSection focusKey={`grid-${kind}`} className="relative w-full" testId="grid-focus">
        <div style={{ height: v.getTotalSize(), position: 'relative' }}>
          {v.getVirtualItems().map((row) => (
            <div
              key={row.key}
              className="absolute flex"
              style={{ top: row.start, insetInlineStart: pad, insetInlineEnd: pad, height: rowH, gap }}
            >
              {Array.from({ length: cols }, (_, c) => {
                const idx = row.index * cols + c;
                const it = items[idx];
                if (!it) return <div key={c} style={{ width: cardW }} />;
                const onFocused = () => v.scrollToIndex(row.index, { align: 'auto' });
                return (
                  <div key={`${it.playlistId}:${it.id}`} style={{ width: cardW }} className="h-full">
                    {it.kind === 'live' ? (
                      <ChannelTile item={it as GridItem & { kind: 'live' }} onOpen={() => onOpen(it)} focusKey={`card-${kind}-${idx}`} onFocused={onFocused} testId="card" />
                    ) : (
                      <PosterCard item={it} onOpen={() => onOpen(it)} focusKey={`card-${kind}-${idx}`} onFocused={onFocused} testId="card" />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </FocusSection>
    </div>
  );
}
