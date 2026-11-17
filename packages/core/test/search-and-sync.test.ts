import { describe, expect, it } from 'vitest';
import { expandTerm, matchKey, normalizeArabic, normalizeText } from '../src/normalize';
import { diffRows, hashString } from '../src/hash';
import { mergeAcrossPlaylists } from '../src/duplicates';

describe('normalization', () => {
  it('unifies Arabic letter forms and strips diacritics and tatweel', () => {
    expect(normalizeArabic('أَحْمَد')).toBe('احمد');
    expect(normalizeArabic('إسلام آية')).toBe('اسلام ايه');
    expect(normalizeArabic('مصطفى')).toBe('مصطفي');
    expect(normalizeArabic('جمـــيل')).toBe('جميل');
    expect(normalizeArabic('٢٠٢٤ ۱۲')).toBe('2024 12');
  });

  it('lowercases Latin, strips accents and punctuation', () => {
    expect(normalizeText('Amélie: Le Fabuleux!')).toBe('amelie le fabuleux');
    expect(normalizeText('Spider-Man')).toBe('spider man');
  });

  it('indexes Arabic words with and without the definite article', () => {
    expect(expandTerm('الفيل')).toEqual(['الفيل', 'فيل']);
    expect(expandTerm('والقمر')).toEqual(['والقمر', 'قمر']);
    expect(expandTerm('ال')).toEqual(['ال']);
    expect(expandTerm('matrix')).toEqual(['matrix']);
  });

  it('builds the same match key for spelling variants', () => {
    expect(matchKey('الفيلُ الأزرق', 2014)).toBe(matchKey('الفيل الازرق', 2014));
  });
});

describe('diffRows', () => {
  const row = (id: string, v: string) => ({ id, hash: hashString(v) });
  it('writes only new or changed rows and deletes missing ones', () => {
    const existing = new Map([
      ['1', hashString('a')],
      ['2', hashString('b')],
      ['3', hashString('c')],
    ]);
    const d = diffRows(existing, [row('1', 'a'), row('2', 'B'), row('4', 'd')]);
    expect(d.upserts.map((r) => r.id)).toEqual(['2', '4']);
    expect(d.deletes).toEqual(['3']);
    expect(d.unchanged).toBe(1);
  });

  it('diffs 50k rows fast', () => {
    const existing = new Map<string, string>();
    const incoming = [];
    for (let i = 0; i < 50_000; i++) {
      existing.set(String(i), hashString(`v${i}`));
      incoming.push(row(String(i), i % 100 === 0 ? `changed${i}` : `v${i}`));
    }
    const t0 = performance.now();
    const d = diffRows(existing, incoming);
    expect(d.upserts).toHaveLength(500);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe('mergeAcrossPlaylists', () => {
  it('merges the same movie across playlists, preferring playlist order', () => {
    const items = [
      { playlistId: 'b', id: '1', title: 'The Matrix', year: 1999 },
      { playlistId: 'a', id: '9', title: 'the matrix', year: 1999 },
      { playlistId: 'a', id: '10', title: 'The Matrix', year: 1999 }, // same playlist: kept separate
      { playlistId: 'b', id: '2', title: 'Dune', tmdbId: 438631 },
      { playlistId: 'a', id: '3', title: 'Dune: Part One', tmdbId: 438631 },
    ];
    const merged = mergeAcrossPlaylists(items, ['a', 'b']);
    const matrix = merged.find((m) => m.id === '9')!;
    expect(matrix.alternates).toEqual([{ playlistId: 'b', id: '1' }]);
    expect(merged.find((m) => m.id === '10')).toBeTruthy();
    expect(merged.find((m) => m.id === '3')!.alternates).toEqual([{ playlistId: 'b', id: '2' }]);
    expect(merged).toHaveLength(3);
  });
});
