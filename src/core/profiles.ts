/**
 * Certificate profiles — the single source of truth (data, not scattered logic).
 * Derived from: GICA.SW.User.CertProfilev1.0 rev 1.0 (1404/07/25), appendices 1–3.
 *
 * Presence map: a type missing from `presence` means the field does not exist
 * for that certificate type (footnote of the guide's appendix tables).
 */

import {
  validateDigitsOnly,
  validateEmail,
  validateEn,
  validateLanguage,
  validateLegalId,
  validateNationalCode,
  type FieldResult,
} from './validate';
import {
  ASSUMED_CN_TEMPLATE_P3,
  ASSUMED_PROFILE_1_SUBJECT_ORDER,
  ASSUMED_PROFILE_2_SUBJECT_ORDER,
  ASSUMED_PROFILE_3_SUBJECT_ORDER,
} from './assumptions';

export type CertType = 'Gov' | 'NGO' | 'Una';
export type Lang = 'En' | 'Fa' | 'All';
/** ASN.1 string types observed in the guide's OpenSSL 3 output (see README, section 4) */
export type Asn1StringType = 'UTF8String' | 'PrintableString' | 'IA5String';
export type Presence = 'required' | 'optional' | 'absent';

/** Per-certificate-type presence; absent key = field does not exist for that type */
export type PresenceMap = Partial<Record<CertType, Presence>>;

export interface FieldDef {
  id: string;
  /** dotted OID (empty string = form-only input that composes the CN) */
  oid: string;
  /** OpenSSL short name, used in the subject-line preview */
  shortName: string;
  /** name used in the equivalent config.txt */
  configName: string;
  /** Persian label shown in the UI */
  label: string;
  lang: Lang;
  asn1Type: Asn1StringType;
  presence: PresenceMap;
  /** digits-only field (Persian/Arabic digits converted) */
  numeric?: boolean;
  /** optional per-field validator over the normalized value */
  validate?: (value: string) => FieldResult;
  /** sample value shown as helper text */
  sample?: string;
  /** extra helper text shown under the field */
  hint?: string;
  /** OU slot: 'org' = organization-name OU (emitted last), n = unit slot (emitted in descending order) */
  ouSlot?: 'org' | 1 | 2 | 3;
  /** this field is an input that only composes the CN template */
  cnInput?: boolean;
}

export interface ProfileDef {
  id: 1 | 2 | 3;
  /** Persian title */
  title: string;
  certTypes: CertType[];
  fields: FieldDef[];
  /** CN field (computed) */
  cn: {
    /** user-facing Persian label of the CN itself */
    label: string;
    template: string; // e.g. '{given} {family} [Sign]'
  };
  /** DN emission order: tokens referencing fields — see section 10 (assumptions) */
  subjectOrder: string[];
  /** fixed O value per certificate type */
  fixedO: Record<CertType, string> | null;
  /** fixed C value */
  fixedC: string;
}

/* ------------------------------------------------------------------ */
/* CN templates (kept as constants; the user never types the suffixes) */
/* ------------------------------------------------------------------ */

export const CN_TEMPLATE_P1 = '{cnGiven} {cnFamily} [Sign]';
export const CN_TEMPLATE_P2 = '{cnOrgNameEn} [Stamp]';
/** Profile 3 template literal — exact punctuation is an open assumption (README, #3) */
export const CN_TEMPLATE_P3 = ASSUMED_CN_TEMPLATE_P3;

/* Fixed attribute values */
export const FIXED_COUNTRY = 'IR';
export const FIXED_O: Record<CertType, string> = {
  Gov: 'Governmental',
  NGO: 'Non-Governmental',
  Una: 'Unaffiliated',
};

/* ------------------------------------------------------------------ */
/* Field ids (form model keys)                                        */
/* ------------------------------------------------------------------ */

export type FieldId =
  | 'c'
  | 'o'
  | 'ouOrg'
  | 'cnGiven'
  | 'cnFamily'
  | 'cnOrgNameEn'
  | 'raName'
  | 'raNationalCode'
  | 'e'
  | 'serialNumber'
  | 'sn'
  | 'gn'
  | 'title'
  | 'orgId'
  | 'st'
  | 'l';

