import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSubjectRdns, opensslConfig } from '../src/core/dn';
import { generateMaterials } from '../src/core/x509';
import { buildPfxBytes } from '../src/core/pfx';
import { newKeyPair, selfSignedCertDer } from './helpers/selfSigned';

/**
 * Interop tests against a real OpenSSL 3.x binary.
 *
 * These are the acceptance tests of the task: the CSR produced by the app's
 * core module must be byte-identical (in its subject part) to the CSR that
 * OpenSSL produces from the equivalent config.txt, and every artifact must be
 * readable by the OpenSSL command line.
 *
 * The suite is skipped when no `openssl` binary is available.
 */

function opensslAvailable(): boolean {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const HAS_OPENSSL = opensslAvailable();

/** Run openssl and return stdout+stderr (some sub-commands report on stderr) */
function openssl(args: string[], opts: { input?: string } = {}): string {
  const result = spawnSync('openssl', args, {
    encoding: 'utf8',
    input: opts.input ?? '',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `openssl ${args.join(' ')} failed (status ${result.status}): ${result.stderr ?? ''}`
    );
  }
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'gica-csr-interop-'));
}

/* ------------------------------------------------------------------ */
/* Subject extraction — compares the ASN.1 encoding, not just the text */
/* ------------------------------------------------------------------ */

interface RdnTuple {
  oid: string;
  type: string;
  value: string;
}

/** Parse the subject RDNs out of `openssl asn1parse -i` output */
function subjectRdnsFromAsn1Parse(text: string): RdnTuple[] {
  // OpenSSL on Windows emits CRLF
  const lines = text.split(/\r?\n/);
  const out: RdnTuple[] = [];
  for (let i = 0; i < lines.length; i++) {
    const oidMatch = lines[i]!.match(/OBJECT\s+:(\S+)\s*$/);
    if (!oidMatch) continue;
    const oid = oidMatch[1]!;
    if (oid === 'rsaEncryption') break; // subject section ends here
    const valueMatch = lines[i + 1]?.match(/prim:\s+(\S+)\s+:(.*)$/);
    if (!valueMatch) continue;
    out.push({ oid, type: valueMatch[1]!, value: valueMatch[2]!.trim() });
    i++;
  }
  return out;
}

/**
 * Extract the raw DER of the subject (CertificationRequestInfo.subject)
 * from a CSR, using the offsets reported by `openssl asn1parse`.
 *
 * `openssl asn1parse` offsets refer to the DER, so a PEM file has to be
 * decoded first — otherwise the offsets would point into the PEM text.
 */
function subjectDer(csrPath: string): Buffer {
  const der = derBytesOf(csrPath);
  const parsed = openssl(['asn1parse', '-in', csrPath, '-i']);
  const lines = parsed.split(/\r?\n/);
  // CertificationRequestInfo is the first `d=1` SEQUENCE
  const infoIdx = lines.findIndex((l) => /d=1\s+hl=\d+\s+l=\s*\d+\s+cons:\s+SEQUENCE/.test(l));
  expect(infoIdx, 'CertificationRequestInfo not found in asn1parse output').toBeGreaterThan(-1);
  // the subject is the first `d=2` SEQUENCE after it
  const subjectIdx = lines.findIndex(
    (l, idx) => idx > infoIdx && /d=2\s+hl=(\d+)\s+l=\s*(\d+)\s+cons:\s+SEQUENCE/.test(l)
  );
  expect(subjectIdx, 'subject SEQUENCE not found in asn1parse output').toBeGreaterThan(-1);
  const line = lines[subjectIdx]!;
  const m = line.match(/d=2\s+hl=(\d+)\s+l=\s*(\d+)\s+cons:\s+SEQUENCE/);
  const hl = Number(m![1]);
  const len = Number(m![2]);
  const offset = Number(line.trim().split(':')[0]);
  return der.subarray(offset, offset + hl + len);
}

