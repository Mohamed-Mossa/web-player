import { AlertTriangle, Plus, RefreshCw, Server, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { XtreamError, credsFromM3UUrl } from '@iptv/core';
import { usePlaylists } from '../../data/catalog';
import { addPlaylist, daysLeft, removePlaylist } from '../../data/playlists';
import type { Playlist } from '../../db/db';
import { useSync, syncPlaylist, checkAccount } from '../../sync/catalogSync';
import { FocusSection, TextField } from '../../nav/focus';
import { Button, Chip, Modal, Spinner } from '../../components/ui';

export function SourcesPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const playlists = usePlaylists();
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <FocusSection autoFocus className="mx-auto max-w-4xl px-4 py-6 md:px-8 md:py-10">
        <div className="mb-6 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{t('sources.title')}</h1>
          <Button variant="primary" testId="add-playlist" icon={<Plus className="size-4" />} onClick={() => nav('/sources/add')}>
            {t('sources.add')}
          </Button>
        </div>
        <div className="space-y-4">
          {playlists?.map((p) => <PlaylistCard key={p.id} p={p} />)}
        </div>
      </FocusSection>
    </div>
  );
}

function fmtDate(ms: number | null | undefined, lang: string) {
  if (!ms) return '—';
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-GB', { dateStyle: 'medium' }).format(ms);
}
function fmtAgo(ms: number | undefined, lang: string) {
  if (!ms) return null;
  // Intl.RelativeTimeFormat arrived in Chromium 71 (Samsung 2020 TVs have 69)
  if (typeof Intl.RelativeTimeFormat !== 'function') return new Date(ms).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB');
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  const mins = Math.round((ms - Date.now()) / 60000);
  if (Math.abs(mins) < 60) return rtf.format(mins, 'minute');
  const h = Math.round(mins / 60);
  if (Math.abs(h) < 48) return rtf.format(h, 'hour');
  return rtf.format(Math.round(h / 24), 'day');
}

