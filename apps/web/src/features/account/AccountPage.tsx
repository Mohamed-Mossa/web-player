import { CheckCircle2, Cloud, LogOut, Monitor, Smartphone, Trash2, Tv } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { approveDeviceLogin, loadDevices, removeDevice, sendMagicLink, signIn, signOut, signUp, startDeviceLogin, useDevices, waitForDeviceLogin } from '../../cloud/auth';
import { cloudEnabled } from '../../cloud/supabase';
import { syncNow, useCloudSync } from '../../cloud/sync';
import { APP_URL } from '../../env';
import { useLayout } from '../../lib/platform';
import { FocusSection, TextField } from '../../nav/focus';
import { useAuth } from '../../state/auth';
import { Button, Chip, Empty, Spinner } from '../../components/ui';

export function AccountPage() {
  const { t } = useTranslation();
  const userId = useAuth((s) => s.userId);
  if (!cloudEnabled) return <Empty title={t('account.notConfigured')} icon={<Cloud className="size-10" />} />;
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <FocusSection autoFocus className="mx-auto max-w-xl space-y-8 px-4 py-6 md:py-10">
        <h1 className="text-2xl font-bold tracking-tight">{t('account.title')}</h1>
        {userId ? <SignedIn /> : <SignInForms />}
      </FocusSection>
    </div>
  );
}

function SignInForms() {
  const { t } = useTranslation();
  const layout = useLayout();
  const [mode, setMode] = useState<'tv' | 'password' | 'magic'>(layout === 'tv' ? 'tv' : 'password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, okMsg?: string) => {
    setBusy(true);
    setMsg('');
    try {
      await fn();
      if (okMsg) setMsg(okMsg);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">{t('account.why')}</p>
      <div className="flex flex-wrap gap-2">
        <Chip active={mode === 'tv'} onClick={() => setMode('tv')} testId="mode-tv">{t('account.withPhone')}</Chip>
        <Chip active={mode === 'password'} onClick={() => setMode('password')}>{t('account.withPassword')}</Chip>
        <Chip active={mode === 'magic'} onClick={() => setMode('magic')}>{t('account.withLink')}</Chip>
      </div>
      {mode === 'tv' && <DeviceCodeLogin />}
      {mode !== 'tv' && (
        <div className="space-y-4">
          <TextField label={t('account.email')} value={email} onChange={setEmail} dir="ltr" inputMode="url" testId="acc-email" />
          {mode === 'password' && <TextField label={t('sources.password')} value={password} onChange={setPassword} type="password" dir="ltr" testId="acc-password" />}
          <div className="flex flex-wrap gap-2">
            {mode === 'password' ? (
              <>
                <Button variant="primary" disabled={busy} onClick={() => run(() => signIn(email, password))}>{t('account.signIn')}</Button>
                <Button disabled={busy} onClick={() => run(async () => { const confirm = await signUp(email, password); if (confirm) setMsg(t('account.checkEmail')); })}>{t('account.signUp')}</Button>
              </>
            ) : (
              <Button variant="primary" disabled={busy} onClick={() => run(() => sendMagicLink(email), t('account.checkEmail'))}>{t('account.sendLink')}</Button>
            )}
          </div>
        </div>
      )}
      {msg && <p className="rounded-xl bg-surface-2 p-3 text-sm" role="status">{msg}</p>}
    </div>
  );
}

/** TV: show a code + QR; a signed-in phone approves it on /link. */
function DeviceCodeLogin() {
  const { t } = useTranslation();
  const [code, setCode] = useState<{ code: string; secret: string } | null>(null);
  const [qr, setQr] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const c = await startDeviceLogin();
        setCode(c);
        setQr(await QRCode.toDataURL(`${APP_URL}/link?code=${c.code}`, { margin: 1, width: 280, color: { dark: '#0b0d12', light: '#ffffff' } }));
        await waitForDeviceLogin(c.code, c.secret, ctrl.signal);
      } catch (e) {
        if (!ctrl.signal.aborted) setError((e as Error).message);
      }
    })();
    return () => ctrl.abort();
  }, []);
  if (error) return <p className="text-sm text-bad">{error}</p>;
  if (!code) return <Spinner />;
  return (
    <div className="flex flex-col items-center gap-5 rounded-2xl bg-surface p-6 text-center md:flex-row md:text-start">
      {qr && <img src={qr} alt="QR" className="size-56 rounded-xl" data-testid="login-qr" />}
      <div className="space-y-3">
        <p>{t('account.scanQr')}</p>
        <p className="text-sm text-muted" dir="ltr">{APP_URL.replace(/^https?:\/\//, '')}/link</p>
        <p className="text-4xl font-bold tracking-[0.3em] tabular-nums" dir="ltr" data-testid="login-code">{code.code}</p>
        <p className="flex items-center gap-2 text-sm text-muted"><Spinner className="size-4" />{t('account.waiting')}</p>
      </div>
    </div>
  );
}

function SignedIn() {
  const { t, i18n } = useTranslation();
  const email = useAuth((s) => s.email);
  const denied = useAuth((s) => s.proxyDenied);
  const sync = useCloudSync();
  const devices = useDevices();
  useEffect(() => {
    void loadDevices();
  }, []);
  const icon = (k: string) => (k === 'tv' ? <Tv className="size-5" /> : k === 'desktop' ? <Monitor className="size-5" /> : <Smartphone className="size-5" />);
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-5">
        <CheckCircle2 className="size-6 text-good" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold" dir="ltr">{email}</p>
          <p className="text-sm text-muted" data-testid="sync-status">
            {sync.status === 'syncing' ? t('account.syncing') : sync.status === 'error' ? `${t('account.syncError')}: ${sync.error}` : sync.lastSync ? t('account.synced', { t: new Date(sync.lastSync).toLocaleTimeString(i18n.language) }) : ''}
          </p>
        </div>
        <Button onClick={() => void syncNow()}>{t('common.refresh')}</Button>
      </div>
      {denied && <p className="rounded-xl bg-warn/10 p-3 text-sm text-warn">{t('account.proxyDenied')}</p>}
      <div>
        <p className="mb-2 text-sm text-muted">{t('account.devices')}</p>
        <div className="space-y-1.5">
          {devices.list.map((d) => (
            <div key={d.id} className="flex items-center gap-3 rounded-xl bg-surface px-4 py-3">
              <span className="text-accent-2">{icon(d.kind)}</span>
              <span className="flex-1 truncate">{d.name}{d.id === devices.selfId && <span className="ms-2 text-xs text-muted">({t('account.thisDevice')})</span>}</span>
              {d.id !== devices.selfId && <Button variant="ghost" icon={<Trash2 className="size-4" />} title={t('common.delete')} onClick={() => removeDevice(d.id)} />}
            </div>
          ))}
        </div>
      </div>
      <Button variant="danger" icon={<LogOut className="size-4" />} onClick={() => void signOut()}>{t('account.signOut')}</Button>
    </div>
  );
}

