import { getCurrentFocusKey } from '@noriginmedia/norigin-spatial-navigation';
import clsx from 'clsx';
import { AlertTriangle, Check, FileUp, Loader2, Minus, Plus, Search } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { decodeSubtitleBytes, parseSubtitles, type Cue } from '@iptv/core';
import { API_BASE } from '../../env';
import { fetchJson } from '../../lib/http';
import { Focusable, FocusSection, setFocus } from '../../nav/focus';
import { useApp, type SubtitleStyle } from '../../state/app';
import { useAuth } from '../../state/auth';
import { Button } from '../../components/ui';
import type { PlayerError, Track } from '../types';
import { fmtTime } from '../usePlayer';

const SIZE: Record<SubtitleStyle['size'], string> = { s: '1.6vw', m: '2.2vw', l: '2.9vw', xl: '3.6vw' };

export function SubtitleOverlay({ lines, controlsVisible }: { lines: string[]; controlsVisible: boolean }) {
  const st = useApp((s) => s.subtitle);
  if (!lines.length) return null;
  return (
    <div className={clsx('pointer-events-none absolute inset-x-0 z-10 flex flex-col items-center gap-1 px-[8%] text-center transition-[bottom]', controlsVisible ? 'bottom-[22%]' : 'bottom-[7%]')} data-testid="subtitles">
      {lines.map((l, i) => (
        <span
          key={i}
          dir="auto"
          className={clsx('whitespace-pre-line leading-snug font-semibold', st.background === 'box' && 'rounded-md bg-black/75 px-3 py-1')}
          style={{
            fontSize: `max(${SIZE[st.size]}, 15px)`,
            color: st.color,
            textShadow: st.background === 'shadow' ? '0 0 4px #000, 0 0 8px #000, 2px 2px 2px #000' : undefined,
          }}
        >
          {l}
        </span>
      ))}
    </div>
  );
}

export function ErrorOverlay({ error, onRetry, onBack }: { error: PlayerError; onRetry: () => void; onBack: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/80 p-6" data-testid="player-error">
      <FocusSection autoFocus boundary className="max-w-lg text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-warn" />
        <p className="mb-6 text-lg leading-relaxed" data-code={error.code}>{t(`player.errors.${error.code}`)}</p>
        <div className="flex justify-center gap-3">
          <Button variant="primary" onClick={onRetry} focusKey="err-retry">{t('common.retry')}</Button>
          <Button onClick={onBack}>{t('common.back')}</Button>
        </div>
      </FocusSection>
    </div>
  );
}

export function CtrlButton({ label, onClick, children, focusKey, active, testId }: { label: string; onClick: () => void; children: ReactNode; focusKey?: string; active?: boolean; testId?: string }) {
  return (
    <Focusable
      focusKey={focusKey}
      onSelect={onClick}
      title={label}
      ariaLabel={label}
      testId={testId}
      className={clsx('flex size-11 items-center justify-center rounded-full text-white/90 hover:bg-white/15 [html[data-layout=tv]_&]:size-14', active && 'text-accent-2')}
    >
      {children}
    </Focusable>
  );
}

/** Focusable seek bar: Left/Right seek ±10 s, Enter toggles play. */
export function SeekBar({ current, duration, buffered, onSeek, onToggle }: { current: number; duration: number; buffered: number; onSeek: (t: number) => void; onToggle: () => void }) {
  const pct = duration ? (current / duration) * 100 : 0;
  const bpct = duration ? (buffered / duration) * 100 : 0;
  return (
    <div className="flex items-center gap-3 text-sm text-white/85 tabular-nums" dir="ltr">
      <span className="w-14 text-end">{fmtTime(current)}</span>
      <Focusable
        focusKey="player-seek"
        testId="seekbar"
        ariaLabel="seek"
        onSelect={onToggle}
        onArrow={(d) => {
          if (d === 'left') onSeek(current - 10);
          else if (d === 'right') onSeek(current + 10);
          else return true;
          return false;
        }}
        className="group relative h-6 flex-1 rounded-full"
      >
        <div
          className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 cursor-pointer overflow-hidden rounded-full bg-white/20 group-data-[focused=true]:h-2.5"
          onClick={(e) => {
            const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
            onSeek(((e.clientX - r.left) / r.width) * duration);
          }}
        >
          <div className="absolute inset-y-0 start-0 bg-white/30" style={{ width: `${bpct}%` }} />
          <div className="absolute inset-y-0 start-0 bg-accent" style={{ width: `${pct}%` }} />
        </div>
        <div className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow group-data-[focused=true]:size-5" style={{ left: `${pct}%` }} />
      </Focusable>
      <span className="w-14">{fmtTime(duration)}</span>
    </div>
  );
}

