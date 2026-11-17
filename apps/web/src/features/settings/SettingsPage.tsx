import { ChevronRight, ListVideo, Users } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { APP_VERSION, BUILD_TIME, GIT_SHA } from '../../env';
import { usePwa } from '../../lib/pwa';
import { isNative } from '../../lib/platform';
import { useApp } from '../../state/app';
import { Focusable, FocusSection, TextField } from '../../nav/focus';
import { Button, Chip } from '../../components/ui';

export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  const s = useApp();
  const pwa = usePwa();
  const [proxy, setProxy] = useState(s.proxyBase);

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <FocusSection autoFocus className="mx-auto max-w-2xl space-y-8 px-4 py-6 md:py-10">
        <h1 className="text-2xl font-bold tracking-tight">{t('settings.title')}</h1>

        <Group title={t('settings.language')}>
          <Chip testId="lang-en" active={s.lang === 'en'} onClick={() => s.setLang('en')}>English</Chip>
          <Chip testId="lang-ar" active={s.lang === 'ar'} onClick={() => s.setLang('ar')}>العربية</Chip>
        </Group>

        <Group title={t('settings.layout')}>
          <Chip active={s.layoutOverride === null} onClick={() => s.setLayoutOverride(null)}>{t('settings.layoutAuto')}</Chip>
          <Chip active={s.layoutOverride === 'tv'} onClick={() => s.setLayoutOverride('tv')}>{t('settings.layoutTv')}</Chip>
          <Chip active={s.layoutOverride === 'desktop'} onClick={() => s.setLayoutOverride('desktop')}>{t('settings.layoutDesktop')}</Chip>
          <Chip active={s.layoutOverride === 'mobile'} onClick={() => s.setLayoutOverride('mobile')}>{t('settings.layoutMobile')}</Chip>
        </Group>

        <div className="space-y-4 rounded-2xl border border-line bg-surface p-5">
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">{t('settings.playback')}</p>
          <Group title={t('settings.buffer')}>
            {[10, 30, 60, 120].map((b) => (
              <Chip key={b} testId={`buffer-${b}`} active={s.bufferSec === b} onClick={() => s.set({ bufferSec: b })}>{t('settings.bufferValue', { s: b })}</Chip>
            ))}
          </Group>
          <Group title={t('settings.autoplayNext')}>
            <Chip active={s.autoplayNext} onClick={() => s.set({ autoplayNext: true })}>{t('common.yes')}</Chip>
            <Chip active={!s.autoplayNext} onClick={() => s.set({ autoplayNext: false })}>{t('common.no')}</Chip>
          </Group>
          <Group title={t('settings.prefAudio')}>
            <Chip active={s.prefAudio === 'auto'} onClick={() => s.set({ prefAudio: 'auto' })}>{t('settings.original')}</Chip>
            <Chip active={s.prefAudio === 'ar'} onClick={() => s.set({ prefAudio: 'ar' })}>{t('settings.arabic')}</Chip>
            <Chip active={s.prefAudio === 'en'} onClick={() => s.set({ prefAudio: 'en' })}>{t('settings.english')}</Chip>
          </Group>
          {isNative() && (
            <Group title={t('settings.afr')}>
              <Chip active={s.afr} onClick={() => s.set({ afr: true })}>{t('common.yes')}</Chip>
              <Chip active={!s.afr} onClick={() => s.set({ afr: false })}>{t('common.no')}</Chip>
            </Group>
          )}
          <Group title={t('settings.prefSubs')}>
            <Chip active={s.prefSubs === 'off'} onClick={() => s.set({ prefSubs: 'off' })}>{t('player.off')}</Chip>
            <Chip active={s.prefSubs === 'ar'} onClick={() => s.set({ prefSubs: 'ar' })}>{t('settings.arabic')}</Chip>
            <Chip active={s.prefSubs === 'en'} onClick={() => s.set({ prefSubs: 'en' })}>{t('settings.english')}</Chip>
          </Group>
        </div>

        <Group title={t('settings.refresh')}>
          {[6, 12, 24, 48].map((h) => (
            <Chip key={h} active={s.refreshHours === h} onClick={() => s.setRefreshHours(h)}>{t('settings.hours', { count: h })}</Chip>
          ))}
        </Group>

        {!isNative() && (
          <div>
            <TextField label={t('settings.proxy')} value={proxy} onChange={setProxy} onSubmit={() => s.setProxyBase(proxy)} placeholder="https://iptv-proxy.example.workers.dev" dir="ltr" inputMode="url" />
            <p className="mt-1.5 text-xs text-muted">{t('settings.proxyHint')}</p>
            {proxy !== s.proxyBase && <Button className="mt-3" variant="primary" onClick={() => s.setProxyBase(proxy)}>{t('common.save')}</Button>}
          </div>
        )}

        <div className="space-y-2">
          <LinkRow icon={<ListVideo className="size-5" />} label={t('settings.playlists')} onClick={() => nav('/sources')} testId="link-playlists" />
          <LinkRow icon={<Users className="size-5" />} label={t('settings.profiles')} onClick={() => nav('/profiles?manage=1')} testId="link-profiles" />
        </div>

        <div className="rounded-2xl border border-line bg-surface p-5 text-sm">
          <p className="mb-3 text-xs font-semibold tracking-wide text-muted uppercase">{t('settings.about')}</p>
          <p data-testid="app-version">{t('settings.version')}: <span className="font-semibold" dir="ltr">{APP_VERSION} ({GIT_SHA})</span></p>
          <p className="mt-1 text-muted">{t('settings.build')}: <span dir="ltr">{new Date(BUILD_TIME).toLocaleString(i18n.language)}</span></p>
          {pwa.needRefresh && (
            <div className="mt-4 flex items-center gap-3">
              <span className="text-accent-2">{t('settings.updateReady')}</span>
              <Button variant="primary" onClick={() => pwa.update?.()}>{t('settings.reload')}</Button>
            </div>
          )}
        </div>
      </FocusSection>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-sm text-muted">{title}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function LinkRow({ icon, label, onClick, testId }: { icon: React.ReactNode; label: string; onClick: () => void; testId?: string }) {
  return (
    <Focusable onSelect={onClick} testId={testId} className="flex w-full items-center gap-3 rounded-xl bg-surface p-4 text-start hover:bg-surface-2">
      <span className="text-accent-2">{icon}</span>
      <span className="flex-1 font-medium">{label}</span>
      <ChevronRight className="size-5 text-muted rtl:rotate-180" />
    </Focusable>
  );
}
