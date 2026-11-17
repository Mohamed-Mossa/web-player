/// <reference lib="webworker" />
import MiniSearch from 'minisearch';
import { expandTerm, normalizeText, type Kind } from '@iptv/core';
import { db } from '../db/db';

export interface SearchDoc {
  key: string; // kind:playlistId:itemId (MiniSearch document id)
  kind: Kind;
  playlistId: string;
  itemId: string;
  title: string;
  year?: number;
  poster?: string;
  num?: number;
}

export type SearchRequest = { type: 'search'; reqId: number; q: string; limit: number; playlistIds: string[] };
export type SearchResponse = { type: 'results'; reqId: number; hits: (SearchDoc & { score: number })[]; building?: boolean };

const OPTIONS = {
  idField: 'key',
  fields: ['title'],
  storeFields: ['key', 'kind', 'playlistId', 'itemId', 'title', 'year', 'poster', 'num'],
  processTerm: (term: string) => {
    const n = normalizeText(term);
    if (!n) return null;
    return n.split(' ').flatMap(expandTerm);
  },
  searchOptions: {
    prefix: true,
    fuzzy: (term: string) => (term.length >= 8 ? 2 : term.length >= 4 ? 1 : 0),
    combineWith: 'AND' as const,
    processTerm: (term: string) => {
      const n = normalizeText(term);
      return n ? n.split(' ') : null;
    },
  },
};

let index: MiniSearch<SearchDoc> | null = null;
let indexSig = '';
let building: Promise<void> | null = null;

async function signature(playlistIds: string[]) {
  const metas = await db.syncMeta.toArray();
  return playlistIds
    .map((p) => metas.filter((m) => m.playlistId === p).map((m) => `${m.kind}${m.lastFullSync}`).join('.'))
    .join('|') + `#v2#${playlistIds.join(',')}`;
}

async function ensureIndex(playlistIds: string[]) {
  const sig = await signature(playlistIds);
  if (index && sig === indexSig) return;
  if (building) return building;
  building = (async () => {
    const cached = await db.searchIndex.get('all');
    if (cached && cached.signature === sig) {
      index = MiniSearch.loadJSON<SearchDoc>(cached.json, OPTIONS);
      indexSig = sig;
      return;
    }
    const ms = new MiniSearch<SearchDoc>(OPTIONS);
    const allowed = new Set(playlistIds);
    const add = (kind: Kind, rows: { playlistId: string; id: string; title: string; year?: number; poster?: string; logo?: string; num?: number }[]) => {
      const docs: SearchDoc[] = [];
      for (const r of rows) {
        if (!allowed.has(r.playlistId)) continue;
        docs.push({ key: `${kind}:${r.playlistId}:${r.id}`, kind, playlistId: r.playlistId, itemId: r.id, title: r.title, year: r.year, poster: r.poster ?? r.logo, num: r.num });
      }
      ms.addAll(docs);
    };
    add('movie', await db.movies.toArray());
    add('series', await db.series.toArray());
    add('live', await db.live.toArray());
    index = ms;
    indexSig = sig;
    await db.searchIndex.put({ id: 'all', signature: sig, json: JSON.stringify(ms) });
  })().finally(() => {
    building = null;
  });
  return building;
}

self.onmessage = async (ev: MessageEvent<SearchRequest>) => {
  const { reqId, q, limit, playlistIds } = ev.data;
  const post = (m: SearchResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);
  if (!index) post({ type: 'results', reqId, hits: [], building: true });
  await ensureIndex(playlistIds);
  if (!q.trim()) return post({ type: 'results', reqId, hits: [] });
  const hits = index!.search(q).slice(0, limit) as unknown as (SearchDoc & { score: number })[];
  post({ type: 'results', reqId, hits });
};