/* ASN.1 types per OpenSSL 3 observation (all inputs share these rules):
 *   C and serialNumber: PrintableString
 *   E (emailAddress): IA5String
 *   everything else, including all-ASCII values: UTF8String                     */
const UTF8: Asn1StringType = 'UTF8String';
const PRINTABLE: Asn1StringType = 'PrintableString';
const IA5: Asn1StringType = 'IA5String';

/** validateNationalCode but warning-only on checksum; length/non-digits are errors */
function validateNationalCodeField(v: string): FieldResult {
  return validateNationalCode(v);
}

/** OU slots shared by appending profiles: organization name (required) + up to 3 units (optional) */
function emailField(): FieldDef {
  return {
    id: 'e',
    oid: '1.2.840.113549.1.9.1',
    shortName: 'E',
    configName: 'emailAddress',
    label: 'نشانی رایانامه',
    // the guide's appendix tables leave the language of E unspecified ("-"),
    // so it is unrestricted; the format is still validated below
    lang: 'All',
    asn1Type: IA5,
    presence: { Gov: 'optional', NGO: 'optional', Una: 'optional' },
    validate: validateEmail,
    hint: 'قالب نشانی رایانامه: name@example.com',
    sample: 'sysadmin@ecdev.ir',
  };
}

/** Per-profile serialNumber field (10/11 digits — different check-digit algorithms) */
function nationalCodeField(): FieldDef {
  return {
    id: 'serialNumber',
    oid: '2.5.4.5',
    shortName: 'serialNumber',
    configName: 'serialNumber',
    label: 'کد (شناسه) ملی متقاضی (۱۰ رقم)',
    lang: 'All',
    asn1Type: PRINTABLE,
    presence: { Gov: 'required', NGO: 'required', Una: 'required' },
    numeric: true,
    validate: validateNationalCode,
    sample: '4958927530',
  };
}

function legalIdField(): FieldDef {
  return {
    id: 'serialNumber',
    oid: '2.5.4.5',
    shortName: 'serialNumber',
    configName: 'serialNumber',
    label: 'شناسه ملی شخص حقوقی — کد ملی شرکت (۱۱ رقم)',
    lang: 'All',
    asn1Type: PRINTABLE,
    presence: { Gov: 'required', NGO: 'required' },
    numeric: true,
    validate: validateLegalId,
    sample: '14000405500',
  };
}

function raOfficeIdField(): FieldDef {
  return {
    id: 'serialNumber',
    oid: '2.5.4.5',
    shortName: 'serialNumber',
    configName: 'serialNumber',
    label: 'شناسه دفتر ثبت‌نام',
    lang: 'En',
    asn1Type: PRINTABLE,
    presence: { Gov: 'required', NGO: 'required' },
    numeric: true,
    validate: validateDigitsOnly,
    sample: '14020001',
  };
}

/**
 * OU سازمان — فقط «نام سازمان» (بدون واحدهای ۱ تا ۳).
 * واحدهای سازمانی طبق درخواست حذف شده‌اند؛ خروجی فقط یک `1.OU` دارد،
 * دقیقاً مثل نمونهٔ کاربردی راهنما.
 */
function ouFields(orgLabel: string, orgSample: string): FieldDef[] {
  return [
    {
      id: 'ouOrg',
      oid: '2.5.4.11',
      shortName: 'OU',
      configName: '1.OU',
      label: orgLabel,
      lang: 'Fa',
      asn1Type: UTF8,
      presence: { Gov: 'required', NGO: 'required' },
      ouSlot: 'org',
      sample: orgSample,
    },
  ];
}

const provinceCity: FieldDef[] = [
  {
    id: 'st',
    oid: '2.5.4.8',
    shortName: 'ST',
    configName: 'ST',
    label: 'نام استان',
    lang: 'Fa',
    asn1Type: UTF8,
    presence: { Gov: 'required', NGO: 'required', Una: 'required' },
    sample: 'تهران',
  },
  {
    id: 'l',
    oid: '2.5.4.7',
    shortName: 'L',
    configName: 'L',
    label: 'نام شهرستان',
    lang: 'Fa',
    asn1Type: UTF8,
    presence: { Gov: 'required', NGO: 'required', Una: 'required' },
    sample: 'تهران',
  },
];

