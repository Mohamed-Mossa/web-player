import { Delete, Lock, Pencil, Plus } from 'lucide-react';
import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { db, type Profile } from '../../db/db';
import { hashPin, verifyPin } from '../../lib/crypto';
import { useApp, useSession } from '../../state/app';
import { Focusable, FocusSection, TextField, setFocus } from '../../nav/focus';
import { Button, Modal } from '../../components/ui';

const COLORS = ['#7c5cff', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#a3e635', '#f97316'];

let ensuring: Promise<void> | null = null;
/** Creates the first profile once. Fixed id + shared promise make it safe under StrictMode double effects. */
export function ensureDefaultProfile(name: string) {
  ensuring ??= db.transaction('rw', db.profiles, async () => {
    if ((await db.profiles.count()) > 0) return;
    await db.profiles.put({ id: 'default', name, color: COLORS[0], order: 0, createdAt: Date.now() });
  });
  return ensuring;
}

export function useProfiles() {
  return useLiveQuery(() => db.profiles.orderBy('order').toArray(), []);
}

export function Avatar({ p, size = 'lg' }: { p: Pick<Profile, 'name' | 'color'>; size?: 'sm' | 'lg' }) {
  return (
    <span
      className={clsx('flex items-center justify-center rounded-2xl font-bold text-white', size === 'lg' ? 'size-24 text-4xl md:size-28' : 'size-8 rounded-lg text-sm')}
      style={{ background: `linear-gradient(140deg, ${p.color}, ${p.color}99)` }}
    >
      {p.name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

export function ProfilesPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const profiles = useProfiles();
  const setProfileId = useApp((s) => s.setProfileId);
  const setUnlocked = useSession((s) => s.setUnlocked);
  const [manage, setManage] = useState(params.get('manage') === '1');
  const [editing, setEditing] = useState<Profile | 'new' | null>(null);
  const [pinFor, setPinFor] = useState<Profile | null>(null);
  const loaded = !!profiles?.length;
  useEffect(() => {
    if (loaded) requestAnimationFrame(() => setFocus('profile-0'));
  }, [loaded]);

  const choose = (p: Profile) => {
    if (manage) return setEditing(p);
    if (p.pinHash) return setPinFor(p);
    setUnlocked(null);
    setProfileId(p.id);
    nav('/', { replace: true });
  };

  return (
    <div className="flex h-full flex-col items-center justify-center overflow-y-auto px-4 py-10">
      <FocusSection autoFocus className="flex flex-col items-center">
        <h1 className="mb-10 text-3xl font-bold tracking-tight">{manage ? t('profiles.manage') : t('profiles.who')}</h1>
        <div className="flex flex-wrap justify-center gap-6">
          {profiles?.map((p, i) => (
            <Focusable key={p.id} focusKey={`profile-${i}`} onSelect={() => choose(p)} grow testId="profile" className="flex w-32 flex-col items-center gap-3 rounded-2xl p-2">
              <span className="relative">
                <Avatar p={p} />
                {manage && <span className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/50"><Pencil className="size-6" /></span>}
                {!manage && p.pinHash && <Lock className="absolute -bottom-1 -end-1 size-5 rounded-full bg-surface p-1 text-muted" />}
              </span>
              <span className="truncate text-sm font-medium">{p.name}</span>
            </Focusable>
          ))}
          <Focusable onSelect={() => setEditing('new')} grow testId="add-profile" className="flex w-32 flex-col items-center gap-3 rounded-2xl p-2">
            <span className="flex size-24 items-center justify-center rounded-2xl border-2 border-dashed border-line text-muted md:size-28"><Plus className="size-8" /></span>
            <span className="text-sm text-muted">{t('profiles.add')}</span>
          </Focusable>
        </div>
        <Button className="mt-10" variant="ghost" testId="manage-profiles" onClick={() => setManage(!manage)}>
          {manage ? t('common.done') : t('profiles.manage')}
        </Button>
      </FocusSection>
      {editing && <ProfileEditor profile={editing === 'new' ? null : editing} count={profiles?.length ?? 0} onClose={() => setEditing(null)} />}
      {pinFor && (
        <PinDialog
          title={t('profiles.enterPin', { name: pinFor.name })}
          onClose={() => setPinFor(null)}
          onPin={async (pin) => {
            if (!(await verifyPin(pin, pinFor.pinHash!, pinFor.pinSalt!))) return false;
            setUnlocked(pinFor.id);
            setProfileId(pinFor.id);
            setPinFor(null);
            nav('/', { replace: true });
            return true;
          }}
        />
      )}
    </div>
  );
}

function ProfileEditor({ profile, count, onClose }: { profile: Profile | null; count: number; onClose: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(profile?.name ?? '');
  const [color, setColor] = useState(profile?.color ?? COLORS[count % COLORS.length]);
  const [pin, setPin] = useState('');
  const [removePin, setRemovePin] = useState(false);
  const save = async () => {
    if (!name.trim()) return;
    const base: Profile = profile ?? { id: crypto.randomUUID(), name: '', color, order: count, createdAt: Date.now() };
    const next: Profile = { ...base, name: name.trim(), color };
    if (/^\d{4}$/.test(pin)) {
      const h = await hashPin(pin);
      next.pinHash = h.hash;
      next.pinSalt = h.salt;
    } else if (removePin) {
      delete next.pinHash;
      delete next.pinSalt;
    }
    await db.profiles.put(next);
    onClose();
  };
  return (
    <Modal open onClose={onClose} title={profile ? t('profiles.edit') : t('profiles.add')}>
      <div className="space-y-4">
        <TextField label={t('profiles.name')} value={name} onChange={setName} autoFocus testId="profile-name" />
        <div className="flex flex-wrap gap-2">
          {COLORS.map((c) => (
            <Focusable key={c} onSelect={() => setColor(c)} ariaLabel={c} className={clsx('size-8 rounded-full', color === c && 'ring-2 ring-white ring-offset-2 ring-offset-surface')}>
              <span className="block size-full rounded-full" style={{ background: c }} />
            </Focusable>
          ))}
        </div>
        <TextField label={t('profiles.pin')} value={pin} onChange={(v) => setPin(v.replace(/\D/g, '').slice(0, 4))} type="password" inputMode="numeric" dir="ltr" testId="profile-pin" />
        {profile?.pinHash && (
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={removePin} onChange={(e) => setRemovePin(e.target.checked)} /> {t('profiles.removePin')}
          </label>
        )}
      </div>
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        {profile && count > 1 && (
          <Button variant="danger" onClick={async () => {
            await db.profiles.delete(profile.id);
            await db.favorites.where('profileId').equals(profile.id).delete();
            if (useApp.getState().profileId === profile.id) useApp.getState().setProfileId(null);
            onClose();
          }}>{t('common.delete')}</Button>
        )}
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" testId="profile-save" onClick={save}>{t('common.save')}</Button>
      </div>
    </Modal>
  );
}

/** PIN entry usable with the remote's number keys or an on-screen pad. */
export function PinDialog({ title, onPin, onClose }: { title: string; onPin: (pin: string) => Promise<boolean>; onClose: () => void }) {
  const { t } = useTranslation();
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const press = async (d: string) => {
    setError(false);
    const next = (pin + d).slice(0, 4);
    setPin(next);
    if (next.length === 4) {
      const ok = await onPin(next);
      if (!ok) {
        setError(true);
        setPin('');
      }
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });
  return (
    <Modal open onClose={onClose} title={title} testId="pin-dialog">
      <div className="mb-5 flex justify-center gap-3" dir="ltr">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={clsx('size-4 rounded-full', i < pin.length ? 'bg-accent' : 'bg-line')} />
        ))}
      </div>
      {error && <p className="mb-3 text-center text-sm text-bad" role="alert">{t('profiles.wrongPin')}</p>}
      <div className="mx-auto grid w-60 grid-cols-3 gap-2" dir="ltr">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((d, i) =>
          d === '' ? <span key={i} /> : (
            <Focusable key={i} onSelect={() => (d === '⌫' ? setPin((p) => p.slice(0, -1)) : press(d))} className="rounded-xl bg-surface-2 py-3 text-lg font-semibold hover:bg-line">
              {d === '⌫' ? <Delete className="mx-auto size-5" /> : d}
            </Focusable>
          ),
        )}
      </div>
    </Modal>
  );
}
