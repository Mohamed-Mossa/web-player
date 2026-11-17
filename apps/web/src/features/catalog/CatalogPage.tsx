import { ArrowDown, ArrowUp, Eye, EyeOff, Pencil, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import clsx from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { Kind } from '@iptv/core';
import {
  applyView, moveCategory, topGenres, updateCategoryPref, useCatalog, useCategories, usePlaylists,
  type CategoryEntry, type GridItem,
} from '../../data/catalog';
import { useApp, type SortKey } from '../../state/app';
import { useLayout } from '../../lib/platform';
import { Focusable, FocusSection, TextField, setFocus } from '../../nav/focus';
import { Button, Chip, Empty, Modal, Spinner } from '../../components/ui';
import { PosterGrid } from '../../components/PosterGrid';
import { NoPlaylists } from '../home/HomePage';

const DECADES = [2020, 2010, 2000, 1990, 0];
const RATINGS = [6, 7, 8];

export function CatalogPage({ kind }: { kind: Kind }) {
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  const layout = useLayout();
  const profileId = useApp((s) => s.profileId);
  const view = useApp((s) => s.views[kind]);
  const setView = useApp((s) => s.setView);
  const playlists = usePlaylists();
  const { data: items, isLoading } = useCatalog(kind);
  const cats = useCategories(kind, profileId);
  const [managing, setManaging] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const visible = useMemo(
    () => (items ? applyView(items, view, cats, i18n.language) : []),
    [items, view, cats, i18n.language],
  );
  // Land in the grid on first load so the remote works immediately.
  const focusedOnce = useRef(false);
  const hasItems = visible.length > 0;
  useEffect(() => {
    if (focusedOnce.current || layout === 'mobile') return;
    if (hasItems) {
      focusedOnce.current = true;
      requestAnimationFrame(() => setFocus(`grid-${kind}`));
    }
  }, [hasItems, kind, layout]);
  const genres = useMemo(() => (items && kind !== 'live' ? topGenres(items) : []), [items, kind]);

  if (playlists && playlists.length === 0) return <NoPlaylists />;

  const open = (it: GridItem) => {
    if (it.kind === 'live') nav(`/live/${it.playlistId}/${it.id}`);
    else nav(`/${it.kind}/${it.playlistId}/${encodeURIComponent(it.id)}`);
  };

  const sorts: { key: SortKey; label: string }[] =
    kind === 'live'
      ? [{ key: 'added', label: '#' }, { key: 'name', label: t('catalog.sortName') }]
      : [
          { key: 'added', label: t('catalog.sortAdded') },
          { key: 'name', label: t('catalog.sortName') },
          { key: 'year', label: t('catalog.sortYear') },
          { key: 'rating', label: t('catalog.sortRating') },
        ];
  const activeFilters = (view.genre ? 1 : 0) + (view.decade !== null ? 1 : 0) + (view.minRating ? 1 : 0);
  const mobile = layout === 'mobile';

  const filterBody = (
    <div className="space-y-4">
      {genres.length > 0 && (
        <FilterRow label={t('catalog.genre')}>
          <Chip active={!view.genre} onClick={() => setView(kind, { genre: null })}>{t('common.any')}</Chip>
          {genres.map((g) => (
            <Chip key={g} active={view.genre === g} onClick={() => setView(kind, { genre: g })}>{g}</Chip>
          ))}
        </FilterRow>
      )}
      <FilterRow label={t('catalog.year')}>
        <Chip active={view.decade === null} onClick={() => setView(kind, { decade: null })}>{t('common.any')}</Chip>
        {DECADES.map((d) => (
          <Chip key={d} testId={`decade-${d}`} active={view.decade === d} onClick={() => setView(kind, { decade: d })}>
            {d === 0 ? t('catalog.older') : `${d}s`}
          </Chip>
        ))}
      </FilterRow>
      <FilterRow label={t('catalog.rating')}>
        <Chip active={!view.minRating} onClick={() => setView(kind, { minRating: null })}>{t('common.any')}</Chip>
        {RATINGS.map((r) => (
          <Chip key={r} active={view.minRating === r} onClick={() => setView(kind, { minRating: r })}>★ {t('catalog.ratingMin', { n: r })}</Chip>
        ))}
      </FilterRow>
    </div>
  );

  return (
    <div className="flex h-full min-h-0">
      {!mobile && (
        <CategorySidebar kind={kind} cats={cats} managing={managing} setManaging={setManaging} />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <FocusSection focusKey={`toolbar-${kind}`} className="space-y-3 border-b border-line/60 px-3 pt-3 pb-3 md:px-6 md:pt-5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="me-2 text-xl font-bold tracking-tight md:text-2xl">
              {kind === 'movie' ? t('nav.movies') : kind === 'series' ? t('nav.series') : t('nav.live')}
            </h1>
            <span className="text-sm text-muted" data-testid="result-count">
              {kind === 'live' ? t('catalog.channels', { count: visible.length }) : t('catalog.items', { count: visible.length })}
            </span>
            <div className="ms-auto flex flex-wrap items-center gap-1.5">
              {sorts.map((s) => (
                <Chip key={s.key} testId={`sort-${s.key}`} active={view.sort === s.key} onClick={() => setView(kind, { sort: s.key })}>
                  {s.label}
                </Chip>
              ))}
              {kind !== 'live' && (
                <Button
                  variant="ghost"
                  testId="filters-toggle"
                  onClick={() => setFiltersOpen((o) => !o)}
                  icon={<SlidersHorizontal className="size-4" />}
                >
                  {t('catalog.filters')}
                  {activeFilters > 0 && <span className="rounded-full bg-accent px-1.5 text-xs text-white">{activeFilters}</span>}
                </Button>
              )}
              {activeFilters > 0 && (
                <Button variant="ghost" onClick={() => setView(kind, { genre: null, decade: null, minRating: null })} icon={<X className="size-4" />}>
                  {t('catalog.clear')}
                </Button>
              )}
            </div>
          </div>
          {mobile && cats && (
            <div className="no-scrollbar -mx-3 flex gap-1.5 overflow-x-auto px-3">
              <Chip active={!view.categoryId} onClick={() => setView(kind, { categoryId: null })}>{t('catalog.allCategories')}</Chip>
              {cats.filter((c) => !c.hidden).map((c) => (
                <Chip key={c.key} active={view.categoryId === c.key} onClick={() => setView(kind, { categoryId: c.key })}>{c.label}</Chip>
              ))}
            </div>
          )}
          {filtersOpen && !mobile && kind !== 'live' && filterBody}
        </FocusSection>
        <div className="min-h-0 flex-1">
          {isLoading || !items ? (
            <div className="flex h-full items-center justify-center"><Spinner className="size-8" /></div>
          ) : visible.length === 0 ? (
            <Empty title={items.length ? t('catalog.noResults') : t('catalog.empty')} />
          ) : (
            <PosterGrid items={visible} onOpen={open} kind={kind} />
          )}
        </div>
      </div>
      {mobile && (
        <Modal open={filtersOpen} onClose={() => setFiltersOpen(false)} title={t('catalog.filters')}>
          {filterBody}
          <div className="mt-5 flex justify-end">
            <Button variant="primary" onClick={() => setFiltersOpen(false)}>{t('common.done')}</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="me-2 w-16 shrink-0 text-xs font-semibold tracking-wide text-muted uppercase">{label}</span>
      {children}
    </div>
  );
}

function CategorySidebar({
  kind, cats, managing, setManaging,
}: { kind: Kind; cats: CategoryEntry[] | undefined; managing: boolean; setManaging: (b: boolean) => void }) {
  const { t } = useTranslation();
  const profileId = useApp((s) => s.profileId)!;
  const view = useApp((s) => s.views[kind]);
  const setView = useApp((s) => s.setView);
  const [renaming, setRenaming] = useState<CategoryEntry | null>(null);
  const [name, setName] = useState('');
  const list = managing ? cats ?? [] : (cats ?? []).filter((c) => !c.hidden);

  return (
    <aside className="flex w-64 shrink-0 flex-col border-e border-line/60 bg-surface/40 xl:w-72" data-testid="category-sidebar">
      <FocusSection focusKey={`cats-${kind}`} className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-4 pt-5 pb-2">
          <span className="text-xs font-semibold tracking-wide text-muted uppercase">{t('catalog.categories')}</span>
          <Button variant="ghost" className="!px-2.5 !py-1 text-xs" testId="manage-categories" onClick={() => setManaging(!managing)}>
            {managing ? t('catalog.doneManaging') : t('catalog.manage')}
          </Button>
        </div>
        <div className="scroll-thin min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
          {!managing && (
            <CatButton active={!view.categoryId} label={t('catalog.allCategories')} onClick={() => setView(kind, { categoryId: null })} />
          )}
          {list.map((c, i) =>
            managing ? (
              <div key={c.key} className={clsx('flex items-center gap-1 rounded-lg px-1 py-0.5', c.hidden && 'opacity-50')} data-testid="manage-row">
                <span className="min-w-0 flex-1 truncate px-2 text-sm">{c.label}</span>
                <IconBtn title={c.hidden ? t('catalog.show') : t('catalog.hide')} testId="toggle-hidden" onClick={() => updateCategoryPref(profileId, kind, c, { hidden: !c.hidden })}>
                  {c.hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </IconBtn>
                <IconBtn title={t('catalog.rename')} testId="rename" onClick={() => { setRenaming(c); setName(c.label.split(' · ')[0]); }}>
                  <Pencil className="size-4" />
                </IconBtn>
                <IconBtn title={t('catalog.moveUp')} testId="move-up" onClick={() => moveCategory(profileId, kind, list, i, -1)}>
                  <ArrowUp className="size-4" />
                </IconBtn>
                <IconBtn title={t('catalog.moveDown')} testId="move-down" onClick={() => moveCategory(profileId, kind, list, i, 1)}>
                  <ArrowDown className="size-4" />
                </IconBtn>
              </div>
            ) : (
              <CatButton key={c.key} active={view.categoryId === c.key} label={c.label} onClick={() => setView(kind, { categoryId: c.key })} />
            ),
          )}
        </div>
      </FocusSection>
      <Modal open={!!renaming} onClose={() => setRenaming(null)} title={t('catalog.rename')}>
        <TextField value={name} onChange={setName} autoFocus testId="rename-input" onSubmit={async () => {
          if (renaming) await updateCategoryPref(profileId, kind, renaming, { customName: name.trim() || undefined });
          setRenaming(null);
        }} />
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {renaming && renaming.originalName !== renaming.label && (
            <Button variant="ghost" icon={<RotateCcw className="size-4" />} onClick={async () => {
              await updateCategoryPref(profileId, kind, renaming, { customName: undefined });
              setRenaming(null);
            }}>{t('catalog.reset')}</Button>
          )}
          <Button onClick={() => setRenaming(null)}>{t('common.cancel')}</Button>
          <Button variant="primary" testId="rename-save" onClick={async () => {
            if (renaming) await updateCategoryPref(profileId, kind, renaming, { customName: name.trim() || undefined });
            setRenaming(null);
          }}>{t('common.save')}</Button>
        </div>
      </Modal>
    </aside>
  );
}

function CatButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <Focusable
      onSelect={onClick}
      testId="category"
      ariaPressed={active}
      className={clsx(
        'block w-full truncate rounded-lg px-3 py-2 text-start text-sm',
        active ? 'bg-accent/15 font-semibold text-accent-2' : 'text-text/85 hover:bg-surface-2',
      )}
    >
      {label}
    </Focusable>
  );
}

function IconBtn({ children, onClick, title, testId }: { children: React.ReactNode; onClick: () => void; title: string; testId?: string }) {
  return (
    <Focusable onSelect={onClick} title={title} ariaLabel={title} testId={testId} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-text">
      {children}
    </Focusable>
  );
}