/** Slide-in panel from the end side; traps focus; Back closes it. */
export function SidePanel({ title, onClose, children, testId }: { title: string; onClose: () => void; children: ReactNode; testId?: string }) {
  const prev = useRef<string | null>(getCurrentFocusKey());
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (['Escape', 'GoBack', 'BrowserBack', 'Backspace'].includes(e.key) && (e.target as HTMLElement).tagName !== 'INPUT') {
        e.stopImmediatePropagation();
        e.preventDefault();
        onClose();
      }
    };
    addEventListener('keydown', onKey, true);
    const back = prev.current;
    return () => {
      removeEventListener('keydown', onKey, true);
      if (back) requestAnimationFrame(() => setFocus(back));
    };
  }, [onClose]);
  return (
    <div className="absolute inset-0 z-40 flex justify-end bg-black/40" onClick={onClose}>
      <div className="scroll-thin h-full w-full max-w-sm overflow-y-auto border-s border-white/10 bg-surface/95 p-5 backdrop-blur" onClick={(e) => e.stopPropagation()} data-testid={testId}>
        <FocusSection autoFocus boundary>
          <h2 className="mb-4 text-lg font-semibold">{title}</h2>
          {children}
        </FocusSection>
      </div>
    </div>
  );
}

function Option({ label, active, onClick, testId }: { label: string; active: boolean; onClick: () => void; testId?: string }) {
  return (
    <Focusable onSelect={onClick} testId={testId} ariaPressed={active} className={clsx('flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-start text-sm', active ? 'bg-accent/20 text-white' : 'hover:bg-white/10')}>
      <Check className={clsx('size-4 shrink-0', !active && 'invisible')} />
      <span className="truncate">{label}</span>
    </Focusable>
  );
}

const Heading = ({ children }: { children: ReactNode }) => <p className="mt-5 mb-1.5 px-1 text-xs font-semibold tracking-wide text-muted uppercase first:mt-0">{children}</p>;

export interface ExternalSubs {
  name: string;
  cues: Cue[];
}

