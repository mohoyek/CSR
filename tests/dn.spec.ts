import { describe, expect, it } from 'vitest';
import {
  buildCn,
  buildSubjectRdns,
  normalizeAndValidate,
  opensslConfig,
  subjectLine,
} from '../src/core/dn';
import { CN_TEMPLATE_P1, CN_TEMPLATE_P3, getProfile } from '../src/core/profiles';

/** The guide's worked example (appendix 2): مرکز توسعه تجارت الکترونیکی */
const P2_VALUES = {
  serialNumber: '14000405500',
  cnOrgNameEn: 'Iran Center for Ecommerce Development',
  ouOrg: 'مرکز توسعه تجارت الکترونیکی',
  l: 'تهران',
  st: 'تهران',
};

describe('profile 2 (legal person / stamp) subject order', () => {
  it('emits exactly the guide sample order: CN, serialNumber, O, OUs(desc), L, ST, C', () => {
    const rdns = buildSubjectRdns(2, 'NGO', P2_VALUES);
    expect(rdns.map((r) => r.shortName)).toEqual([
      'CN',
      'serialNumber',
      'O',
      'OU',
      'L',
      'ST',
      'C',
    ]);
    // no unit OUs filled -> only the org-name OU (last among the OUs)
    expect(rdns[3]).toMatchObject({ value: 'مرکز توسعه تجارت الکترونیکی', configName: '1.OU' });
    expect(rdns[0]).toMatchObject({ value: 'Iran Center for Ecommerce Development [Stamp]', asn1Type: 'UTF8String' });
    expect(rdns[1]).toMatchObject({ value: '14000405500', asn1Type: 'PrintableString' });
    expect(rdns[2]).toMatchObject({ value: 'Non-Governmental', asn1Type: 'UTF8String' });
    expect(rdns.at(-1)).toMatchObject({ value: 'IR', asn1Type: 'PrintableString' });
  });

  it('shows Governmental for Gov type', () => {
    const rdns = buildSubjectRdns(2, 'Gov', P2_VALUES);
    expect(rdns[2]).toMatchObject({ value: 'Governmental' });
  });

  it('emits numbered OUs around the org-name OU and config text matches guide format', () => {
    const rdns = buildSubjectRdns(2, 'NGO', {
      ...P2_VALUES,
      ou1: 'واحد فناوری',
    });
    const cfg = opensslConfig(rdns);
    expect(cfg.split('\n')).toEqual([
      '[req]',
      'prompt = no',
      'distinguished_name = dn',
      '',
      '[dn]',
      'CN = Iran Center for Ecommerce Development [Stamp]',
      'serialNumber = 14000405500',
      'O = Non-Governmental',
      '2.OU = واحد فناوری',
      '1.OU = مرکز توسعه تجارت الکترونیکی',
      'L = تهران',
      'ST = تهران',
      'C = IR',
    ].concat(''));
  });

  it('subjects with three units emit 4.OU, 3.OU, 2.OU then 1.OU org', () => {
    const rdns = buildSubjectRdns(2, 'Gov', {
      ...P2_VALUES,
      ou1: 'واحد یک',
      ou2: 'واحد دو',
      ou3: 'واحد سه',
    });
    expect(rdns.map((r) => r.configName)).toEqual([
      'CN',
      'serialNumber',
      'O',
      '4.OU',
      '3.OU',
      '2.OU',
      '1.OU',
      'L',
      'ST',
      'C',
    ]);
  });

  it('optional empty fields are omitted entirely (no empty RDNs)', () => {
    const rdns = buildSubjectRdns(2, 'NGO', P2_VALUES);
    expect(rdns.some((r) => r.value === '')).toBe(false);
  });
});

describe('subject line preview', () => {
  it('joins shortName=value in emission order', () => {
    const rdns = buildSubjectRdns(2, 'NGO', P2_VALUES);
    expect(subjectLine(rdns)).toBe(
      'CN=Iran Center for Ecommerce Development [Stamp], serialNumber=14000405500, O=Non-Governmental, OU=مرکز توسعه تجارت الکترونیکی, L=تهران, ST=تهران, C=IR'
    );
  });
});

