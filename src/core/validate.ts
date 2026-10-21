import { digitsToAscii, isAsciiOnly, hasLatinLetters } from './normalize';

/** A field validation result; messages are Persian and shown inline next to the field. */
export interface FieldResult {
  ok: boolean;
  error?: string;
  warning?: string;
}

const okResult: FieldResult = { ok: true };

/* ------------------------------------------------------------------ */
/* Check-digit algorithms (exact formulas from the spec, section 5)    */
/* ------------------------------------------------------------------ */

/**
 * Iranian national code (کد ملی, 10 digits) check digit.
 * s = Σ d[i] * (10 - i) for i = 0..8, r = s % 11;
 * valid if (r < 2 and d9 == r) or (r >= 2 and d9 == 11 - r).
 */
export function nationalCodeChecksumValid(digits: number[]): boolean {
  let s = 0;
  for (let i = 0; i < 9; i++) s += digits[i]! * (10 - i);
  const r = s % 11;
  const d9 = digits[9]!;
  return r < 2 ? d9 === r : d9 === 11 - r;
}

/**
 * Iranian legal person national ID (شناسه ملی, 11 digits) check digit.
 * dec = d[9] + 2; coefs = [29,27,23,19,17] repeated twice;
 * s = Σ (d[i] + dec) * coef[i] for i = 0..9, r = s % 11;
 * if r == 10 then r = 0; valid if r == d[10].
 */
export function legalIdChecksumValid(digits: number[]): boolean {
  const coef = [29, 27, 23, 19, 17, 29, 27, 23, 19, 17];
  const dec = digits[9]! + 2;
  let s = 0;
  for (let i = 0; i < 10; i++) s += (digits[i]! + dec) * coef[i]!;
  let r = s % 11;
  if (r === 10) r = 0;
  return r === digits[10]!;
}

/* ------------------------------------------------------------------ */
/* Field validators                                                    */
/* ------------------------------------------------------------------ */

export function validateNationalCode(raw: string): FieldResult {
  const digits = digitsToAscii(raw);
  if (!/^\d*$/.test(digits)) return { ok: false, error: 'کد ملی باید فقط شامل ارقام باشد' };
  if (digits.length !== 10) return { ok: false, error: 'کد ملی باید دقیقاً ۱۰ رقم باشد' };
  const arr = [...digits].map((d) => Number(d));
  if (arr.every((d) => d === arr[0])) return { ok: false, error: 'کد ملی با همهٔ ارقام یکسان معتبر نیست' };
  if (!nationalCodeChecksumValid(arr))
    return { ok: true, warning: 'رقم کنترل کد ملی با الگوریتم استاندارد هم‌خوان نیست — در صورت اطمینان می‌توانید ادامه دهید' };
  return okResult;
}

export function validateLegalId(raw: string): FieldResult {
  const digits = digitsToAscii(raw);
  if (!/^\d*$/.test(digits)) return { ok: false, error: 'شناسه ملی باید فقط شامل ارقام باشد' };
  if (digits.length !== 11) return { ok: false, error: 'شناسه ملی باید دقیقاً ۱۱ رقم باشد' };
  const arr = [...digits].map((d) => Number(d));
  if (!legalIdChecksumValid(arr))
    return { ok: true, warning: 'رقم کنترل شناسهٔ ملی با الگوریتم استاندارد هم‌خوان نیست — در صورت اطمینان می‌توانید ادامه دهید' };
  return okResult;
}

/** رقمی ولی آزاد (مثل شناسه دفتر) — فقط ارقام */
export function validateDigitsOnly(raw: string): FieldResult {
  const digits = digitsToAscii(raw);
  if (!/^\d+$/.test(digits)) return { ok: false, error: 'این فیلد باید فقط شامل ارقام باشد' };
  return okResult;
}

/**
 * فیلد انگلیسی: فقط ASCII، بدون فاصله، و با حرف اول بزرگ.
 * مثال: `IranCenterForEcommerceDevelopment`
 */
export function validateEn(value: string): FieldResult {
  if (!isAsciiOnly(value))
    return { ok: false, error: 'در این فیلد فقط نویسه‌های انگلیسی (ASCII) مجاز است' };
  if (/\s/.test(value)) return { ok: false, error: 'این فیلد باید بدون فاصله نوشته شود' };
  if (!/^[A-Z]/.test(value)) return { ok: false, error: 'حرف اول باید بزرگ باشد' };
  return okResult;
}

/** فیلد فارسی: در صورت وجود حروف لاتین فقط هشدار */
export function validateFa(value: string): FieldResult {
  if (isAsciiOnly(value) && hasLatinLetters(value))
    return { ok: true, warning: 'در فیلد فارسی حروف لاتین دیده می‌شود — بررسی کنید' };
  return okResult;
}

export function validateEmail(raw: string): FieldResult {
  if (raw === '') return okResult; // optional
  if (!isAsciiOnly(raw)) return { ok: false, error: 'نشانی رایانامه باید فقط شامل نویسه‌های انگلیسی باشد' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return { ok: false, error: 'قالب نشانی رایانامه صحیح نیست (مثال: sysadmin@ecdev.ir)' };
  return okResult;
}

/** Combined check for a value with a declared language */
export function validateLanguage(value: string, lang: 'En' | 'Fa' | 'All'): FieldResult {
  switch (lang) {
    case 'En':
      return validateEn(value);
    case 'Fa':
      return validateFa(value);
    default:
      return okResult;
  }
}

/* Passphrase ------------------------------------------------------- */

export const PASSPHRASE_MIN_LENGTH = 12;

export function validatePassphrase(pass: string): FieldResult {
  if (pass.length < PASSPHRASE_MIN_LENGTH)
    return { ok: false, error: `رمز باید حداقل ${PASSPHRASE_MIN_LENGTH} نویسه باشد` };
  return okResult;
}

export function passphrasesMatch(pass: string, confirm: string): FieldResult {
  if (pass !== confirm) return { ok: false, error: 'رمز و تکرار آن یکسان نیستند' };
  return okResult;
}

/** Very rough strength hint (0..4) for the UI */
export function passphraseStrength(pass: string): number {
  let score = 0;
  if (pass.length >= 12) score++;
  if (pass.length >= 20) score++;
  if (/[a-z]/.test(pass) && /[A-Z]/.test(pass)) score++;
  if (/\d/.test(pass)) score++;
  if (/[^\dA-Za-z]/.test(pass)) score++;
  return Math.min(score, 4);
}
