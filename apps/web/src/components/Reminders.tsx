import { BellRing, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { db, type Reminder } from '../db/db';
import { isNative } from '../lib/platform';
import { useApp } from '../state/app';
import { Button } from './ui';

/** Checks reminders every 20 s; shows an in-app card (and a system notification when allowed) when a programme starts. */
export function ReminderWatcher() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const profileId = useApp((s) => s.profileId);
  const [due, setDue] = useState<Reminder[]>([]);

  useEffect(() => {
    if (!profileId) return;
    const check = async () => {
      const now = Date.now();
      const rows = await db.reminders.where('profileId').equals(profileId).filter((r) => !r.notified && r.start <= now + 60_000 && r.stop > now).toArray();
      if (!rows.length) return;
      const fired: Reminder[] = [];
      for (const r of rows) {
        // claim it atomically so a second check (StrictMode, another tab) does not notify twice
        const claimed = await db.reminders.where('id').equals(r.id).filter((x) => !x.notified).modify({ notified: true });
        if (!claimed) continue;
        fired.push(r);
        if (!isNative() && 'Notification' in window && Notification.permission === 'granted') {
          try {
            new Notification(r.title, { body: t('live.startsNow', { ch: r.channelName }), tag: r.id });
          } catch {
            /* some browsers only allow notifications from a service worker */
          }
        }
      }
      if (fired.length) setDue((d) => [...d, ...fired.filter((r) => !d.some((x) => x.id === r.id))]);
    };
    check();
    const iv = setInterval(check, 20_000);
    return () => clearInterval(iv);
  }, [profileId, t]);

  if (!due.length) return null;
  return (
    <div className="fixed end-4 bottom-4 z-[90] space-y-2" data-testid="reminder-toasts">
      {due.map((r) => (
        <div key={r.id} className="flex w-80 items-start gap-3 rounded-2xl border border-line bg-surface p-4 shadow-2xl">
          <BellRing className="mt-0.5 size-5 shrink-0 text-warn" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{r.title}</p>
            <p className="text-sm text-muted">{t('live.startsNow', { ch: r.channelName })}</p>
            <Button className="mt-3" variant="primary" onClick={() => { setDue((d) => d.filter((x) => x.id !== r.id)); nav(`/live/${r.playlistId}/${r.channelId}`); }}>{t('live.watch')}</Button>
          </div>
          <button onClick={() => setDue((d) => d.filter((x) => x.id !== r.id))} className="text-muted" aria-label="close"><X className="size-4" /></button>
        </div>
      ))}
    </div>
  );
}
