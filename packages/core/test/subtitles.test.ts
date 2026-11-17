import { describe, expect, it } from 'vitest';
import { cuesAt, decodeSubtitleBytes, parseSubtitles } from '../src/subtitles';

const SRT = `﻿1\r\n00:00:01,000 --> 00:00:03,500\r\n<i>Hello</i> there\r\n\r\n2\r\n00:00:04,000 --> 00:00:06,000\r\nمرحبا\r\nبالعربي\r\n\r\n3\r\n00:00:05,500 --> 00:00:07,000\r\n{\\an8}Overlap &amp; top\r\n`;
const VTT = `WEBVTT

NOTE a comment

intro
00:01.000 --> 00:02.000 align:start position:10%
First

00:00:02.500 --> 00:00:04.000
Second
`;

describe('parseSubtitles', () => {
  it('parses SRT with BOM, CRLF, tags and Arabic', () => {
    const c = parseSubtitles(SRT);
    expect(c).toHaveLength(3);
    expect(c[0]).toEqual({ start: 1, end: 3.5, text: 'Hello there' });
    expect(c[1].text).toBe('مرحبا\nبالعربي');
    expect(c[2].text).toBe('Overlap & top');
  });

  it('parses WebVTT with short timestamps, cue ids and settings', () => {
    const c = parseSubtitles(VTT);
    expect(c.map((x) => [x.start, x.end, x.text])).toEqual([[1, 2, 'First'], [2.5, 4, 'Second']]);
  });

  it('finds active cues with overlaps and a timing offset', () => {
    const c = parseSubtitles(SRT);
    expect(cuesAt(c, 2).map((x) => x.text)).toEqual(['Hello there']);
    expect(cuesAt(c, 5.7).map((x) => x.text)).toEqual(['مرحبا\nبالعربي', 'Overlap & top']);
    expect(cuesAt(c, 3.8)).toEqual([]);
    // offset +1s: the cue starting at 1s now shows at 2s..4.5s
    expect(cuesAt(c, 4.2, 1).map((x) => x.text)).toEqual(['Hello there']);
  });

  it('re-decodes Windows-1256 Arabic files', () => {
    const bytes = new Uint8Array([0xe3, 0xd1, 0xcd, 0xc8, 0xc7, 0x20, 0xe3, 0xd1, 0xcd, 0xc8, 0xc7, 0x20, 0xe3, 0xd1, 0xcd, 0xc8, 0xc7]);
    expect(decodeSubtitleBytes(bytes.buffer)).toBe('مرحبا مرحبا مرحبا');
  });
});
