import { describe, expect, it } from 'vitest';
import { cleanTitle } from '../src/titleCleaner';
import fixtures from './fixtures/titles.json';

type Fx = { raw: string; kind?: 'movie' | 'series' | 'live'; title: string; year?: number; lang?: string; season?: number; episode?: number };

describe('cleanTitle', () => {
  for (const fx of fixtures as Fx[]) {
    it(`cleans "${fx.raw}"`, () => {
      const r = cleanTitle(fx.raw, fx.kind ?? 'movie');
      expect(r.title).toBe(fx.title);
      expect(r.year).toBe(fx.year);
      if (fx.lang) expect(r.lang).toBe(fx.lang);
      if (fx.season !== undefined) expect(r.season).toBe(fx.season);
      if (fx.episode !== undefined) expect(r.episode).toBe(fx.episode);
    });
  }

  it('never returns an empty title for a non-empty input', () => {
    expect(cleanTitle('HD').title).not.toBe('');
    expect(cleanTitle('|AR|').title).not.toBe('');
  });

  it('rejects years in the far future as release years', () => {
    expect(cleanTitle('Space Odyssey 2099').year).toBeUndefined();
  });
});