/** Phone side of TV sign-in: /link?code=XXXXXX */
export function LinkPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const userId = useAuth((s) => s.userId);
  const [code, setCode] = useState(params.get('code') ?? '');
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [err, setErr] = useState('');
  if (!userId) {
    return (
      <div className="scroll-thin h-full overflow-y-auto">
        <FocusSection autoFocus className="mx-auto max-w-xl space-y-6 px-4 py-6">
          <h1 className="text-2xl font-bold">{t('account.linkTitle')}</h1>
          <p className="text-muted">{t('account.linkSignInFirst')}</p>
          <SignInForms />
        </FocusSection>
      </div>
    );
  }
  return (
    <FocusSection autoFocus className="mx-auto max-w-md space-y-5 px-4 py-10 text-center">
      <h1 className="text-2xl font-bold">{t('account.linkTitle')}</h1>
      {state === 'done' ? (
        <p className="flex items-center justify-center gap-2 text-good"><CheckCircle2 className="size-5" />{t('account.linked')}</p>
      ) : (
        <>
          <TextField value={code} onChange={(v) => setCode(v.toUpperCase())} dir="ltr" testId="link-code" />
          <Button variant="primary" disabled={state === 'busy' || code.length < 6} onClick={async () => {
            setState('busy');
            try {
              await approveDeviceLogin(code);
              setState('done');
            } catch (e) {
              setErr((e as Error).message);
              setState('error');
            }
          }}>{t('account.approve')}</Button>
          {state === 'error' && <p className="text-sm text-bad">{err}</p>}
        </>
      )}
    </FocusSection>
  );
}
