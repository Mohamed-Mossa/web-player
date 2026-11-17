import { describe, expect, it } from 'vitest';
import { compactOutbox, joinKey, planPull, splitKey, stableJson, type OutboxEntry, type RemoteRow } from '../src/sync';

const e = (seq: number, key: string, op: 'put' | 'del', table = 'favorites'): OutboxEntry => ({ seq, table, key, op, at: seq });
const r = (key: string, t: string, deleted = false): RemoteRow<{ v: string }> => ({ key, data: { v: t }, updated_at: t, deleted_at: deleted ? t : null });

describe('outbox', () => {
  it('keeps the newest operation per key, in order', () => {
    const out = compactOutbox([e(1, 'a', 'put'), e(2, 'b', 'put'), e(3, 'a', 'del'), e(4, 'b', 'put'), e(5, 'a', 'put', 'progress')]);
    expect(out.map((x) => [x.table, x.key, x.op])).toEqual([
      ['favorites', 'a', 'del'],
      ['favorites', 'b', 'put'],
      ['progress', 'a', 'put'],
    ]);
  });

  it('a delete followed by a re-add ends as a put', () => {
    expect(compactOutbox([e(1, 'x', 'put'), e(2, 'x', 'del'), e(3, 'x', 'put')])[0].op).toBe('put');
  });
});

describe('pull planning (two devices editing offline)', () => {
  it('applies remote changes, honours deletes and advances the cursor', () => {
    const plan = planPull([r('a', '2026-01-01T10:00:00Z'), r('b', '2026-01-01T10:05:00Z', true)], new Set(), '2026-01-01T09:00:00Z');
    expect(plan.upserts.map((x) => x.key)).toEqual(['a']);
    expect(plan.deletes).toEqual(['b']);
    expect(plan.cursor).toBe('2026-01-01T10:05:00Z');
  });

  it('keeps a local change that has not been pushed yet', () => {
    const plan = planPull([r('a', '2026-01-01T10:00:00Z'), r('c', '2026-01-01T10:01:00Z')], new Set(['a']), null);
    expect(plan.skipped).toEqual(['a']);
    expect(plan.upserts.map((x) => x.key)).toEqual(['c']);
  });

  it('uses the newest version when a page contains the same key twice', () => {
    const plan = planPull([r('a', '2026-01-01T10:00:00Z'), r('a', '2026-01-01T11:00:00Z', true)], new Set(), null);
    expect(plan.deletes).toEqual(['a']);
    expect(plan.upserts).toEqual([]);
  });

  it('end to end: phone and TV converge', () => {
    // server state after both devices pushed: TV removed a favorite, phone added one
    const server: RemoteRow<{ v: string }>[] = [r('fav-1', '2026-01-02T08:00:00Z', true), r('fav-2', '2026-01-02T08:01:00Z')];
    const tvLocal = new Map([['fav-1', 'x']]);
    const plan = planPull(server, new Set(), '2026-01-01T00:00:00Z');
    for (const k of plan.deletes) tvLocal.delete(k);
    for (const u of plan.upserts) tvLocal.set(u.key, u.data.v);
    expect([...tvLocal.keys()]).toEqual(['fav-2']);
  });
});

describe('keys', () => {
  it('joins and splits composite keys', () => {
    expect(joinKey(['p1', 'movie', 'pl', '10'])).toBe('p1|movie|pl|10');
    expect(splitKey('p1|movie|pl|10', 4)).toEqual(['p1', 'movie', 'pl', '10']);
    expect(splitKey('p1|live|pl|a|b', 4)).toEqual(['p1', 'live', 'pl', 'a|b']);
    expect(splitKey('abc', 1)).toBe('abc');
  });

  it('stable JSON ignores key order and undefined', () => {
    expect(stableJson({ b: 1, a: { d: 2, c: undefined } })).toBe(stableJson({ a: { d: 2 }, b: 1 }));
  });
});