describe('CN templates', () => {
  it('profile 1: <Latin given> <Latin family> [Sign]', () => {
    expect(CN_TEMPLATE_P1).toBe('{cnGiven} {cnFamily} [Sign]');
    const cn = buildCn(getProfile(1), { cnGiven: 'Ali', cnFamily: 'Ahmadi' });
    expect(cn).toBe('Ali Ahmadi [Sign]');
  });

  it('profile 2: <org latin> [Stamp]', () => {
    const cn = buildCn(getProfile(2), { cnOrgNameEn: 'GICA Development' });
    expect(cn).toBe('GICA Development [Stamp]');
  });

  it('profile 3: RaName. RA [national code] — template kept as one constant', () => {
    expect(CN_TEMPLATE_P3).toBe('{raName}. RA [{raNationalCode}]');
    const cn = buildCn(getProfile(3), { raName: 'CentralOffice', raNationalCode: '4958927534' });
    expect(cn).toBe('CentralOffice. RA [4958927534]');
  });

  it('CN is null while a component is still empty', () => {
    expect(buildCn(getProfile(1), { cnGiven: 'Ali' })).toBeNull();
  });
});

describe('profile 1 (natural person) appendix-1 order with extras after serialNumber', () => {
  const p1Required = {
    serialNumber: '4958927530',
    cnGiven: 'Ali',
    cnFamily: 'Ahmadi',
    sn: 'احمدی',
    gn: 'علی',
    st: 'تهران',
    l: 'تهران',
    orgId: '14000405500',
    ouOrg: 'مرکز توسعه تجارت الکترونیکی',
    title: 'کارشناس',
  };

  it('Gov: extras E/SN/GN/title/orgId right after serialNumber, then O, OUs, L, ST, C', () => {
    const rdns = buildSubjectRdns(1, 'Gov', p1Required);
    expect(rdns.map((r) => r.shortName)).toEqual([
      'CN',
      'serialNumber',
      'SN',
      'GN',
      'title',
      'organizationIdentifier',
      'O',
      'OU',
      'L',
      'ST',
      'C',
    ]);
    expect(rdns.find((r) => r.oid === '2.5.4.97')).toBeDefined();
  });

  it('Una: no OU, no title, no orgIdentifier', () => {
    const rdns = buildSubjectRdns(1, 'Una', {
      serialNumber: '4958927530',
      cnGiven: 'Ali',
      cnFamily: 'Ahmadi',
      sn: 'احمدی',
      gn: 'علی',
      st: 'تهران',
      l: 'تهران',
      orgId: '14000405500',
    });
    expect(rdns.map((r) => r.shortName)).toEqual([
      'CN',
      'serialNumber',
      'SN',
      'GN',
      'O',
      'L',
      'ST',
      'C',
    ]);
    expect(rdns.find((r) => r.oid === '2.5.4.97')).toBeUndefined();
    expect(rdns.find((r) => r.oid === '2.5.4.11')).toBeUndefined();
  });
});

describe('normalizeAndValidate', () => {
  it('flags incomplete required fields with Persian errors', () => {
    const r = normalizeAndValidate(getProfile(2), 'NGO', {});
    expect(r.valid).toBe(false);
    expect(r.results['serialNumber']?.error).toBe('این فیلد الزامی است');
  });

  it('accepts the fully filled guide example', () => {
    const r = normalizeAndValidate(getProfile(2), 'NGO', P2_VALUES);
    expect(r.valid).toBe(true);
  });

  it('rejects non-ASCII in En fields', () => {
    const r = normalizeAndValidate(getProfile(2), 'NGO', {
      ...P2_VALUES,
      cnOrgNameEn: 'مرکز Doe',
    });
    expect(r.valid).toBe(false);
    expect(r.results['cnOrgNameEn']?.error).toContain('انگلیسی');
  });

  it('converted Persian digits in numeric fields', () => {
    const r = normalizeAndValidate(getProfile(2), 'NGO', {
      ...P2_VALUES,
      serialNumber: '۱۴۰۰۰۴۰۵۵۰۰',
    });
    expect(r.valid).toBe(true);
    expect(r.values['serialNumber']).toBe('14000405500');
  });

  it('legal ID checksum failure is a warning, form stays valid', () => {
    const r = normalizeAndValidate(getProfile(2), 'NGO', {
      ...P2_VALUES,
      serialNumber: '14000405501',
    });
    expect(r.valid).toBe(true);
    expect(r.hasWarning).toBe(true);
  });
});
