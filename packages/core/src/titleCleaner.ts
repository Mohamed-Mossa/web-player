import type { Kind } from './models';

export interface CleanedTitle {
  title: string;
  year?: number;
  lang?: string;
  quality?: string;
  season?: number;
  episode?: number;
}

const LANG_CODES = new Set([
  'AR', 'ARA', 'ARAB', 'EN', 'ENG', 'FR', 'FRE', 'TR', 'TUR', 'DE', 'GER', 'ES', 'SPA', 'IT', 'ITA',
  'IN', 'HI', 'HIN', 'KO', 'KOR', 'JP', 'JPN', 'FA', 'PER', 'KU', 'KUR', 'PT', 'POR', 'RU', 'RUS',
  'NL', 'PL', 'UR', 'URD', 'MA', 'EG', 'SA', 'GULF', 'UK', 'US',
]);

const PROVIDER_TAGS = new Set(['TOP', 'OSN', 'SHAHID', 'NETFLIX', 'DISNEY', 'APPLE', 'HBO', 'PRIME', 'KIDS', 'VOD', '24/7', 'PPV']);

const LANG_MAP: Record<string, string> = {
  AR: 'ar', ARA: 'ar', ARAB: 'ar', EG: 'ar', SA: 'ar', MA: 'ar', GULF: 'ar',
  EN: 'en', ENG: 'en', UK: 'en', US: 'en', FR: 'fr', FRE: 'fr', TR: 'tr', TUR: 'tr',
  DE: 'de', GER: 'de', ES: 'es', SPA: 'es', IT: 'it', ITA: 'it', IN: 'hi', HI: 'hi', HIN: 'hi',
  KO: 'ko', KOR: 'ko', JP: 'ja', JPN: 'ja', FA: 'fa', PER: 'fa', KU: 'ku', KUR: 'ku',
  PT: 'pt', POR: 'pt', RU: 'ru', RUS: 'ru', NL: 'nl', PL: 'pl', UR: 'ur', URD: 'ur',
};

// Tags removed anywhere (case-sensitive for short ones, so "Hd" inside a real title survives).
const QUALITY_WORDS =
  '4K|8K|UHD|FHD|HD|SD|HQ|LQ|VIP|HEVC|H\\.?265|H\\.?264|[xX]26[45]|2160[pP]|1080[pP]|720[pP]|480[pP]|HDR10\\+?|HDR|DV|60\\s?FPS|' +
  'MULTI[- ]?SUBS?|MULTI[- ]?AUDIO|MULTI|DUAL[- ]AUDIO|SUBBED|DUBBED|DUB|SUBS?|NF|AMZN|WEB[- ]?DL|WEBRIP|BLURAY|BRRIP|CAM|TS|NEW';
const QUALITY_RE = new RegExp(`(^|[\\s\\[\\(|\\-–:])(${QUALITY_WORDS})(?=$|[\\s\\]\\)|\\-–:])`, 'g');
const QUALITY_TEST = new RegExp(`^(?:${QUALITY_WORDS})$`);
const ARABIC_TAGS = /(^|\s)(مدبلج|مترجم|اونلاين|أونلاين|حصري|جديد|كامل|بجودة عالية)(?=\s|$)/g;

// Emoji and box/symbol decorations. Written as ranges, not \p{Extended_Pictographic}, which
// older TV browsers (Chromium 69) reject as a syntax error.
const DECORATION = /[\u{1F000}-\u{1FAFF}\u{2300}-\u{23FF}\u{2190}-\u{21FF}\u{3030}\u{303D}\u{3297}\u{3299}\u{00A9}\u{00AE}\u{203C}\u{2049}\u{2122}\u{2139}\u{24C2}─-╿■-◿☀-➿⬀-⯿•»«★☆✪◉\u{FE0F}\u{200D}]/gu;
const SEPARATORS = '[\\s\\-|:–—·._/]';
const TRIM_SEP = new RegExp(`^${SEPARATORS}+|${SEPARATORS}+$`, 'g');

const maxYear = () => new Date().getFullYear() + 2;
const validYear = (y: number) => y >= 1900 && y <= maxYear();

/**
 * Turn provider names like "HQ | The Matrix (1999) [MULTI-SUB]" into a clean title + metadata.
 * `kind = 'live'` keeps quality words in the name (channels are often listed by quality).
 */
