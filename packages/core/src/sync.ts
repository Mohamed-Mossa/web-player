/**
 * Sync rules shared by the client engine (and unit-tested here):
 * - Local changes are queued in an outbox (table + key + op) and pushed in batches.
 * - Pulls fetch rows changed since a per-table cursor (server updated_at).
 * - Conflicts: last write wins by server time. A local change that is still waiting in the outbox wins
 *   over a pulled row for the same key (it will be pushed and become the newest version).
 * - Deletes are soft (deleted_at) so other devices learn about them.
 */

export type OutboxOp = 'put' | 'del';

export interface OutboxEntry {
  seq: number;
  table: string;
  key: string;
  op: OutboxOp;
  at: number;
}

export interface RemoteRow<D = unknown> {
  key: string;
  data: D;
  updated_at: string;
  deleted_at: string | null;
}

/** Keeps only the newest outbox entry per table+key (a put after a del means "put", and vice versa). */
export function compactOutbox(entries: OutboxEntry[]): OutboxEntry[] {
  const latest = new Map<string, OutboxEntry>();
  for (const e of [...entries].sort((a, b) => a.seq - b.seq)) latest.set(`${e.table}\u0000${e.key}`, e);
  return [...latest.values()].sort((a, b) => a.seq - b.seq);
}

export interface PullPlan<D> {
  upserts: RemoteRow<D>[];
  deletes: string[];
  skipped: string[]; // keys with pending local changes
  cursor: string | null; // newest updated_at seen
}

/** Decides what a pulled page does locally. */
export function planPull<D>(rows: RemoteRow<D>[], pendingKeys: Set<string>, cursor: string | null): PullPlan<D> {
  const plan: PullPlan<D> = { upserts: [], deletes: [], skipped: [], cursor };
  // newest version per key within the page
  const byKey = new Map<string, RemoteRow<D>>();
  for (const r of rows) {
    const cur = byKey.get(r.key);
    if (!cur || cur.updated_at < r.updated_at) byKey.set(r.key, r);
    if (!plan.cursor || r.updated_at > plan.cursor) plan.cursor = r.updated_at;
  }
  for (const r of byKey.values()) {
    if (pendingKeys.has(r.key)) plan.skipped.push(r.key);
    else if (r.deleted_at) plan.deletes.push(r.key);
    else plan.upserts.push(r);
  }
  return plan;
}

/** Composite Dexie keys ↔ the single text key used remotely. */
export const joinKey = (k: string | readonly (string | number)[]) => (Array.isArray(k) ? k.join('|') : String(k));
export const splitKey = (k: string, parts: number) => {
  if (parts <= 1) return k;
  const p = k.split('|');
  // ids never contain '|' except possibly the last segment; re-join any extra pieces into it
  return [...p.slice(0, parts - 1), p.slice(parts - 1).join('|')];
};

/** Stable JSON for change detection (key order independent). */
export function stableJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(',')}}`;
}
