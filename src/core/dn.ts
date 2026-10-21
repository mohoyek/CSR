import * as asn1js from 'asn1js';
import {
  fieldById,
  getProfile,
  presenceOf,
  type CertType,
  type FieldDef,
  type ProfileDef,
  type ProfileId,
} from './profiles';
import { normalize, normalizeNumeric } from './normalize';
import { validateLanguage, type FieldResult } from './validate';

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export interface RdnValue {
  oid: string;
  shortName: string;
  configName: string;
  value: string;
  asn1Type: 'UTF8String' | 'PrintableString' | 'IA5String';
}

export type FormValues = Partial<Record<string, string>>;

/* ------------------------------------------------------------------ */
/* CN building — suffixes are auto-appended; users never type them     */
/* ------------------------------------------------------------------ */

/**
 * Build the CN string from the profile template and the cn inputs.
 * Returns null if any cn input is still empty.
 */
export function buildCn(profile: ProfileDef, values: FormValues): string | null {
  const params: Record<string, string> = {};
  for (const f of profile.fields) {
    if (!f.cnInput) continue;
    const v = values[f.id];
    const nv = f.numeric ? normalizeNumeric(v ?? '') : normalize(v ?? '');
    if (nv.value === '') return null; // still empty — no CN yet
    params[f.id] = nv.value;
  }
  let cn = profile.cn.template;
  for (const [key, value] of Object.entries(params)) cn = cn.split(`{${key}}`).join(value);
  return cn;
}

/* ------------------------------------------------------------------ */
/* Normalization + validation of the form                             */
/* ------------------------------------------------------------------ */

export interface NormalizedForm {
  values: Record<string, string>;
  /** field id -> validation result (only for fields evaluated) */
  results: Record<string, FieldResult>;
  valid: boolean;
  hasWarning: boolean;
}

/** Normalize and validate every visible field of the profile/type */
export function normalizeAndValidate(
  profile: ProfileDef,
  type: CertType,
  rawValues: FormValues
): NormalizedForm {
  const values: Record<string, string> = {};
  const results: Record<string, FieldResult> = {};
  let valid = true;
  let hasWarning = false;

  for (const f of profile.fields) {
    const presence = presenceOf(f, type);
    if (presence === 'absent') continue;
    const raw = rawValues[f.id] ?? '';
    const normalized = f.numeric ? normalizeNumeric(raw) : normalize(raw);
    values[f.id] = normalized.value;
    if (normalized.value === '') {
      if (presence === 'required') {
        results[f.id] = { ok: false, error: 'این فیلد الزامی است' };
        valid = false;
      }
      continue;
    }
    const langResult = validateLanguage(normalized.value, f.lang as 'En' | 'Fa' | 'All');
    const final =
      'error' in langResult && langResult.error
        ? langResult
        : f.validate
          ? f.validate(normalized.value)
          : langResult;
    results[f.id] = final;
    if (final.error !== undefined) valid = false;
    if (final.warning !== undefined) hasWarning = true;
  }
  return { values, results, valid, hasWarning };
}

/* ------------------------------------------------------------------ */
/* Subject RDN construction (guide's exact order + encoding)          */
/* ------------------------------------------------------------------ */

/** Fixed attribute value for the o / c tokens */
function fixedValue(token: string, type: CertType, profile: ProfileDef): string {
  switch (token) {
    case 'o':
      return profile.fixedO ? profile.fixedO[type] : '';
    case 'c':
      return profile.fixedC;
    default:
      return '';
  }
}

/** Build the ordered RDN list for the (already validated) form values */
export function buildSubjectRdns(
  profileId: ProfileId,
  type: CertType,
  values: FormValues
): RdnValue[] {
  const profile = getProfile(profileId);
  const rdns: RdnValue[] = [];

  for (const token of profile.subjectOrder) {
    // fixed fields
    if (token === 'o' || token === 'c') {
      const value = fixedValue(token, type, profile);
      if (value === '') continue;
      const f: FieldDef =
        token === 'o'
          ? {
              id: 'o',
              oid: '2.5.4.10',
              shortName: 'O',
              configName: 'O',
              label: 'O',
              lang: 'En',
              asn1Type: 'UTF8String',
              presence: {},
            }
          : {
              id: 'c',
              oid: '2.5.4.6',
              shortName: 'C',
              configName: 'C',
              label: 'C',
              lang: 'En',
              asn1Type: 'PrintableString',
              presence: {},
            };
      rdns.push({
        oid: f.oid,
        shortName: f.shortName,
        configName: f.configName,
        value,
        asn1Type: f.asn1Type,
      });
      continue;
    }
    if (token === 'cn') {
      const cn = buildCn(profile, values);
      if (cn === null) continue; // not ready yet — preview shows partial subject
      rdns.push({ oid: '2.5.4.3', shortName: 'CN', configName: 'CN', value: cn, asn1Type: 'UTF8String' });
      continue;
    }
    const field = fieldById(profile, token);
    if (!field) throw new Error(`Profile ${profileId}: subjectOrder token "${token}" has no field`);
    if (presenceOf(field, type) === 'absent') continue;
    const value = values[token];
    if (value === undefined || value === '') continue; // optional + empty -> omitted entirely
    rdns.push({
      oid: field.oid,
      shortName: field.shortName,
      configName: field.configName,
      value,
      asn1Type: field.asn1Type,
    });
  }
  return rdns;
}

/* ------------------------------------------------------------------ */
/* Previews                                                           */
/* ------------------------------------------------------------------ */

/** Subject line in `openssl req -subject` style: CN=..., serialNumber=..., ... */
export function subjectLine(rdns: RdnValue[]): string {
  return rdns.map((r) => `${r.shortName}=${r.value}`).join(', ');
}

/** Equivalent OpenSSL config.txt in the guide's format */
export function opensslConfig(rdns: RdnValue[]): string {
  const lines = [
    '[req]',
    'prompt = no',
    'distinguished_name = dn',
    '',
    '[dn]',
    ...rdns.map((r) => `${r.configName} = ${r.value}`),
  ];
  return lines.join('\n') + '\n';
}

/* ------------------------------------------------------------------ */
/* ASN.1 — Name structure for pkijs                                   */
/* ------------------------------------------------------------------ */

/**
 * Encode a value with the OpenSSL-observed ASN.1 string type.
 * Returns the asn1js value object for use in AttributeTypeAndValue.
 */
export function encodeRdnValue(
  asn1Type: RdnValue['asn1Type'],
  value: string
): asn1js.Utf8String | asn1js.PrintableString | asn1js.IA5String {
  switch (asn1Type) {
    case 'PrintableString':
      return new asn1js.PrintableString({ value });
    case 'IA5String':
      return new asn1js.IA5String({ value });
    default:
      return new asn1js.Utf8String({ value });
  }
}
