/**
 * پیش‌تنظیم سازمان — یک فایل JSON شامل داده‌های غیرمحرمانهٔ سازمان
 * تا کاربران مجبور نباشند هر بار نام سازمان، واحدها، استان و شهر را
 * دوباره تایپ کنند.
 *
 * این ماژول به‌هیچ‌وجه کلید یا رمز عبور را ذخیره یا صادر نمی‌کند؛
 * هنگام واردسازی، هر کلید ناشناخته (و هر چیزی که شبیه کلید/رمز باشد)
 * دور ریخته می‌شود.
 */

import type { CertType } from './profiles';

export const ORG_PRESET_FORMAT = 'gica-csr-org-preset';
export const ORG_PRESET_VERSION = 1;

export interface OrgPreset {
  format: typeof ORG_PRESET_FORMAT;
  version: number;
  createdAt: string;
  organization: {
    /** نام سازمان به فارسی (OU اصلی) */
    name: string;
    /** نام کامل سازمان به لاتین (برای CN پروفایل ۲) */
    nameEn: string;
    /** شناسه سازمان (۲.۵.۴.۹۷) */
    identifier: string;
    /** نام واحدهای سازمانی — حداکثر سه واحد */
    units: string[];
    /** استان */
    province: string;
    /** شهرستان */
    city: string;
    /** نوع گواهی: دولتی / غیردولتی / مستقل */
    certType: CertType;
  };
}

/** کلیدهایی که هرگز نباید در پیش‌تنظیم ذخیره شوند */
const FORBIDDEN_KEYS = [
  'key',
  'keys',
  'privatekey',
  'private_key',
  'secret',
  'passphrase',
  'password',
  'pass',
  'token',
  'pfx',
  'pem',
  'csr',
];

/** کلیدهای مجاز در بخش organization */
const ALLOWED_ORG_KEYS: (keyof OrgPreset['organization'])[] = [
  'name',
  'nameEn',
  'identifier',
  'units',
  'province',
  'city',
  'certType',
];

function isForbidden(key: string): boolean {
  const k = key.toLowerCase().replace(/[\s_-]/g, '');
  return FORBIDDEN_KEYS.some((f) => k.includes(f));
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asCertType(value: unknown): CertType {
  return value === 'Gov' || value === 'NGO' || value === 'Una' ? value : 'NGO';
}

/** ساخت پیش‌تنظیم از داده‌های فرم */
export function buildOrgPreset(input: {
  name: string;
  nameEn: string;
  identifier: string;
  units: string[];
  province: string;
  city: string;
  certType: CertType;
}): OrgPreset {
  return {
    format: ORG_PRESET_FORMAT,
    version: ORG_PRESET_VERSION,
    createdAt: new Date().toISOString(),
    organization: {
      name: input.name,
      nameEn: input.nameEn,
      identifier: input.identifier,
      units: input.units.slice(0, 3),
      province: input.province,
      city: input.city,
      certType: input.certType,
    },
  };
}

/**
 * خواندن و اعتبارسنجی یک فایل پیش‌تنظیم.
 * هر فیلد ناشناخته یا حساس نادیده گرفته می‌شود.
 */
export function parseOrgPreset(text: string): OrgPreset {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('فایل پیش‌تنظیم معتبر نیست (JSON خوانده نشد)');
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('فایل پیش‌تنظیم معتبر نیست');
  }
  const obj = raw as Record<string, unknown>;
  if (obj['format'] !== ORG_PRESET_FORMAT) {
    throw new Error('این فایل، پیش‌تنظیم سازمان این ابزار نیست');
  }
  const orgRaw = (obj['organization'] ?? {}) as Record<string, unknown>;
  const organization = {
    name: asString(orgRaw['name']),
    nameEn: asString(orgRaw['nameEn']),
    identifier: asString(orgRaw['identifier']),
    units: Array.isArray(orgRaw['units'])
      ? orgRaw['units'].slice(0, 3).map((u) => asString(u))
      : [],
    province: asString(orgRaw['province']),
    city: asString(orgRaw['city']),
    certType: asCertType(orgRaw['certType']),
  };
  // discard anything that is not an allowed organization field
  for (const key of Object.keys(orgRaw)) {
    if (isForbidden(key) || !ALLOWED_ORG_KEYS.includes(key as keyof OrgPreset['organization'])) {
      delete orgRaw[key];
    }
  }
  return {
    format: ORG_PRESET_FORMAT,
    version: typeof obj['version'] === 'number' ? obj['version'] : ORG_PRESET_VERSION,
    createdAt: asString(obj['createdAt']),
    organization,
  };
}

/** مقادیر پیش‌تنظیم به فرم نگاشت می‌شود (فیلدهای نامرتبط نادیده گرفته می‌شوند) */
export function presetToFormValues(preset: OrgPreset): Record<string, string> {
  const o = preset.organization;
  return {
    ouOrg: o.name,
    cnOrgNameEn: o.nameEn,
    orgId: o.identifier,
    ou1: o.units[0] ?? '',
    ou2: o.units[1] ?? '',
    ou3: o.units[2] ?? '',
    st: o.province,
    l: o.city,
  };
}
