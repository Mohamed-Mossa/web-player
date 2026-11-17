import { useEffect, useRef, useState } from 'react';
import type { SearchDoc, SearchRequest, SearchResponse } from '../workers/search.worker';
import { usePlaylists } from './catalog';
import { createSearchWorker } from 'virtual-worker-factory';

let worker: Worker | null = null;
let reqSeq = 0;
const listeners = new Map<number, (r: SearchResponse) => void>();

function getWorker() {
  if (!worker) {
    worker = createSearchWorker();
    worker.onmessage = (ev: MessageEvent<SearchResponse>) => listeners.get(ev.data.reqId)?.(ev.data);
  }
  return worker;
}

export type SearchHit = SearchDoc & { score: number };

export function useSearch(q: string, limit = 120) {
  const playlists = usePlaylists();
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [building, setBuilding] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    if (!playlists) return;
    const reqId = ++reqSeq;
    latest.current = reqId;
    const timer = setTimeout(() => {
      listeners.set(reqId, (r) => {
        if (r.reqId !== latest.current) return;
        if (r.building) {
          setBuilding(true);
          return;
        }
        setBuilding(false);
        setHits(r.hits);
        listeners.delete(reqId);
      });
      const msg: SearchRequest = { type: 'search', reqId, q, limit, playlistIds: playlists.map((p) => p.id) };
      getWorker().postMessage(msg);
    }, 150);
    return () => clearTimeout(timer);
  }, [q, limit, playlists]);

  return { hits, building };
}

/** Warm the index in the background after a sync so the first search is instant. */
export function warmSearch(playlistIds: string[]) {
  const msg: SearchRequest = { type: 'search', reqId: ++reqSeq, q: '', limit: 0, playlistIds };
  getWorker().postMessage(msg);
}