export function TracksPanel({
  tracks, onSelect, external, onExternal, subsOff, offset, setOffset, title, onClose,
}: {
  tracks: Track[];
  onSelect: (kind: Track['kind'], id: string | null) => void;
  external: ExternalSubs | null;
  onExternal: (s: ExternalSubs | null) => void;
  subsOff: boolean;
  offset: number;
  setOffset: (n: number) => void;
  title: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const st = useApp((s) => s.subtitle);
  const set = useApp((s) => s.set);
  const fileRef = useRef<HTMLInputElement>(null);
  const [online, setOnline] = useState(false);
  const audio = tracks.filter((x) => x.kind === 'audio');
  const text = tracks.filter((x) => x.kind === 'text');
  const video = tracks.filter((x) => x.kind === 'video');
  const embeddedActive = !external && text.some((x) => x.active);

  if (online) return <OnlineSubsPanel title={title} onClose={() => setOnline(false)} onPick={(s) => { onExternal(s); setOnline(false); }} />;

  return (
    <SidePanel title={t('player.tracks')} onClose={onClose} testId="tracks-panel">
      {audio.length > 0 && (
        <>
          <Heading>{t('player.audio')}</Heading>
          {audio.map((a) => <Option key={a.id} testId="audio-option" label={a.label} active={a.active} onClick={() => onSelect('audio', a.id)} />)}
        </>
      )}
      <Heading>{t('player.subtitles')}</Heading>
      <Option label={t('player.off')} active={subsOff || (!external && !embeddedActive)} testId="subs-off" onClick={() => { onExternal(null); onSelect('text', null); }} />
      {text.map((x) => <Option key={x.id} testId="text-option" label={x.label} active={!external && x.active} onClick={() => { onExternal(null); onSelect('text', x.id); }} />)}
      {external && <Option label={t('player.external', { name: external.name })} active onClick={() => {}} />}
      <Focusable onSelect={() => fileRef.current?.click()} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-start text-sm hover:bg-white/10">
        <FileUp className="size-4" /> {t('player.loadFile')}
      </Focusable>
      <input
        ref={fileRef}
        type="file"
        accept=".srt,.vtt,text/vtt,application/x-subrip"
        className="hidden"
        data-testid="subs-file"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const cues = parseSubtitles(decodeSubtitleBytes(await f.arrayBuffer()));
          onSelect('text', null);
          onExternal({ name: f.name, cues });
          e.target.value = '';
        }}
      />
      {API_BASE && (
        <Focusable onSelect={() => setOnline(true)} testId="subs-online" className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-start text-sm hover:bg-white/10">
          <Search className="size-4" /> {t('player.searchOnline')}
        </Focusable>
      )}

      <Heading>{t('player.size')}</Heading>
      <div className="flex gap-1.5">
        {(['s', 'm', 'l', 'xl'] as const).map((z) => <Chip2 key={z} active={st.size === z} onClick={() => set({ subtitle: { ...st, size: z } })}>{z.toUpperCase()}</Chip2>)}
      </div>
      <Heading>{t('player.color')}</Heading>
      <div className="flex gap-2">
        {['#ffffff', '#ffe14d', '#7df9ff', '#9dff9d'].map((c) => (
          <Focusable key={c} onSelect={() => set({ subtitle: { ...st, color: c } })} ariaLabel={c} className={clsx('size-8 rounded-full border-2', st.color === c ? 'border-accent' : 'border-transparent')}>
            <span className="block size-full rounded-full" style={{ background: c }} />
          </Focusable>
        ))}
      </div>
      <Heading>{t('player.background')}</Heading>
      <div className="flex gap-1.5">
        {(['none', 'shadow', 'box'] as const).map((b) => (
          <Chip2 key={b} active={st.background === b} onClick={() => set({ subtitle: { ...st, background: b } })}>
            {t(`player.bg${b[0].toUpperCase()}${b.slice(1)}`)}
          </Chip2>
        ))}
      </div>
      {external && (
        <>
          <Heading>{t('player.offset')}</Heading>
          <div className="flex items-center gap-3" dir="ltr">
            <Focusable onSelect={() => setOffset(+(offset - 0.5).toFixed(1))} testId="offset-minus" ariaLabel="-0.5" className="rounded-lg bg-white/10 p-2"><Minus className="size-4" /></Focusable>
            <span className="w-16 text-center tabular-nums" data-testid="offset-value">{t('player.offsetValue', { v: offset > 0 ? `+${offset}` : offset })}</span>
            <Focusable onSelect={() => setOffset(+(offset + 0.5).toFixed(1))} testId="offset-plus" ariaLabel="+0.5" className="rounded-lg bg-white/10 p-2"><Plus className="size-4" /></Focusable>
          </div>
        </>
      )}
      {video.length > 0 && (
        <>
          <Heading>{t('player.quality')}</Heading>
          {video.map((v) => <Option key={v.id} label={v.label} active={v.active} onClick={() => onSelect('video', v.id)} />)}
        </>
      )}
    </SidePanel>
  );
}

function Chip2({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Focusable onSelect={onClick} ariaPressed={active} className={clsx('rounded-lg px-3 py-1.5 text-sm', active ? 'bg-accent text-white' : 'bg-white/10')}>
      {children}
    </Focusable>
  );
}

interface OsHit {
  id: string;
  attributes: { language: string; release: string; download_count: number; files: { file_id: number; file_name: string }[] };
}

