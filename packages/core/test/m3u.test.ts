import { describe, expect, it } from 'vitest';
import {
  M3UCatalogBuilder, M3UParser, classifyEntry, credsFromM3UUrl, fillUrl, parseM3U, templatizeUrl,
} from '../src/m3u';

const SAMPLE = `#EXTM3U x-tvg-url="http://epg.example.com/guide.xml.gz"
#EXTINF:-1 tvg-id="mbc1.ae" tvg-name="AR | MBC 1" tvg-logo="http://logo/mbc1.png" group-title="Arabic, General" tvg-chno="101" catchup-days="3",AR | MBC 1 HD
http://host:8080/live/user/pass/1001.ts
#EXTINF:-1 tvg-logo="http://logo/m.jpg" group-title="Movies | Action",HQ | The Matrix (1999)
http://host:8080/movie/user/pass/2001.mkv
#EXTINF:-1 group-title="Series | Drama",Breaking Bad S01E02
http://host:8080/series/user/pass/3002.mp4
#EXTINF:-1 group-title="Series | Drama",Breaking Bad S01E01
http://host:8080/series/user/pass/3001.mp4
#EXTINF:-1 group-title="Series | Drama",Breaking Bad S02E01
http://host:8080/series/user/pass/3003.mp4
#EXTINF:-1,No Group Channel
#EXTVLCOPT:http-user-agent=MyAgent/1.0
#EXTVLCOPT:http-referrer=http://ref.example/
http://other.example/stream.m3u8
`;

describe('parseM3U', () => {
  it('reads header, attributes, names with commas inside quotes', () => {
    const { header, entries } = parseM3U(SAMPLE);
    expect(header.epgUrl).toBe('http://epg.example.com/guide.xml.gz');
    expect(entries).toHaveLength(6);
    const ch = entries[0];
    expect(ch.name).toBe('AR | MBC 1 HD');
    expect(ch.group).toBe('Arabic, General');
    expect(ch.attrs['tvg-id']).toBe('mbc1.ae');
    expect(ch.attrs['tvg-chno']).toBe('101');
    expect(ch.duration).toBe(-1);
  });

  it('keeps per-entry VLC headers and resets them after the URL', () => {
    const { entries } = parseM3U(SAMPLE);
    expect(entries[5].headers).toEqual({ 'User-Agent': 'MyAgent/1.0', Referer: 'http://ref.example/' });
    expect(entries[1].headers).toBeUndefined();
  });

  it('gives identical results when streamed in tiny chunks (CRLF too)', () => {
    const text = SAMPLE.replace(/\n/g, '\r\n');
    const p = new M3UParser();
    const out = [];
    for (let i = 0; i < text.length; i += 7) out.push(...p.push(text.slice(i, i + 7)));
    out.push(...p.end());
    expect(out.map((e) => e.name)).toEqual(parseM3U(SAMPLE).entries.map((e) => e.name));
    expect(out.map((e) => e.url)).toEqual(parseM3U(SAMPLE).entries.map((e) => e.url));
  });

  it('handles a BOM, blank lines and a URL with no #EXTINF', () => {
    const { entries } = parseM3U('﻿#EXTM3U\n\n\nhttp://a/b.m3u8\n');
    expect(entries).toEqual([expect.objectContaining({ url: 'http://a/b.m3u8', name: 'http://a/b.m3u8' })]);
  });

  it('parses 100k entries quickly', () => {
    const lines = ['#EXTM3U'];
    for (let i = 0; i < 100_000; i++) lines.push(`#EXTINF:-1 group-title="G${i % 50}",Channel ${i}`, `http://h/live/u/p/${i}.ts`);
    const t0 = performance.now();
    const { entries } = parseM3U(lines.join('\n'));
    expect(entries).toHaveLength(100_000);
    expect(performance.now() - t0).toBeLessThan(3000);
  });
});

describe('classification and urls', () => {
  it('classifies live, movie and series entries', () => {
    const { entries } = parseM3U(SAMPLE);
    expect(entries.map(classifyEntry)).toEqual(['live', 'movie', 'series', 'series', 'series', 'live']);
  });

  it('strips credentials from stored URLs and restores them for playback', () => {
    const t = templatizeUrl('http://h:80/live/user/pass/1.ts', 'user', 'pass');
    expect(t).toBe('http://h:80/live/{u}/{p}/1.ts');
    expect(fillUrl(t, 'user', 'p@ss')).toBe('http://h:80/live/user/p%40ss/1.ts');
  });

  it('detects Xtream credentials inside an M3U link', () => {
    expect(credsFromM3UUrl('http://h:8080/get.php?username=a&password=b&type=m3u_plus')).toEqual({
      server: 'http://h:8080', username: 'a', password: 'b',
    });
    expect(credsFromM3UUrl('https://lists.example/my.m3u')).toBeNull();
  });
});

describe('M3UCatalogBuilder', () => {
  it('builds categories, live channels, movies and grouped series', () => {
    const b = new M3UCatalogBuilder('p1', { username: 'user', password: 'pass' });
    b.add(parseM3U(SAMPLE).entries);
    const snap = b.build();
    expect(snap.live).toHaveLength(2);
    expect(snap.live[0]).toMatchObject({ title: 'MBC 1 HD', num: 101, epgChannelId: 'mbc1.ae', archiveDays: 3 });
    expect(snap.live[0].url).toBe('http://host:8080/live/{u}/{p}/1001.ts');
    expect(snap.movies[0]).toMatchObject({ title: 'The Matrix', year: 1999, ext: 'mkv' });
    expect(snap.series).toHaveLength(1);
    const detail = snap.seriesDetails![0];
    expect(detail.seasons.map((s) => s.season)).toEqual([1, 2]);
    expect(detail.seasons[0].episodes.map((e) => e.episode)).toEqual([1, 2]);
    expect(snap.categories.map((c) => c.kind).sort()).toEqual(['live', 'live', 'movie', 'series']);
  });

  it('produces stable ids across runs, so incremental sync can diff', () => {
    const a = new M3UCatalogBuilder('p1');
    a.add(parseM3U(SAMPLE).entries);
    const b = new M3UCatalogBuilder('p1');
    b.add(parseM3U(SAMPLE).entries);
    expect(a.build().movies.map((m) => m.id)).toEqual(b.build().movies.map((m) => m.id));
  });
});
