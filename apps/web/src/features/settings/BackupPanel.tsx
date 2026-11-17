import { Download, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BadPassphrase, download, exportBackup, importBackup } from '../../cloud/backup';
import { TextField } from '../../nav/focus';
import { Button, Modal } from '../../components/ui';

export function BackupPanel() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'export' | 'import' | null>(null);
  const [pass, setPass] = useState('');
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<string | null>(null);

  const run = async () => {
    setMsg('');
    if (pass.length < 6) return setMsg(t('backup.passTooShort'));
    try {
      if (mode === 'export') {
        download(await exportBackup(pass), `iptv-backup-${new Date().toISOString().slice(0, 10)}.json`);
        setMsg(t('backup.exported'));
      } else if (file) {
        const r = await importBackup(file, pass);
        setMsg(t('backup.imported', { n: r.playlists }));
      }
    } catch (e) {
      setMsg(e instanceof BadPassphrase ? t('backup.wrongPass') : (e as Error).message);
    }
  };

  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <p className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">{t('backup.title')}</p>
      <p className="mb-4 text-sm text-muted">{t('backup.hint')}</p>
      <div className="flex flex-wrap gap-2">
        <Button icon={<Download className="size-4" />} testId="backup-export" onClick={() => { setMode('export'); setPass(''); setMsg(''); }}>{t('backup.export')}</Button>
        <Button icon={<Upload className="size-4" />} testId="backup-import" onClick={() => fileRef.current?.click()}>{t('backup.import')}</Button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" data-testid="backup-file" onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setFile(await f.text());
          setMode('import');
          setPass('');
          setMsg('');
          e.target.value = '';
        }} />
      </div>
      <Modal open={mode !== null} onClose={() => setMode(null)} title={mode === 'export' ? t('backup.export') : t('backup.import')}>
        <TextField label={t('backup.passphrase')} value={pass} onChange={setPass} type="password" autoFocus testId="backup-pass" onSubmit={run} />
        {msg && <p className="mt-3 text-sm" role="status" data-testid="backup-msg">{msg}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => setMode(null)}>{t('common.close')}</Button>
          <Button variant="primary" testId="backup-go" onClick={run}>{mode === 'export' ? t('backup.export') : t('backup.import')}</Button>
        </div>
      </Modal>
    </div>
  );
}
