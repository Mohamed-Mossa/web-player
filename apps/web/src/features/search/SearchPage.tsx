import { Mic, Tv } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { isNative } from '../../lib/platform';
import { nativeInfo, voiceSearch } from '../../native/bridge';
import { Button } from '../../components/ui';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useSearch, type SearchHit } from '../../data/search';
import { Focusable, FocusSection, TextField } from '../../nav/focus';
import { Empty, Img, SectionTitle, Spinner } from '../../components/ui';
import { PosterCard } from '../../components/cards';

export function SearchPage() {
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [params, setParams] = useSearchParams();
  const { hits, building } = useSearch(q);
  const canVoice = isNative() && nativeInfo.voice;
  const listen = () => voiceSearch(i18n.language === 'ar' ? 'ar' : 'en').then((text) => text && setQ(text)).catch(() => {});
  // the remote's microphone button opens /search?voice=1
  useEffect(() => {
    if (params.get('voice') === '1' && canVoice) {
      setParams({}, { replace: true });
      void listen();
    }
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = {
    movie: hits.filter((h) => h.kind === 'movie').slice(0, 40),
    series: hits.filter((h) => h.kind === 'series').slice(0, 40),
    live: hits.filter((h) => h.kind === 'live').slice(0, 30),
  };
  const open = (h: SearchHit) => nav(h.kind === 'live' ? `/live/${h.playlistId}/${h.itemId}` : `/${h.kind}/${h.playlistId}/${encodeURIComponent(h.itemId)}`);

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <FocusSection className="mx-auto max-w-7xl px-4 py-6 md:px-10 md:py-10">
        <div className="flex max-w-2xl items-end gap-2">
          <div className="flex-1">
            <TextField value={q} onChange={setQ} placeholder={t('search.placeholder')} autoFocus testId="search-input" dir="auto" />
          </div>
          {canVoice && <Button title={t('search.voice')} icon={<Mic className="size-5" />} onClick={listen} className="!py-3" />}
        </div>
        {building && <p className="mt-6 inline-flex items-center gap-2 text-sm text-muted"><Spinner className="size-4" />{t('search.building')}</p>}
        {!q.trim() && !building && <Empty title={t('search.empty')} />}
        {q.trim() && !building && hits.length === 0 && <Empty title={t('search.none', { q })} />}
        <div className="mt-8 space-y-10" data-testid="search-results">
          {(['movie', 'series'] as const).map((k) =>
            groups[k].length ? (
              <section key={k}>
                <SectionTitle>{k === 'movie' ? t('nav.movies') : t('nav.series')}</SectionTitle>
                <FocusSection className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-4 md:grid-cols-[repeat(auto-fill,minmax(9rem,1fr))]">
                  {groups[k].map((h) => <PosterCard key={h.key} item={h} onOpen={() => open(h)} testId={`hit-${k}`} />)}
                </FocusSection>
              </section>
            ) : null,
          )}
          {groups.live.length > 0 && (
            <section>
              <SectionTitle>{t('nav.live')}</SectionTitle>
              <FocusSection className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {groups.live.map((h) => (
                  <Focusable key={h.key} onSelect={() => open(h)} testId="hit-live" className="flex items-center gap-3 rounded-xl bg-surface p-2.5 text-start hover:bg-surface-2">
                    <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-2">
                      <Img src={h.poster} alt={h.title} className="max-h-full max-w-full object-contain" fallback={<Tv className="size-5 text-muted" />} />
                    </div>
                    <span className="w-8 text-sm text-muted tabular-nums">{h.num}</span>
                    <span className="truncate text-sm font-medium">{h.title}</span>
                  </Focusable>
                ))}
              </FocusSection>
            </section>
          )}
        </div>
      </FocusSection>
    </div>
  );
}