const orgIdField: FieldDef = {
  id: 'orgId',
  oid: '2.5.4.97',
  shortName: 'organizationIdentifier',
  configName: 'organizationIdentifier',
  label: 'شناسه سازمان (GUID/کد شناسهٔ سازمان)',
  lang: 'All',
  asn1Type: UTF8,
  presence: { Gov: 'required', NGO: 'required' },
  numeric: true,
  validate: validateDigitsOnly,
  sample: '14000405500',
};

/* ------------------------------------------------------------------ */
/* Profile 1 — امضای شخص حقیقی (پیوست ۱)                              */
/* ------------------------------------------------------------------ */

const naturalPersonFields: FieldDef[] = [
  nationalCodeField(),
  emailField(),
  ...ouFields('نام سازمان', 'مرکز توسعه تجارت الکترونیکی'),
  {
    id: 'cnGiven',
    oid: '',
    shortName: 'CN',
    configName: 'CN',
    label: 'نام (لاتین)',
    lang: 'En',
    asn1Type: UTF8,
    presence: { Gov: 'required', NGO: 'required', Una: 'required' },
    validate: validateEn,
    cnInput: true,
    sample: 'Ali',
  },
  {
    id: 'cnFamily',
    oid: '',
    shortName: 'CN',
    configName: 'CN',
    label: 'نام خانوادگی (لاتین)',
    lang: 'En',
    asn1Type: UTF8,
    presence: { Gov: 'required', NGO: 'required', Una: 'required' },
    validate: validateEn,
    cnInput: true,
    sample: 'Ahmadi',
  },
  {
    id: 'sn',
    oid: '2.5.4.4',
    shortName: 'SN',
    configName: 'surname',
    label: 'نام خانوادگی متقاضی (فارسی)',
    lang: 'Fa',
    asn1Type: UTF8,
    presence: { Gov: 'required', NGO: 'required', Una: 'required' },
    sample: 'احمدی',
  },
  {
    id: 'gn',
    oid: '2.5.4.42',
    shortName: 'GN',
    configName: 'givenName',
    label: 'نام متقاضی (فارسی)',
    lang: 'Fa',
    asn1Type: UTF8,
    presence: { Gov: 'required', NGO: 'required', Una: 'required' },
    sample: 'علی',
  },
  {
    id: 'title',
    oid: '2.5.4.12',
    shortName: 'title',
    configName: 'title',
    label: 'نقش یا سمت متقاضی در سازمان',
    lang: 'All',
    asn1Type: UTF8,
    presence: { Gov: 'required', NGO: 'required' },
    sample: 'کارشناس فناوری اطلاعات',
  },
  orgIdField,
  ...provinceCity,
];

/* ------------------------------------------------------------------ */
/* Profile 2 — امضای شخص حقوقی / مهر سازمانی (پیوست ۲)                 */
/* ------------------------------------------------------------------ */

const legalPersonFields: FieldDef[] = [
  legalIdField(),
  emailField(),
  ...ouFields('نام سازمان (فارسی)', 'مرکز توسعه تجارت الکترونیکی'),
  {
    id: 'cnOrgNameEn',
    oid: '',
    shortName: 'CN',
    configName: 'CN',
    label: 'نام کامل سازمان (لاتین)',
    lang: 'En',
    asn1Type: UTF8,
    presence: { Gov: 'required', NGO: 'required' },
    validate: validateEn,
    cnInput: true,
    sample: 'IranCenterForEcommerceDevelopment',
  },
  ...provinceCity,
];

/* ------------------------------------------------------------------ */
/* Profile 3 — دفتر ثبت نام (پیوست ۳)                                  */
/* ------------------------------------------------------------------ */

