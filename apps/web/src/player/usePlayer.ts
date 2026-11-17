import { useEffect, useRef, useState } from 'react';
import { createPlayer } from './createPlayer';
import type { PlayerAdapter, PlayerError, PlayerStatus, Track } from './types';

export interface PlayerState {
  status: PlayerStatus;
  current: number;
  duration: number;
  buffered: number;
  tracks: Track[];
  cues: string[];
  error: PlayerError | null;
  retry: { attempt: number; max: number } | null;
}

const initial: PlayerState = { status: 'idle', current: 0, duration: 0, buffered: 0, tracks: [], cues: [], error: null, retry: null };

/** Creates the platform player once per mount (StrictMode-safe) and mirrors its events into React state. */
export function usePlayer(container: React.RefObject<HTMLDivElement | null>) {
  const [player, setPlayer] = useState<PlayerAdapter | null>(null);
  const [state, setState] = useState<PlayerState>(initial);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const p = createPlayer();
    if (container.current) p.attach(container.current);
    const offs = [
      p.on('status', (status) => setState((s) => ({ ...s, status, ...(status === 'playing' ? { retry: null, error: null } : {}) }))),
      p.on('time', (t) => setState((s) => ({ ...s, current: t.current, duration: t.duration, buffered: t.buffered }))),
      p.on('tracks', (tracks) => setState((s) => ({ ...s, tracks }))),
      p.on('cues', (cues) => setState((s) => ({ ...s, cues }))),
      p.on('error', (error) => setState((s) => ({ ...s, error, retry: null }))),
      p.on('retry', (retry) => setState((s) => ({ ...s, retry }))),
    ];
    setPlayer(p);
    return () => {
      offs.forEach((o) => o());
      p.destroy();
      setPlayer(null);
      setState(initial);
    };
  }, [container]);

  return { player, state, stateRef };
}

export function fmtTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}
