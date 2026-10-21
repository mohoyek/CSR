/**
 * Text normalization per the CSR app spec, section 5.
 * Pure functions only — no React, no DOM, no WebCrypto.
 */

/** Arabic yeh (ي U+064A), alef maksura (ى U+0649) -> Farsi yeh (ی U+06CC); Arabic kaf (ك U+0643) -> Farsi kaf (ک U+06A9) */
const ARABIC_TO_PERSIAN: readonly [RegExp, string][] = [
  [/[\u064A\u0649]/g, '\u06CC'],
  [/\u0643/g, '\u06A9'],
];

/** Tatweel / Arabic kashida (U+0640) */
const TATWEEL = '\u0640';
/** Zero-width non-joiner (kept inside text, stripped at the ends) */
const ZWNJ = '\u200C';

/** Persian digits ۰-۹ (U+06F0..U+06F9) and Arabic-Indic digits ٠-٩ (U+0660..U+0669) */
const PERSIAN_DIGIT_RANGE = /\u06F0-\u06F9/;
const ARABIC_DIGIT_RANGE = /\u0660-\u0669/;

/**
 * Normalize Persian/Arabic text:
 * - Arabic ي/ك/ى -> Persian ی/ک
 * - remove tatweel
 * - collapse repeated whitespace (incl. no-break space) to a single space, trim
 * - keep ZWNJ (U+200C) inside the text but strip it (and any other
 *   invisible control) from the start/end
 */
export function normalizeText(input: string): string {
  let s = input.normalize('NFC');
  s = s.split(TATWEEL).join('');
  for (const [re, replacement] of ARABIC_TO_PERSIAN) s = s.replace(re, replacement);
  s = s.replace(/[ \t\u00A0\u2007\u202F]+/g, ' ');
  s = s.trim();
  // Strip ZWNJ / RLM / LRM / bidi marks from the ends only.
  const edge = new RegExp(`^[${ZWNJ}\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069\\s]+`);
  const edgeEnd = new RegExp(`[${ZWNJ}\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069\\s]+$`);
  s = s.replace(edge, '').replace(edgeEnd, '');
  return s;
}

/** Convert Persian/Arabic-Indic digits to ASCII digits */
export function digitsToAscii(input: string): string {
  return input.replace(new RegExp(`[${PERSIAN_DIGIT_RANGE.source}${ARABIC_DIGIT_RANGE.source}]`, 'g'), (ch) => {
    const code = ch.charCodeAt(0);
    if (code >= 0x06f0 && code <= 0x06f9) return String.fromCharCode(0x30 + (code - 0x06f0));
    return String.fromCharCode(0x30 + (code - 0x0660)); // 0x0660..0x0669
  });
}

/** true if the string contains only ASCII (originally — not after any conversion) */
export function isAsciiOnly(s: string): boolean {
  for (const ch of s) if (ch.charCodeAt(0) > 0x7e || ch.charCodeAt(0) < 0x20) return false;
  return true;
}

/** true if the string contains Latin (A-Z a-z) letters — used for Fa-field warnings */
export function hasLatinLetters(s: string): boolean {
  return /[A-Za-z]/u.test(s);
}

/** Normalized Carrier: value + whether normalization changed the raw input */
export interface NormalizedText {
  value: string;
  changed: boolean;
}

export function normalize(value: string): NormalizedText {
  const normalized = normalizeText(value);
  return { value: normalized, changed: normalized !== value };
}

/** Numeric field: normalize text then convert digits */
export function normalizeNumeric(value: string): NormalizedText {
  const normalized = digitsToAscii(normalizeText(value));
  return { value: normalized, changed: normalized !== value };
}