const raOfficeFields: FieldDef[] = [
  raOfficeIdField(),
  ...ouFields('نام دفتر ثبت‌نام (فارسی)', 'دفتر ثبت‌نام مرکزی'),
  {
    id: 'raName',
    oid: '',
    shortName: 'CN',
    configName: 'CN',
    label: 'نام دفتر ثبت‌نام (لاتین) — RaName',
    lang: 'En',
    asn1Type: UTF8,
    presence: { Gov: 'required', NGO: 'required' },
    validate: validateEn,
    cnInput: true,
    sample: 'CentralRegistrationOffice',
  },
  {
    id: 'raNationalCode',
    oid: '',
    shortName: 'CN',
    configName: 'CN',
    label: 'کد ملی (برای CN)',
    lang: 'All',
    asn1Type: UTF8,
    presence: { Gov: 'required', NGO: 'required' },
    numeric: true,
    validate: validateNationalCodeField,
    cnInput: true,
    sample: '4958927530',
  },
  {
    id: 'sn',
    oid: '2.5.4.4',
    shortName: 'SN',
    configName: 'surname',
    label: 'نام خانوادگی (فارسی)',
    lang: 'Fa',
    asn1Type: UTF8,
    presence: { Gov: 'required', NGO: 'required' },
    sample: 'احمدی',
  },
  {
    id: 'gn',
    oid: '2.5.4.42',
    shortName: 'GN',
    configName: 'givenName',
    label: 'نام (فارسی)',
    lang: 'Fa',
    asn1Type: UTF8,
    presence: { Gov: 'required', NGO: 'required' },
    sample: 'علی',
  },
  ...provinceCity,
];

/* ------------------------------------------------------------------ */
/* Profiles                                                            */
/* ------------------------------------------------------------------ */

export const PROFILES: ProfileDef[] = [
  {
    id: 1,
    title: 'گواهی امضای شخص حقیقی',
    // فقط شخص حقیقی مستقل (Unaffiliated)
    certTypes: ['Una'],
    fields: naturalPersonFields,
    cn: { label: 'CN (نام لاتین + [Sign])', template: CN_TEMPLATE_P1 },
    subjectOrder: [...ASSUMED_PROFILE_1_SUBJECT_ORDER],
    fixedO: FIXED_O,
    fixedC: FIXED_COUNTRY,
  },
  {
    id: 2,
    title: 'گواهی امضای شخص حقوقی',
    // فقط سازمان غیردولتی (Non-Governmental)
    certTypes: ['NGO'],
    fields: legalPersonFields,
    cn: { label: 'CN (نام کامل لاتین سازمان + [Stamp])', template: CN_TEMPLATE_P2 },
    subjectOrder: [...ASSUMED_PROFILE_2_SUBJECT_ORDER],
    fixedO: FIXED_O,
    fixedC: FIXED_COUNTRY,
  },
  {
    id: 3,
    title: 'گواهی دفتر ثبت‌نام',
    certTypes: ['Gov', 'NGO'],
    fields: raOfficeFields,
    cn: { label: 'CN (RaName. RA [کد ملی])', template: CN_TEMPLATE_P3 },
    subjectOrder: [...ASSUMED_PROFILE_3_SUBJECT_ORDER],
    fixedO: FIXED_O,
    fixedC: FIXED_COUNTRY,
  },
];

export type ProfileId = 1 | 2 | 3;

export function getProfile(id: ProfileId): ProfileDef {
  const p = PROFILES.find((x) => x.id === id);
  if (!p) throw new Error(`Profile ${id} is not defined`);
  return p;
}

/** Presence of a field for the selected certificate type */
export function presenceOf(field: FieldDef, type: CertType): Presence {
  return field.presence[type] ?? 'absent';
}

/** Fields visible in the form for a profile + type */
export function visibleFields(profile: ProfileDef, type: CertType): FieldDef[] {
  return profile.fields.filter((f) => presenceOf(f, type) !== 'absent');
}

export function fieldById(profile: ProfileDef, id: string): FieldDef | undefined {
  return profile.fields.find((f) => f.id === id);
}

export { validateLanguage, validateLegalId };
