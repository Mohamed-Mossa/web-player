import clsx from 'clsx';
import { AlertTriangle, ArrowLeft, Plus, Volume2, VolumeX, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { LiveItem } from '@iptv/core';
import { usePlaylists } from '../../data/catalog';
import { chKey, useAllChannels } from '../../data/live';
import { Focusable, FocusSection, TextField } from '../../nav/focus';
import { Button, Chip, Modal } from '../../components/ui';
import { resolveStream } from '../../player/resolve';
import { WebPlayer } from '../../player/webPlayer';
import { normalizeText } from '@iptv/core';

/** Desktop multi-view: 2–4 live channels at once; audio follows the selected tile. */
export function MultiView() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const playlists = usePlaylists();
  const all = useAllChannels();
  const [count, setCount] = useState(4);
  const [slots, setSlots] = useState<(LiveItem | null)[]>([null, null, null, null]);
  const [audio, setAudio] = useState(0);
  const [picking, setPicking] = useState<number | null>(null);

  const maxConn = useMemo(() => {
    const m = (playlists ?? []).map((p) => p.account?.maxConnections).filter((x): x is number => !!x);
    return m.length ? Math.max(...m) : null;
  }, [playlists]);
  const used = slots.slice(0, count).filter(Boolean).length;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black" data-testid="multiview">
      <FocusSection focusKey="mv-top" className="flex items-center gap-3 border-b border-white/10 px-4 py-2">
        <Button variant="ghost" icon={<ArrowLeft className="size-4 rtl:rotate-180" />} onClick={() => nav(-1)}>{t('common.back')}</Button>
        <span className="font-semibold text-white">{t('live.multiview')}</span>
        <div className="ms-4 flex gap-1.5">
          {[2, 3, 4].map((n) => <Chip key={n} testId={`mv-${n}`} active={count === n} onClick={() => setCount(n)}>{n}</Chip>)}
        </div>
        {maxConn !== null && used > maxConn && (
          <span className="ms-auto flex items-center gap-2 text-sm text-warn" data-testid="mv-warning">
            <AlertTriangle className="size-4" />{t('live.maxConnWarn', { n: maxConn })}
          </span>
        )}
      </FocusSection>
      <div className={clsx('grid min-h-0 flex-1 gap-1 p-1', count === 2 ? 'grid-cols-2' : 'grid-cols-2 grid-rows-2')}>
        {Array.from({ length: count }, (_, i) => (
          <Tile
            key={i}
            channel={slots[i]}
            muted={audio !== i}
            onAudio={() => setAudio(i)}
            onPick={() => setPicking(i)}
            onClear={() => setSlots((s) => s.map((x, j) => (j === i ? null : x)))}
            className={count === 3 && i === 0 ? 'row-span-2' : ''}
          />
        ))}
      </div>
      <Modal open={picking !== null} onClose={() => setPicking(null)} title={t('live.pickChannel')}>
        <ChannelPicker all={all} onPick={(c) => { setSlots((s) => s.map((x, j) => (j === picking ? c : x))); setAudio(picking!); setPicking(null); }} />
      </Modal>
    </div>
  );
}

function Tile({ channel, muted, onAudio, onPick, onClear, className }: { channel: LiveItem | null; muted: boolean; onAudio: () => void; onPick: () => void; onClear: () => void; className?: string }) {
  const { t } = useTranslation();
  const box = useRef<HTMLDivElement>(null);
  const player = useRef<WebPlayer | null>(null);
  useEffect(() => {
    if (!channel || !box.current) return;
    const p = new WebPlayer();
    p.video.muted = muted;
    p.attach(box.current);
    player.current = p;
    resolveStream('live', channel.playlistId, channel).then((src) => p.load({ ...src, title: channel.title }));
    return () => {
      p.destroy();
      player.current = null;
    };
  }, [channel ? chKey(channel) : null]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (player.current) player.current.video.muted = muted;
  }, [muted]);

  if (!channel) {
    return (
      <div className={clsx('flex items-center justify-center rounded bg-surface/40', className)}>
        <Button icon={<Plus className="size-4" />} onClick={onPick} testId="mv-add">{t('live.pickChannel')}</Button>
      </div>
    );
  }
  return (
    <div ref={box} className={clsx('group relative overflow-hidden rounded bg-black', !muted && 'ring-2 ring-accent', className)} data-testid="mv-tile" onClick={onAudio}>
      <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-2 bg-gradient-to-b from-black/70 to-transparent p-2 text-sm text-white">
        <span className="truncate font-medium">{channel.num} · {channel.title}</span>
        <div className="ms-auto flex gap-1">
          <Focusable onSelect={onAudio} ariaLabel="audio" className="rounded p-1.5 hover:bg-white/15">{muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}</Focusable>
          <Focusable onSelect={onPick} ariaLabel="change" className="rounded p-1.5 hover:bg-white/15"><Plus className="size-4" /></Focusable>
          <Focusable onSelect={onClear} ariaLabel="close" className="rounded p-1.5 hover:bg-white/15"><X className="size-4" /></Focusable>
        </div>
      </div>
    </div>
  );
}

function ChannelPicker({ all, onPick }: { all: LiveItem[]; onPick: (c: LiveItem) => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const n = normalizeText(q);
    return (n ? all.filter((c) => normalizeText(c.title).includes(n) || String(c.num) === q.trim()) : all).slice(0, 60);
  }, [q, all]);
  return (
    <div>
      <TextField value={q} onChange={setQ} autoFocus placeholder={t('search.placeholder')} testId="mv-search" dir="auto" />
      <div className="scroll-thin mt-3 max-h-80 space-y-0.5 overflow-y-auto">
        {list.map((c) => (
          <Focusable key={chKey(c)} onSelect={() => onPick(c)} testId="mv-option" className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-start text-sm hover:bg-surface-2">
            <span className="w-10 text-end text-muted tabular-nums">{c.num}</span>
            <span className="truncate">{c.title}</span>
          </Focusable>
        ))}
      </div>
    </div>
  );
}
