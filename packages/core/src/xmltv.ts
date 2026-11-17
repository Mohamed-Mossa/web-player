export interface EpgChannel {
  id: string;
  names: string[];
  icon?: string;
}

export interface EpgProgramme {
  channelId: string;
  start: number; // epoch ms
  stop: number;
  title: string;
  desc?: string;
  category?: string;
}

/** "20261117200000 +0200" → epoch ms. Missing offset = UTC. */
export function parseXmltvTime(s: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{2}:?\d{2}|Z)?/.exec(s.trim());
  if (!m) return NaN;
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  const tz = m[7];
  if (!tz || tz === 'Z') return utc;
  const sign = tz[0] === '-' ? -1 : 1;
  const digits = tz.replace(/[^0-9]/g, '');
  const offMin = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
  return utc - offMin * 60_000;
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[m[1]] = decodeEntities(m[3] ?? m[4] ?? '');
  return out;
}

function inner(block: string, tag: string, prefer?: string[]): string | undefined {
  const re = new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
  let first: string | undefined;
  for (const m of block.matchAll(re)) {
    const raw = m[2].replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1');
    const text = decodeEntities(raw).trim();
    if (first === undefined) first = text;
    const lang = /lang\s*=\s*"([^"]+)"/.exec(m[1] ?? '')?.[1]?.toLowerCase();
    if (prefer && lang && prefer.includes(lang)) return text;
  }
  return first;
}

export interface XmltvFilter {
  /** Only keep these channel ids (null = all). */
  channels?: Set<string> | null;
  from?: number;
  to?: number;
  /** Preferred title languages, e.g. ['ar', 'en']. */
  langs?: string[];
}

/**
 * Streaming XMLTV parser: feed text chunks, get channels/programmes as they complete.
 * Handles files of hundreds of MB without building a DOM.
 */
export class XmltvParser {
  private buf = '';
  constructor(private filter: XmltvFilter = {}) {}

  push(chunk: string): { channels: EpgChannel[]; programmes: EpgProgramme[] } {
    this.buf += chunk;
    return this.drain(false);
  }

  end() {
    return this.drain(true);
  }

  private drain(final: boolean) {
    const channels: EpgChannel[] = [];
    const programmes: EpgProgramme[] = [];
    const f = this.filter;
    for (;;) {
      const c = this.buf.indexOf('<channel');
      const p = this.buf.indexOf('<programme');
      const startIdx = c < 0 ? p : p < 0 ? c : Math.min(c, p);
      if (startIdx < 0) {
        // keep a small tail in case a tag name is split across chunks
        this.buf = final ? '' : this.buf.slice(-16);
        break;
      }
      const isChannel = startIdx === c;
      const closeTag = isChannel ? '</channel>' : '</programme>';
      // self-closing <channel id="x"/> or <programme .../>
      const gt = this.buf.indexOf('>', startIdx);
      if (gt < 0) {
        this.buf = this.buf.slice(startIdx);
        break;
      }
      const openTag = this.buf.slice(startIdx, gt + 1);
      let end: number;
      let block: string;
      if (openTag.endsWith('/>')) {
        end = gt + 1;
        block = openTag;
      } else {
        const ci = this.buf.indexOf(closeTag, gt);
        if (ci < 0) {
          this.buf = this.buf.slice(startIdx);
          break;
        }
        end = ci + closeTag.length;
        block = this.buf.slice(startIdx, end);
      }
      this.buf = this.buf.slice(end);
      const a = attrs(openTag);
      if (isChannel) {
        if (!a.id || (f.channels && !f.channels.has(a.id))) continue;
        const names = [...block.matchAll(/<display-name[^>]*>([\s\S]*?)<\/display-name>/g)].map((m) => decodeEntities(m[1]).trim()).filter(Boolean);
        const icon = /<icon[^>]*src\s*=\s*"([^"]+)"/.exec(block)?.[1];
        channels.push({ id: a.id, names, icon: icon ? decodeEntities(icon) : undefined });
      } else {
        if (!a.channel || (f.channels && !f.channels.has(a.channel))) continue;
        const start = parseXmltvTime(a.start ?? '');
        const stop = parseXmltvTime(a.stop ?? '') || start + 30 * 60_000;
        if (!Number.isFinite(start)) continue;
        if (f.from !== undefined && stop < f.from) continue;
        if (f.to !== undefined && start > f.to) continue;
        programmes.push({
          channelId: a.channel,
          start,
          stop,
          title: inner(block, 'title', f.langs) ?? '',
          desc: inner(block, 'desc', f.langs),
          category: inner(block, 'category', f.langs),
        });
      }
    }
    return { channels, programmes };
  }
}

export function parseXmltv(text: string, filter?: XmltvFilter) {
  const p = new XmltvParser(filter);
  const a = p.push(text);
  const b = p.end();
  return { channels: [...a.channels, ...b.channels], programmes: [...a.programmes, ...b.programmes] };
}

/** Programme on air at `t` and the one after it, from a channel's programmes sorted by start. */
export function nowNext(progs: EpgProgramme[], t = Date.now()): { now?: EpgProgramme; next?: EpgProgramme } {
  const i = progs.findIndex((p) => p.start <= t && p.stop > t);
  if (i >= 0) return { now: progs[i], next: progs[i + 1] };
  const n = progs.find((p) => p.start > t);
  return { next: n };
}

/** Date parts of `t` in a given IANA time zone (for Xtream catch-up URLs, which use the server's local time). */
export function zonedParts(t: number, timeZone?: string) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: timeZone || undefined, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { y: p.year, mo: p.month, d: p.day, h: p.hour, mi: p.minute };
}
