#!/usr/bin/env node
/**
 * اسکریپت راستی‌آزمایی درون‌تطبیقی با OpenSSL 3.x
 *
 * یک CSR با هستهٔ برنامه می‌سازد، همان ورودی را به OpenSSL می‌دهد و خروجی دو
 * راه را (موضوع، نوع رشته‌ها و ترتیب RDN) مقایسه می‌کند. سپس کلید رمزگذاری‌شده
 * و فایل PFX را با خط فرمان OpenSSL می‌خواند.
 *
 * اجرا:  npm run interop
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { buildSubjectRdns, opensslConfig } = await import('../src/core/dn.ts');
const { generateMaterials } = await import('../src/core/x509.ts');
const { buildPfxBytes } = await import('../src/core/pfx.ts');
const { generateKeyPair, exportPkcs8Der } = await import('../src/core/keys.ts');
const { selfSignedCertDer } = await import('../tests/helpers/selfSigned.ts');

const PASS = 'interop pass phrase 123';

function openssl(args, opts = {}) {
  const result = spawnSync('openssl', args, { encoding: 'utf8', input: opts.input ?? '' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`openssl ${args.join(' ')} failed: ${result.stderr ?? ''}`);
  }
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

function derBytesOf(path) {
  const raw = readFileSync(path);
  const text = raw.toString('utf8');
  if (!text.includes('-----BEGIN')) return raw;
  return Buffer.from(text.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64');
}

function subjectDer(path) {
  const der = derBytesOf(path);
  const lines = openssl(['asn1parse', '-in', path, '-i']).split(/\r?\n/);
  const infoIdx = lines.findIndex((l) => /d=1\s+hl=\d+\s+l=\s*\d+\s+cons:\s+SEQUENCE/.test(l));
  const subjectIdx = lines.findIndex(
    (l, i) => i > infoIdx && /d=2\s+hl=(\d+)\s+l=\s*(\d+)\s+cons:\s+SEQUENCE/.test(l)
  );
  const m = lines[subjectIdx].match(/d=2\s+hl=(\d+)\s+l=\s*(\d+)/);
  const offset = Number(lines[subjectIdx].trim().split(':')[0]);
  return der.subarray(offset, offset + Number(m[1]) + Number(m[2])).toString('hex');
}

const CASES = [
  {
    name: 'پروفایل ۱ — امضای شخص حقیقی (Gov)',
    profile: 1,
    type: 'Gov',
    values: {
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
    },
  },
  {
    name: 'پروفایل ۲ — مهر سازمانی (NGO)',
    profile: 2,
    type: 'NGO',
    values: {
      serialNumber: '14000405500',
      cnOrgNameEn: 'Iran Center for Ecommerce Development',
      ouOrg: 'مرکز توسعه تجارت الکترونیکی',
      l: 'تهران',
      st: 'تهران',
    },
  },
  {
    name: 'پروفایل ۳ — دفتر ثبت‌نام (NGO)',
    profile: 3,
    type: 'NGO',
    values: {
      serialNumber: '14020001',
      raName: 'CentralRegistrationOffice',
      raNationalCode: '4958927530',
      sn: 'احمدی',
      gn: 'علی',
      ouOrg: 'دفتر ثبت‌نام مرکزی',
      l: 'تهران',
      st: 'تهران',
    },
  },
];

let failures = 0;
const dir = mkdtempSync(join(tmpdir(), 'gica-interop-'));

for (const testCase of CASES) {
  const rdns = buildSubjectRdns(testCase.profile, testCase.type, testCase.values);
  const ours = await generateMaterials(rdns, PASS);

  const ourCsr = join(dir, 'mycsr.txt');
  writeFileSync(ourCsr, ours.csrPem, 'utf8');

  const configPath = join(dir, 'config.txt');
  writeFileSync(configPath, opensslConfig(rdns), 'utf8');
  const theirCsr = join(dir, 'openssl-csr.txt');
  openssl([
    'req', '-new', '-utf8', '-config', configPath, '-newkey', 'rsa:2048', '-nodes',
    '-keyout', join(dir, 'openssl-key.key'), '-out', theirCsr,
  ]);

  const checks = [];
  const same = subjectDer(ourCsr) === subjectDer(theirCsr);
  checks.push(['موضوع CSR با OpenSSL یکسان است (بایت‌به‌بایت)', same]);

  const verified = openssl(['req', '-in', ourCsr, '-noout', '-verify', '-text']);
  checks.push([
    'امضای CSR راستی‌آزمایی شد',
    verified.includes('Certificate request self-signature verify OK'),
  ]);

  const keyPath = join(dir, 'mykey.key');
  writeFileSync(keyPath, ours.encryptedKeyPem, 'utf8');
  let keyOk = true;
  try {
    openssl(['pkey', '-in', keyPath, '-passin', `pass:${PASS}`, '-noout']);
  } catch {
    keyOk = false;
  }
  checks.push(['کلید خصوصی با رمز باز می‌شود', keyOk]);

  let wrongPassRejected = true;
  try {
    openssl(['pkey', '-in', keyPath, '-passin', 'pass:wrong-passphrase', '-noout']);
    wrongPassRejected = false;
  } catch {
    /* expected */
  }
  checks.push(['رمز اشتباه پذیرفته نمی‌شود', wrongPassRejected]);

  console.log(`\n${testCase.name}`);
  for (const [label, ok] of checks) {
    console.log(`  ${ok ? '✓' : '✗'} ${label}`);
    if (!ok) failures++;
  }
}

// PFX
{
  const pair = await generateKeyPair();
  const certDer = await selfSignedCertDer(pair);
  const pkcs8 = await exportPkcs8Der(pair.privateKey);
  const pfx = buildPfxBytes({
    certs: { leaf: certDer, chain: [] },
    privateKeyPkcs8Der: pkcs8,
    exportPassword: 'export pass 123',
  });
  const pfxPath = join(dir, 'keystore.pfx');
  writeFileSync(pfxPath, pfx);
  let ok = true;
  try {
    const info = openssl(['pkcs12', '-info', '-in', pfxPath, '-passin', 'pass:export pass 123', '-noout']);
    ok = info.includes('Shrouded Keybag');
  } catch {
    ok = false;
  }
  console.log('\nPFX');
  console.log(`  ${ok ? '✓' : '✗'} فایل keystore.pfx با openssl pkcs12 -info خوانده می‌شود`);
  if (!ok) failures++;
}

console.log(failures === 0 ? '\n✓ همهٔ بررسی‌های درون‌تطبیقی موفق بود.' : `\n✗ ${failures} بررسی ناموفق بود.`);
process.exit(failures === 0 ? 0 : 1);
