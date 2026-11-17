/// <reference lib="webworker" />
import 'virtual-worker-polyfills';
import { gunzipStream, textDecoderStream } from '../lib/streams';
import { XmltvParser } from '@iptv/core';
import { db, type EpgRow } from '../db/db';
import { fetchWithTimeout, type NetConfig } from '../lib/http';

export type EpgRequest = { playlistId: string; url: string; net: NetConfig; channelIds: string[]; archiveDays: number; langs: string[] };
export type EpgMessage = { type: 'done'; playlistId: string; count: number } | { type: 'error'; playlistId: string; message: string };

const post = (m: EpgMessage) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

/** Gzip-aware text stream: XMLTV files are often served as .xml.gz without Content-Encoding. */
async function textStream(res: Response): Promise<ReadableStream<string>> {
  const reader = res.body!.getReader();
  const first = await reader.read();
  const head = first.value ?? new Uint8Array();
  const rest = new ReadableStream<Uint8Array>({
    start(c) {
      if (head.length) c.enqueue(head);
    },
    async pull(c) {
      const { value, done } = await reader.read();
      if (done) c.close();
      else c.enqueue(value);
    },
  });
  const gz = head[0] === 0x1f && head[1] === 0x8b;
  const bytes = gz ? rest.pipeThrough(gunzipStream()) : rest;
  return bytes.pipeThrough(textDecoderStream());
}

self.onmessage = async (ev: MessageEvent<EpgRequest>) => {
  const { playlistId, url, net, channelIds, archiveDays, langs } = ev.data;
  const stamp = Date.now();
  try {
    const res = await fetchWithTimeout(url, net, 300_000);
    const now = Date.now();
    const parser = new XmltvParser({
      channels: new Set(channelIds),
      from: now - Math.max(1, archiveDays) * 86400_000,
      to: now + 3 * 86400_000,
      langs,
    });
    let batch: EpgRow[] = [];
    let count = 0;
    const flush = async () => {
      if (!batch.length) return;
      await db.epg.bulkPut(batch);
      count += batch.length;
      batch = [];
    };
    const reader = (await textStream(res)).getReader();
    for (;;) {
      const { value, done } = await reader.read();
      const out = done ? parser.end() : parser.push(value);
      for (const p of out.programmes) batch.push({ ...p, playlistId, v: stamp });
      if (batch.length >= 5000 || done) await flush();
      if (done) break;
    }
    // Remove programmes from previous imports that this one did not refresh.
    await db.epg.where('playlistId').equals(playlistId).filter((r) => r.v !== stamp).delete();
    post({ type: 'done', playlistId, count });
  } catch (e) {
    post({ type: 'error', playlistId, message: (e as Error)?.message ?? String(e) });
  }
};
