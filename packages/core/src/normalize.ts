/**
 * Text normalization shared by search indexing, querying and duplicate matching.
 * Arabic: strip diacritics (tashkeel) and tatweel, unify alef/yaa/taa-marbuta forms,
 * convert Arabic-Indic digits. Latin: lowercase and strip accents.
 */

const ARABIC_DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;
const TATWEEL = /ـ/g;

export function normalizeArabic(input: string): string {
  return input
    .replace(ARABIC_DIACRITICS, '')
    .replace(TATWEEL, '')
    .replace(/[آأإٱ]/g, 'ا') // آ أ إ ٱ → ا
    .replace(/ى/g, 'ي') // ى → ي
    .replace(/ة/g, 'ه') // ة → ه
    .replace(/ؤ/g, 'و') // ؤ → و
    .replace(/ئ/g, 'ي') // ئ → ي
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

export function normalizeText(input: string): string {
  return normalizeArabic(input)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // Latin accents
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function tokenize(input: string): string[] {
  const n = normalizeText(input);
  return n ? n.split(' ') : [];
}

const AR_DEFINITE = /^(?:ال|وال|بال|فال|لل)(?=\p{L}{2,})/u;

/**
 * Terms to index for one token. Arabic words starting with the definite article
 * are also indexed without it, so "فيل" finds "الفيل".
 */
export function expandTerm(term: string): string[] {
  const stripped = term.replace(AR_DEFINITE, '');
  return stripped !== term ? [term, stripped] : [term];
}

/** Stable key for duplicate detection across playlists: normalized title + year. */
export function matchKey(title: string, year?: number): string {
  return `${normalizeText(title)}|${year ?? ''}`;
}