/** DER bytes of a CSR file (PEM is decoded, DER is used as-is) */
function derBytesOf(csrPath: string): Buffer {
  const raw = readFileSync(csrPath);
  const text = raw.toString('utf8');
  if (!text.includes('-----BEGIN')) return raw;
  const body = text
    .replace(/-----[^-]+-----/g, '')
    .replace(/\s+/g, '');
  return Buffer.from(body, 'base64');
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const P2_VALUES = {
  serialNumber: '14000405500',
  cnOrgNameEn: 'IranCenterForEcommerceDevelopment',
  ouOrg: 'مرکز توسعه تجارت الکترونیکی',
  l: 'تهران',
  st: 'تهران',
};

const P1_VALUES = {
  serialNumber: '4958927530',
  cnGiven: 'Ali',
  cnFamily: 'Ahmadi',
  sn: 'احمدی',
  gn: 'علی',
  title: 'کارشناس فناوری اطلاعات',
  orgId: '14000405500',
  ouOrg: 'مرکز توسعه تجارت الکترونیکی',
  l: 'تهران',
  st: 'تهران',
};

const P3_VALUES = {
  serialNumber: '14020001',
  cnOrgNameEn: '',
  raName: 'CentralRegistrationOffice',
  raNationalCode: '4958927530',
  sn: 'احمدی',
  gn: 'علی',
  ouOrg: 'دفتر ثبت‌نام مرکزی',
  l: 'تهران',
  st: 'تهران',
};

describe.skipIf(!HAS_OPENSSL)('OpenSSL interop', () => {
  it('profile 2: our CSR subject DER is byte-identical to OpenSSL output', async () => {
    const dir = tempDir();
    const rdns = buildSubjectRdns(2, 'NGO', P2_VALUES);

    // --- ours ---
    const ours = await generateMaterials(rdns);
    const ourCsrPath = join(dir, 'mycsr.txt');
    writeFileSync(ourCsrPath, ours.csrPem, 'utf8');

    // --- OpenSSL, from the equivalent config.txt ---
    const configPath = join(dir, 'config.txt');
    writeFileSync(configPath, opensslConfig(rdns), 'utf8');
    const theirCsrPath = join(dir, 'openssl-csr.txt');
    openssl([
      'req',
      '-new',
      '-utf8',
      '-config',
      configPath,
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      join(dir, 'openssl-key.key'),
      '-out',
      theirCsrPath,
    ]);

    // --- compare the subject encoding ---
    const ourDer = subjectDer(ourCsrPath);
    const theirDer = subjectDer(theirCsrPath);
    expect(ourDer.toString('hex')).toBe(theirDer.toString('hex'));

    // --- and the human readable RDN list ---
    const ourRdns = subjectRdnsFromAsn1Parse(openssl(['asn1parse', '-in', ourCsrPath, '-i']));
    const theirRdns = subjectRdnsFromAsn1Parse(openssl(['asn1parse', '-in', theirCsrPath, '-i']));
    expect(ourRdns).toEqual(theirRdns);

    // order and string types, exactly as the guide's sample
    expect(ourRdns.map((r) => r.oid)).toEqual([
      'commonName',
      'serialNumber',
      'organizationName',
      'organizationalUnitName',
      'localityName',
      'stateOrProvinceName',
      'countryName',
    ]);
    expect(ourRdns.map((r) => r.type)).toEqual([
      'UTF8STRING',
      'PRINTABLESTRING',
      'UTF8STRING',
      'UTF8STRING',
      'UTF8STRING',
      'UTF8STRING',
      'PRINTABLESTRING',
    ]);
    expect(ourRdns[0]!.value).toBe('IranCenterForEcommerceDevelopment [Stamp]');
    expect(ourRdns[1]!.value).toBe('14000405500');
    expect(ourRdns[3]!.value).toBe('مرکز توسعه تجارت الکترونیکی');
  }, 60_000);

  it('profile 1: OpenSSL verifies the CSR and shows the Persian text and 2.5.4.97', async () => {
    const dir = tempDir();
    const rdns = buildSubjectRdns(1, 'Gov', P1_VALUES);
    const ours = await generateMaterials(rdns);
    const csrPath = join(dir, 'mycsr.txt');
    writeFileSync(csrPath, ours.csrPem, 'utf8');

    const verified = openssl(['req', '-in', csrPath, '-noout', '-verify', '-text']);
    expect(verified).toContain('Certificate request self-signature verify OK');
    // the subject line, exactly as OpenSSL renders it
    expect(verified).toContain('CN=Ali Ahmadi [Sign]');
    expect(verified).toContain('serialNumber=4958927530');
    expect(verified).toContain('O=Governmental');
    expect(verified).toContain('C=IR');
    // 2.5.4.97 must be present as an attribute (the guide asks for the OID)
    expect(verified).toContain('organizationIdentifier=14000405500');
    expect(openssl(['asn1parse', '-in', csrPath, '-i'])).toContain('organizationIdentifier');
    // the Persian surname / given name must survive
    expect(verified).toContain('احمدی');
    expect(verified).toContain('علی');
  }, 60_000);

  it('profile 3: the CN template and RDN order match OpenSSL', async () => {
    const dir = tempDir();
    const rdns = buildSubjectRdns(3, 'NGO', P3_VALUES);
    const ours = await generateMaterials(rdns);
    const ourCsrPath = join(dir, 'mycsr.txt');
    writeFileSync(ourCsrPath, ours.csrPem, 'utf8');

    const configPath = join(dir, 'config.txt');
    writeFileSync(configPath, opensslConfig(rdns), 'utf8');
    const theirCsrPath = join(dir, 'openssl-csr.txt');
    openssl([
      'req',
      '-new',
      '-utf8',
      '-config',
      configPath,
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      join(dir, 'openssl-key.key'),
      '-out',
      theirCsrPath,
    ]);

    const ourDer = subjectDer(ourCsrPath);
    const theirDer = subjectDer(theirCsrPath);
    expect(ourDer.toString('hex')).toBe(theirDer.toString('hex'));
    expect(ourRdnsValue(ourCsrPath, 'commonName')).toBe(
      'CentralRegistrationOffice. RA [4958927530]'
    );
  }, 60_000);

  it('the private key file is readable with `openssl pkey`', async () => {
    const dir = tempDir();
    const rdns = buildSubjectRdns(2, 'NGO', P2_VALUES);
    const ours = await generateMaterials(rdns);
    const keyPath = join(dir, 'mykey.key');
    writeFileSync(keyPath, ours.privateKeyPem, 'utf8');

    // the key is a plain PKCS#8 — exactly like the guide's `-nodes` output
    expect(ours.privateKeyPem.startsWith('-----BEGIN PRIVATE KEY-----')).toBe(true);

    const out = openssl(['pkey', '-in', keyPath, '-noout', '-text']);
    expect(out).toContain('Private-Key: (2048 bit');

    // and the public key file must be exactly what OpenSSL derives from it
    // (OpenSSL on Windows writes CRLF, so the line endings are normalized)
    const pubPath = join(dir, 'mypublickey.pem');
    writeFileSync(pubPath, ours.publicKeyPem, 'utf8');
    const derived = openssl(['pkey', '-in', keyPath, '-pubout'])
      .replace(/\r\n/g, '\n')
      .trim();
    expect(derived).toBe(ours.publicKeyPem.trim());
  }, 60_000);

  it('the public key file is a valid SPKI PEM', async () => {
    const dir = tempDir();
    const rdns = buildSubjectRdns(2, 'NGO', P2_VALUES);
    const ours = await generateMaterials(rdns);
    const pubPath = join(dir, 'mypublickey.pem');
    writeFileSync(pubPath, ours.publicKeyPem, 'utf8');
    const out = openssl(['pkey', '-pubin', '-in', pubPath, '-noout', '-text']);
    expect(out).toContain('Public-Key: (2048 bit');
  }, 60_000);

  it('a PFX built from a self-signed test cert is readable by `openssl pkcs12 -info`', async () => {
    const dir = tempDir();
    const pair = await newKeyPair();
    const certDer = await selfSignedCertDer(pair);
    const pkcs8 = await exportPkcs8(pair);

    const pfx = buildPfxBytes({
      certs: { leaf: certDer, chain: [] },
      privateKeyPkcs8Der: pkcs8,
      exportPassword: 'export pass 123',
    });
    const pfxPath = join(dir, 'keystore.pfx');
    writeFileSync(pfxPath, pfx);

    const info = openssl(['pkcs12', '-info', '-in', pfxPath, '-passin', 'pass:export pass 123', '-noout']);
    expect(info).toContain('MAC:');
    expect(info).toContain('Shrouded Keybag');

    // the certificate and the key must be extractable and belong together
    const outPath = join(dir, 'out.pem');
    openssl([
      'pkcs12',
      '-in',
      pfxPath,
      '-passin',
      'pass:export pass 123',
      '-nodes',
      '-out',
      outPath,
    ]);
    const out = readFileSync(outPath, 'utf8');
    expect(out).toContain('BEGIN CERTIFICATE');
    expect(out).toContain('BEGIN PRIVATE KEY');
  }, 60_000);

  it('the legacy 3DES PFX is readable by `openssl pkcs12 -info` too', async () => {
    const dir = tempDir();
    const pair = await newKeyPair();
    const certDer = await selfSignedCertDer(pair);
    const pkcs8 = await exportPkcs8(pair);

    const pfx = buildPfxBytes({
      certs: { leaf: certDer, chain: [] },
      privateKeyPkcs8Der: pkcs8,
      exportPassword: 'export pass 123',
      legacy: true,
    });
    const pfxPath = join(dir, 'keystore-legacy.pfx');
    writeFileSync(pfxPath, pfx);

    const info = openssl(['pkcs12', '-info', '-in', pfxPath, '-passin', 'pass:export pass 123', '-noout']);
    expect(info).toContain('pbeWithSHA1And3-KeyTripleDES-CBC');
  }, 60_000);
});

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

async function exportPkcs8(pair: CryptoKeyPair): Promise<Uint8Array> {
  const { exportPkcs8Der } = await import('../src/core/keys');
  return exportPkcs8Der(pair.privateKey);
}

function ourRdnsValue(csrPath: string, oid: string): string {
  const rdns = subjectRdnsFromAsn1Parse(openssl(['asn1parse', '-in', csrPath, '-i']));
  const found = rdns.find((r) => r.oid === oid);
  return found?.value ?? '';
}