function PlaylistCard({ p }: { p: Playlist }) {
  const { t, i18n } = useTranslation();
  const sync = useSync((s) => s.byId[p.id]);
  const [confirm, setConfirm] = useState(false);
  const left = daysLeft(p.account);
  const a = p.account;
  const errorKey = sync?.error?.code ?? p.syncError;
  return (
    <div className="rounded-2xl border border-line bg-surface p-5" data-testid="playlist-card">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex size-11 items-center justify-center rounded-xl bg-accent/15 text-accent-2"><Server className="size-5" /></div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-semibold" data-testid="playlist-name">{p.name}</p>
          <p className="text-sm text-muted" dir="ltr">{p.type === 'xtream' ? 'Xtream' : 'M3U'} · {p.hostHint}</p>
        </div>
        {a && (
          <span className={clsx('rounded-full px-3 py-1 text-xs font-semibold', /active/i.test(a.status) ? 'bg-good/15 text-good' : 'bg-bad/15 text-bad')} data-testid="account-status">
            {a.status}{a.isTrial ? ` · ${t('sources.trial')}` : ''}
          </span>
        )}
      </div>

      {a && (
        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
          <Info label={t('sources.expires')} testId="expires">
            {a.expiresAt ? fmtDate(a.expiresAt, i18n.language) : t('common.unlimited')}
            {left !== null && left <= 7 && <span className="ms-1 text-warn">({left}d)</span>}
          </Info>
          <Info label={t('sources.connections')} testId="connections">{t('sources.connectionsValue', { active: a.activeConnections, max: a.maxConnections })}</Info>
          <Info label={t('sources.created')}>{fmtDate(a.createdAt, i18n.language)}</Info>
          <Info label={t('sources.ping')}>{p.pingMs ? `${p.pingMs} ms` : '—'}</Info>
        </dl>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line/60 pt-4 text-sm">
        {sync?.running ? (
          <span className="inline-flex items-center gap-2 text-accent-2" data-testid="sync-progress">
            <Spinner className="size-4" /> {t(`sources.step.${sync.step ?? 'categories'}`)}…
          </span>
        ) : errorKey ? (
          <span className="inline-flex items-center gap-2 text-bad" data-testid="sync-error"><AlertTriangle className="size-4" />{t(`sources.errors.${errorKey}`, { defaultValue: errorKey })}</span>
        ) : (
          <span className="text-muted" data-testid="sync-done">
            {p.counts && t('sources.counts', p.counts)}
            {p.lastSyncAt && <> · {t('sources.lastSync')}: {fmtAgo(p.lastSyncAt, i18n.language)}</>}
          </span>
        )}
        <div className="ms-auto flex gap-2">
          <Button testId="sync-now" disabled={sync?.running} icon={<RefreshCw className="size-4" />} onClick={() => { checkAccount(p.id); syncPlaylist(p.id).catch(() => {}); }}>
            {t('sources.syncNow')}
          </Button>
          <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setConfirm(true)} title={t('sources.remove')} />
        </div>
      </div>
      <Modal open={confirm} onClose={() => setConfirm(false)} title={t('sources.remove')}>
        <p className="text-sm text-muted">{t('sources.removeConfirm', { name: p.name })}</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button onClick={() => setConfirm(false)}>{t('common.cancel')}</Button>
          <Button variant="danger" onClick={async () => { setConfirm(false); await removePlaylist(p.id); }}>{t('common.delete')}</Button>
        </div>
      </Modal>
    </div>
  );
}

function Info({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 font-medium" data-testid={testId}>{children}</dd>
    </div>
  );
}

export function AddSourcePage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [type, setType] = useState<'xtream' | 'm3u'>('xtream');
  const [name, setName] = useState('');
  const [server, setServer] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [url, setUrl] = useState('');
  const [epgUrl, setEpgUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Pasting a full get.php link into "server" fills username/password.
  const onServer = (v: string) => {
    setServer(v);
    const c = credsFromM3UUrl(v.includes('://') ? v : `http://${v}`);
    if (c) {
      setUsername(c.username);
      setPassword(c.password);
    }
  };

  const submit = async () => {
    setError('');
    if (type === 'xtream' ? !server || !username || !password : !url) return setError(t('sources.errors.required'));
    setBusy(true);
    try {
      await addPlaylist(type === 'xtream' ? { type, name, server, username, password } : { type, name, url, epgUrl });
      nav('/sources', { replace: true });
    } catch (e) {
      const code = e instanceof XtreamError ? e.code : 'network';
      setError(t(`sources.errors.${code}`));
    } finally {
      setBusy(false);
    }
  };

  const detected = type === 'm3u' && url && credsFromM3UUrl(url);

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <FocusSection autoFocus preferredChildFocusKey="type-xtream" className="mx-auto max-w-xl px-4 py-6 md:py-12">
        <h1 className="mb-6 text-2xl font-bold tracking-tight">{t('sources.add')}</h1>
        <div className="mb-6 flex gap-2">
          <ChipKey k="type-xtream" active={type === 'xtream'} onClick={() => setType('xtream')}>{t('sources.xtream')}</ChipKey>
          <ChipKey k="type-m3u" active={type === 'm3u'} onClick={() => setType('m3u')}>{t('sources.m3u')}</ChipKey>
        </div>
        <div className="space-y-4">
          <TextField label={t('sources.name')} value={name} onChange={setName} testId="f-name" />
          {type === 'xtream' ? (
            <>
              <TextField label={t('sources.server')} value={server} onChange={onServer} placeholder="http://example.com:8080" dir="ltr" inputMode="url" testId="f-server" />
              <TextField label={t('sources.username')} value={username} onChange={setUsername} dir="ltr" testId="f-username" />
              <TextField label={t('sources.password')} value={password} onChange={setPassword} type="password" dir="ltr" testId="f-password" onSubmit={submit} />
            </>
          ) : (
            <>
              <TextField label={t('sources.m3uUrl')} value={url} onChange={setUrl} placeholder="https://…/playlist.m3u" dir="ltr" inputMode="url" testId="f-url" />
              {detected && <p className="rounded-xl bg-accent/10 p-3 text-sm text-accent-2">{t('sources.detectedXtream')}</p>}
              <TextField label={t('sources.epgUrl')} value={epgUrl} onChange={setEpgUrl} dir="ltr" inputMode="url" testId="f-epg" onSubmit={submit} />
            </>
          )}
        </div>
        {error && <p className="mt-4 rounded-xl bg-bad/10 p-3 text-sm text-bad" role="alert" data-testid="add-error">{error}</p>}
        <div className="mt-8 flex justify-end gap-2">
          <Button onClick={() => nav(-1)}>{t('common.cancel')}</Button>
          <Button variant="primary" testId="connect" disabled={busy} onClick={submit} icon={busy ? <Spinner className="size-4" /> : undefined}>
            {busy ? t('sources.connecting') : t('sources.connect')}
          </Button>
        </div>
      </FocusSection>
    </div>
  );
}

function ChipKey({ k, active, onClick, children }: { k: string; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <Chip active={active} onClick={onClick} testId={k} focusKey={k}>{children}</Chip>;
}
