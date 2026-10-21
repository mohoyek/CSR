import { describe, expect, it } from 'vitest';
import { digitsToAscii, hasLatinLetters, isAsciiOnly, normalizeNumeric, normalizeText } from '../src/core/normalize';

describe('normalizeText', () => {
  it('maps Arabic yeh/kaf to Persian yeh/kaf', () => {
    expect(normalizeText('\u064A\u0643')).toBe('\u06CC\u06A9'); // ي ك -> ی ک
  });

  it('removes tatweel (kashida)', () => {
    expect(normalizeText('سـالـمـ')).toBe('سالم');
  });

  it('collapses repeated spaces and trims', () => {
    expect(normalizeText('  علی\u00A0\u00A0  رضا\t\tاحمدی  ')).toBe('علی رضا احمدی');
  });

  it('keeps ZWNJ inside words but strips it at the ends', () => {
    expect(normalizeText('\u200C\u200Cمیهن\u200Cپرست\u200C\u200C')).toBe('میهن\u200Cپرست');
    expect(normalizeText('نیم\u200Cفاصله')).toContain('\u200C');
  });

  it('keeps Persian text in NFC form as-is', () => {
    expect(normalizeText('تهران')).toBe('تهران');
  });

  it('is idempotent', () => {
    const one = normalizeText('  ي ــ علیـ\u200C ');
    expect(normalizeText(one)).toBe(one);
  });
});

describe('digitsToAscii', () => {
  it('converts Persian digits', () => {
    expect(digitsToAscii('۱۴۰۰۰۴۰۵۵۰۰')).toBe('14000405500');
  });

  it('converts Arabic-Indic digits', () => {
    expect(digitsToAscii('١٢٣٤٥٦٧٨٩٠')).toBe('1234567890');
  });

  it('leaves ASCII digits and text untouched', () => {
    expect(digitsToAscii('a1b2')).toBe('a1b2');
  });
});

describe('normalizeNumeric', () => {
  it('normalizes text and digits together', () => {
    expect(normalizeNumeric('پ۸ ـک').value).toBe('پ8 ک');
  });
});

describe('ascii / latin helpers', () => {
  it('isAsciiOnly', () => {
    expect(isAsciiOnly('Iran [Stamp] 1400')).toBe(true);
    expect(isAsciiOnly('تهران')).toBe(false);
    expect(isAsciiOnly('ab\u202Ad')).toBe(false);
  });

  it('hasLatinLetters', () => {
    expect(hasLatinLetters('Iran')).toBe(true);
    expect(hasLatinLetters('تهران')).toBe(false);
  });
});
