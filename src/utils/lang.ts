/** ISO 639-1 -> tesseract language codes. */
const ISO_TO_TESSERACT: Record<string, string> = {
  tr: 'tur', en: 'eng', de: 'deu', fr: 'fra', es: 'spa', it: 'ita', pt: 'por',
  nl: 'nld', ru: 'rus', ar: 'ara', fa: 'fas', el: 'ell', pl: 'pol', uk: 'ukr',
  az: 'aze', ro: 'ron', bg: 'bul', cs: 'ces', hu: 'hun', sv: 'swe', da: 'dan',
  fi: 'fin', no: 'nor', zh: 'chi_sim', ja: 'jpn', ko: 'kor', he: 'heb', hi: 'hin',
};

const TESSERACT_TO_ISO: Record<string, string> = {};
for (const iso of Object.keys(ISO_TO_TESSERACT)) TESSERACT_TO_ISO[ISO_TO_TESSERACT[iso]] = iso;
TESSERACT_TO_ISO['chi_tra'] = 'zh';

function splitLangs(lang?: string | string[]): string[] {
  if (lang === undefined || lang === null) return [];
  const parts = Array.isArray(lang) ? lang : [lang];
  const out: string[] = [];
  for (const part of parts) {
    for (const piece of String(part).split('+')) {
      const trimmed = piece.trim();
      if (trimmed) out.push(trimmed);
    }
  }
  return out;
}

/**
 * Maps ISO 639-1 language codes (`'tr'`, `'tr+en'`, `['tr', 'en']`) to tesseract
 * codes (`'tur'`, `'tur+eng'`). Codes that are not in the ISO table (`'eng'`,
 * `'chi_tra'`, ...) pass through unchanged. Returns `undefined` for an empty input.
 */
export function toTesseractLang(lang?: string | string[]): string | undefined {
  const parts = splitLangs(lang);
  if (parts.length === 0) return undefined;
  return parts.map((p) => ISO_TO_TESSERACT[p.toLowerCase()] ?? p).join('+');
}

/**
 * Inverse of {@link toTesseractLang}: the language list as ISO 639-1 codes (used
 * as `langHint` for handlers). Unknown codes pass through. `undefined` when no
 * language was configured.
 */
export function toIsoLangList(lang?: string | string[]): string[] | undefined {
  const parts = splitLangs(lang);
  if (parts.length === 0) return undefined;
  return parts.map((p) => TESSERACT_TO_ISO[p] ?? p.toLowerCase());
}
