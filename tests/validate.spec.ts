import { describe, expect, it } from 'vitest';
import {
  legalIdChecksumValid,
  nationalCodeChecksumValid,
  validateEmail,
  validateEn,
  validateLegalId,
  validateNationalCode,
  validatePassphrase,
} from '../src/core/validate';

describe('English fields (ASCII, no space, capital first letter)', () => {
  it('accepts a name with a capital first letter and no spaces', () => {
    expect(validateEn('IranCenterForEcommerceDevelopment').ok).toBe(true);
    expect(validateEn('Ali').ok).toBe(true);
    expect(validateEn('Ahmadi').ok).toBe(true);
  });

  it('rejects non-ASCII characters', () => {
    const r = validateEn('مرکزDoe');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('ASCII');
  });

  it('rejects spaces', () => {
    const r = validateEn('Iran Center');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('فاصله');
  });

  it('rejects a lowercase first letter', () => {
    const r = validateEn('iranCenter');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('بزرگ');
  });
});

describe('national code (کد ملی, 10 digits) check digit', () => {
  it('accepts a valid known code', () => {
    // computed with the standard algorithm: prefix 495892753 -> r=0 -> check digit 0
    expect(nationalCodeChecksumValid([4, 9, 5, 8, 9, 2, 7, 5, 3, 0])).toBe(true); // 4958927530
    // another: prefix 495892754 -> r=2 -> check digit 9
    expect(nationalCodeChecksumValid([4, 9, 5, 8, 9, 2, 7, 5, 4, 9])).toBe(true); // 4958927549
  });

  it('rejects an invalid checksum', () => {
    expect(nationalCodeChecksumValid([4, 9, 5, 8, 9, 2, 7, 5, 3, 5])).toBe(false);
  });

  it('validateNationalCode rejects all-same digits', () => {
    const r = validateNationalCode('0000000000');
    expect(r.error).toBeDefined();
    expect(r.ok).toBe(false);
  });

  it('wrong length is an error', () => {
    expect(validateNationalCode('12345').error).toBeDefined();
    expect(validateNationalCode('1234567890123').error).toBeDefined();
  });

  it('non-digits are an error', () => {
    expect(validateNationalCode('12345abcde').error).toBeDefined();
  });

  it('checksum failure is only a warning (override allowed)', () => {
    const r = validateNationalCode('4958927535');
    expect(r.ok).toBe(true);
    expect(r.warning).toBeDefined();
  });

  it('converts Persian digits first', () => {
    const r = validateNationalCode('۴۹۵۸۹۲۷۵۳۰');
    expect(r.ok).toBe(true);
    expect(r.error).toBeUndefined();
  });
});

describe('legal ID (شناسه ملی, 11 digits) check digit', () => {
  it('14000405500 (the guide worked example) passes', () => {
    expect(validateLegalId('14000405500').ok).toBe(true);
    expect(legalIdChecksumValid([1, 4, 0, 0, 0, 4, 0, 5, 5, 0, 0])).toBe(true);
  });

  it('another valid legal id passes', () => {
    // 10101787660 — commonly published valid example
    expect(legalIdChecksumValid([1, 0, 1, 0, 1, 7, 8, 7, 6, 6, 0])).toBe(true);
  });

  it('rejects an invalid checksum as warning', () => {
    const r = validateLegalId('14000405501');
    expect(r.ok).toBe(true);
    expect(r.warning).toBeDefined();
  });

  it('wrong length / non-digits are errors', () => {
    expect(validateLegalId('1400040550').error).toBeDefined();
    expect(validateLegalId('140004055001').error).toBeDefined();
    expect(validateLegalId('140004000aa').error).toBeDefined();
  });
});

describe('email validation', () => {
  it('empty is optional -> ok', () => {
    expect(validateEmail('').ok).toBe(true);
  });
  it('simple addresses pass', () => {
    expect(validateEmail('sysadmin@ecdev.ir').ok).toBe(true);
  });
  it('bad formats fail with a Persian message', () => {
    expect(validateEmail('not-an-email').ok).toBe(false);
    expect(validateEmail('a@b').ok).toBe(false);
  });
  it('non-ASCII is rejected', () => {
    expect(validateEmail('علی@ecdev.ir').ok).toBe(false);
  });
});

describe('passphrase policy', () => {
  it('rejects shorter than 12 chars', () => {
    expect(validatePassphrase('short').ok).toBe(false);
    expect(validatePassphrase('............').ok).toBe(true);
  });
});
