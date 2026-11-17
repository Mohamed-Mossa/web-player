import { MonitorUp, Tv } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { loadDevices, sendCommand, useDevices, type RemoteCommand } from '../cloud/auth';
import { useAuth } from '../state/auth';
import { Focusable } from '../nav/focus';
import { Button, Modal } from './ui';

/** "Send to TV": pick another signed-in device and start this title there. */
export function SendToDevice({ command, label }: { command: RemoteCommand; label?: string }) {
  const { t } = useTranslation();
  const userId = useAuth((s) => s.userId);
  const { list, selfId } = useDevices();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  useEffect(() => {
    if (open) void loadDevices();
  }, [open]);
  const others = list.filter((d) => d.id !== selfId).sort((a, b) => Number(b.kind === 'tv') - Number(a.kind === 'tv'));
  if (!userId) return null;
  return (
    <>
      <Button icon={<MonitorUp className="size-4" />} onClick={() => setOpen(true)} testId="send-to-device">{label ?? t('remote.sendTo')}</Button>
      <Modal open={open} onClose={() => { setOpen(false); setSent(null); }} title={t('remote.sendTo')}>
        {others.length === 0 && <p className="text-sm text-muted">{t('remote.noDevices')}</p>}
        <div className="space-y-1.5">
          {others.map((d) => (
            <Focusable key={d.id} onSelect={async () => { await sendCommand(d.id, command); setSent(d.name); }} className="flex w-full items-center gap-3 rounded-xl bg-surface-2 px-4 py-3 text-start hover:bg-line">
              <Tv className="size-5 text-accent-2" />
              <span className="flex-1">{d.name}</span>
            </Focusable>
          ))}
        </div>
        {sent && <p className="mt-4 text-sm text-good" role="status">{t('remote.sent', { d: sent })}</p>}
      </Modal>
    </>
  );
}
