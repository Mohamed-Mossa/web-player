export interface Cue {
  start: number; // seconds
  end: number;
  text: string; // plain text, lines joined with \n
}

function ts(s: string): number {
  // 00:01:02,345 | 00:01:02.345 | 01:02.345
  const m = /(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})/.exec(s.trim());
  if (!m) return NaN;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
}

const stripTags = (t: string) =>
  t
    .replace(/<[^>]+>/g, '')
    .replace(/\{\\[^}]*\}/g, '') // ASS-style {\an8}
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();

/** Parses SRT or WebVTT (auto-detected). Tolerates BOM, CRLF, missing indexes and cue settings. */
export function parseSubtitles(input: string): Cue[] {
  const text = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const blocks = text.split(/\n{2,}/);
  const cues: Cue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.length > 0);
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i].split('-->');
    const start = ts(a);
    const end = ts(b.trim().split(/\s+/)[0]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const body = stripTags(lines.slice(i + 1).join('\n'));
    if (body) cues.push({ start, end, text: body });
  }
  return cues.sort((x, y) => x.start - y.start);
}

/** Active cues at time t (seconds), after applying a user offset (positive = later). Binary search. */
export function cuesAt(cues: Cue[], t: number, offset = 0): Cue[] {
  const time = t - offset;
  let lo = 0;
  let hi = cues.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= time) lo = mid + 1;
    else hi = mid;
  }
  const out: Cue[] = [];
  // look back a little: cues may overlap
  for (let i = lo - 1; i >= 0 && i >= lo - 8; i--) if (cues[i].end > time) out.unshift(cues[i]);
  return out;
}

/** Detects text encoding problems (Windows-1256 Arabic decoded as UTF-8) and re-decodes. */
export function decodeSubtitleBytes(bytes: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const bad = (utf8.match(/�/g) ?? []).length;
  if (bad > 5) {
    try {
      return new TextDecoder('windows-1256').decode(bytes);
    } catch {
      return utf8;
    }
  }
  return utf8;
}