export function cleanTitle(raw: string, kind: Kind = 'movie'): CleanedTitle {
  const out: CleanedTitle = { title: '' };
  let s = (raw ?? '').replace(DECORATION, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return { title: '' };

  // "The.Dark.Knight.2008.1080p" → spaces
  if (!/\s/.test(s) && /[._]/.test(s)) s = s.replace(/[._]+/g, ' ');

  // Leading tags: "|EN| ", "[AR] ", "HQ | ", "4K-AR - ", "EN: " (repeatable)
  for (let i = 0; i < 4; i++) {
    const m =
      /^\|\s*([^|]{1,10}?)\s*\|\s*/.exec(s) ||
      /^\[\s*([^\]]{1,10}?)\s*\]\s*/.exec(s) ||
      /^([A-Z0-9+]{1,6}(?:[ -][A-Z0-9+]{1,4})?)\s*(?:\||-|–|:|»|·)\s+/.exec(s);
    if (!m) break;
    const tag = m[1].trim();
    const parts = tag.toUpperCase().split(/[ -]/);
    // Bare "TAG: Title" is only a tag when every part is known ("CSI: Miami" stays intact).
    const bare = !s.startsWith('|') && !s.startsWith('[');
    if (bare && !parts.every((p) => LANG_CODES.has(p) || QUALITY_TEST.test(p) || PROVIDER_TAGS.has(p))) break;
    for (const p of parts) {
      if (LANG_CODES.has(p) && !out.lang) out.lang = LANG_MAP[p] ?? p.toLowerCase();
      else if (QUALITY_TEST.test(p) && !out.quality) out.quality = p;
    }
    s = s.slice(m[0].length);
  }

  // Season / episode
  const se = /(?:^|[\s\-|])S(\d{1,2})\s*[ .-]?\s*E(\d{1,3})(?=\b|$)/i.exec(s);
  if (se) {
    out.season = Number(se[1]);
    out.episode = Number(se[2]);
    s = s.slice(0, se.index) + ' ' + s.slice(se.index + se[0].length);
  } else if (kind === 'series') {
    const sOnly = /(?:^|\s)(?:S(\d{1,2})|Season\s*(\d{1,2})|الموسم\s*(\d{1,2}))(?=\s|$)/i.exec(s);
    if (sOnly) {
      out.season = Number(sOnly[1] ?? sOnly[2] ?? sOnly[3]);
      s = s.slice(0, sOnly.index) + ' ' + s.slice(sOnly.index + sOnly[0].length);
    }
  }

  // Bracketed year "(2021)" / "[2021]" wins over a trailing number.
  const by = /[([]\s*((?:19|20)\d{2})\s*[)\]]/.exec(s);
  if (by && validYear(Number(by[1]))) {
    out.year = Number(by[1]);
    s = s.slice(0, by.index) + ' ' + s.slice(by.index + by[0].length);
  }

  // Quality / release tags anywhere (kept in live channel names)
  if (kind !== 'live') {
    s = s.replace(QUALITY_RE, (_m, pre: string, word: string) => {
      if (!out.quality) out.quality = word.toUpperCase();
      return pre;
    });
    s = s.replace(ARABIC_TAGS, '$1');
  }
  // Empty or tag-only brackets left behind: "()", "[ - ]"
  s = s.replace(/[([]\s*[-|:]*\s*[)\]]/g, ' ');

  s = s.replace(/\s+/g, ' ').replace(TRIM_SEP, '').trim();

  // Trailing year "Title 2021" / "Title - 2021" (only if something remains before it)
  if (out.year === undefined) {
    const ty = new RegExp(`^(.+?)${SEPARATORS}+((?:19|20)\\d{2})$`).exec(s);
    if (ty && validYear(Number(ty[2])) && /\p{L}/u.test(ty[1])) {
      out.year = Number(ty[2]);
      s = ty[1];
    }
  }

  s = s.replace(/\s+/g, ' ').replace(TRIM_SEP, '').trim();
  out.title = s || raw.trim();
  return out;
}

/** Name used to group M3U episodes into one series: title without SxxExx, year or tags. */
export function seriesKey(raw: string): string {
  return cleanTitle(raw, 'series').title.toLowerCase();
}
