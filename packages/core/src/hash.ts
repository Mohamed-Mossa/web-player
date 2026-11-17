/** FNV-1a 32-bit, base36. Fast and stable; used for row diffs and synthetic ids. */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export interface RowDiff<T> {
  upserts: T[];
  deletes: string[];
  unchanged: number;
}

/**
 * Compare freshly downloaded rows with what is stored (id → hash).
 * Only changed or new rows are written; ids no longer present are deleted.
 */
export function diffRows<T extends { id: string; hash: string }>(
  existing: Map<string, string>,
  incoming: T[],
): RowDiff<T> {
  const upserts: T[] = [];
  const seen = new Set<string>();
  let unchanged = 0;
  for (const row of incoming) {
    seen.add(row.id);
    if (existing.get(row.id) === row.hash) unchanged++;
    else upserts.push(row);
  }
  const deletes: string[] = [];
  for (const id of existing.keys()) if (!seen.has(id)) deletes.push(id);
  return { upserts, deletes, unchanged };
}