function OnlineSubsPanel({ title, onClose, onPick }: { title: string; onClose: () => void; onPick: (s: ExternalSubs) => void }) {
  const { t, i18n } = useTranslation();
  const [hits, setHits] = useState<OsHit[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const token = useAuth((s) => s.proxyToken);
  useEffect(() => {
    const q = new URLSearchParams({ query: title, languages: i18n.language === 'ar' ? 'ar,en' : 'en,ar', order_by: 'download_count' });
    if (token) q.set('t', token);
    fetchJson(`${API_BASE}/os/subtitles?${q}`, {}, 20_000)
      .then((r) => setHits(((r as { data?: OsHit[] })?.data ?? []).slice(0, 30)))
      .catch(() => setHits([]));
  }, [title, i18n.language, token]);
  const pick = async (h: OsHit) => {
    const f = h.attributes.files[0];
    if (!f) return;
    setBusy(f.file_id);
    try {
      const res = await fetch(`${API_BASE}/os/download${token ? `?t=${token}` : ''}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file_id: f.file_id }) });
      const cues = parseSubtitles(decodeSubtitleBytes(await res.arrayBuffer()));
      onPick({ name: `${h.attributes.language.toUpperCase()} · ${h.attributes.release}`, cues });
    } finally {
      setBusy(null);
    }
  };
  return (
    <SidePanel title={t('player.searchOnline')} onClose={onClose} testId="online-subs">
      {hits === null && <p className="flex items-center gap-2 text-sm text-muted"><Loader2 className="size-4 animate-spin" />{t('player.searching')}</p>}
      {hits?.length === 0 && <p className="text-sm text-muted">{t('player.noSubs')}</p>}
      {hits?.map((h) => (
        <Focusable key={h.id} onSelect={() => pick(h)} testId="os-hit" className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-start text-sm hover:bg-white/10">
          <span className="w-8 shrink-0 rounded bg-white/10 py-0.5 text-center text-xs font-semibold uppercase">{h.attributes.language}</span>
          <span className="min-w-0 flex-1 truncate" dir="ltr">{h.attributes.release}</span>
          {busy === h.attributes.files[0]?.file_id && <Loader2 className="size-4 animate-spin" />}
        </Focusable>
      ))}
    </SidePanel>
  );
}

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
export function SpeedPanel({ rate, onRate, onClose }: { rate: number; onRate: (r: number) => void; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <SidePanel title={t('player.speed')} onClose={onClose} testId="speed-panel">
      {SPEEDS.map((r) => <Option key={r} testId="speed-option" label={r === 1 ? t('player.normal') : `${r}×`} active={rate === r} onClick={() => { onRate(r); onClose(); }} />)}
    </SidePanel>
  );
}

export type SleepChoice = number | 'end' | null;
export function SleepPanel({ value, onPick, onClose }: { value: SleepChoice; onPick: (v: SleepChoice) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const opts: SleepChoice[] = [null, 15, 30, 60, 90, 'end'];
  return (
    <SidePanel title={t('player.sleep')} onClose={onClose} testId="sleep-panel">
      {opts.map((o) => (
        <Option
          key={String(o)}
          testId="sleep-option"
          label={o === null ? t('player.off') : o === 'end' ? t('player.sleepEnd') : t('common.minutes', { count: o })}
          active={value === o}
          onClick={() => { onPick(o); onClose(); }}
        />
      ))}
    </SidePanel>
  );
}

export function NextUpCard({ title, seconds, onPlay, onCancel }: { title: string; seconds: number; onPlay: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="absolute end-6 bottom-28 z-30 w-80 rounded-2xl border border-white/10 bg-surface/95 p-4 shadow-2xl" data-testid="next-up">
      <FocusSection autoFocus boundary preferredChildFocusKey="next-play">
        <p className="text-xs font-semibold tracking-wide text-muted uppercase">{t('player.upNext')}</p>
        <p className="mt-1 truncate font-semibold">{title}</p>
        <p className="mt-1 text-sm text-accent-2" data-testid="next-countdown">{t('player.playingIn', { s: seconds })}</p>
        <div className="mt-3 flex gap-2">
          <Button variant="primary" focusKey="next-play" onClick={onPlay}>{t('player.playNow')}</Button>
          <Button onClick={onCancel}>{t('player.cancel')}</Button>
        </div>
      </FocusSection>
    </div>
  );
}

export function ResumeDialog({ at, onResume, onRestart }: { at: number; onResume: () => void; onRestart: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70" data-testid="resume-dialog">
      <FocusSection autoFocus boundary preferredChildFocusKey="resume-yes" className="w-full max-w-sm rounded-2xl bg-surface p-6 text-center">
        <p className="mb-5 text-lg font-semibold">{t('player.resumeTitle')}</p>
        <div className="flex flex-col gap-2">
          <Button variant="primary" focusKey="resume-yes" testId="resume-yes" onClick={onResume}>{t('player.resumeFrom', { t: fmtTime(at) })}</Button>
          <Button testId="resume-no" onClick={onRestart}>{t('player.startOver')}</Button>
        </div>
      </FocusSection>
    </div>
  );
}
