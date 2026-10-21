#!/usr/bin/env node
/**
 * سیاست npm audit — همیشه اجرا می‌شود و در صورت وجود آسیب‌پذیری ناشناخته شکست می‌خورد.
 *
 * تنها استثنا: node-forge در نسخهٔ ۱.۴.۰ (آخرین نسخهٔ منتشرشده) یک advisory
 * بدون وصله دارد:
 *   GHSA-86w9-cpqp-85rv — «RSA PKCS#1 v1.5 signature verification accepts extra
 *   nested DigestAlgorithm elements»
 *
 * این advisory فقط مسیر `forge.pki.rsa.verify` را تحت تأثیر قرار می‌دهد؛ یعنی
 * راستی‌آزمایی امضای گواهی توسط خود node-forge. این برنامه هرگز از آن مسیر
 * استفاده نمی‌کند:
 *   - راستی‌آزمایی امضای CSR با WebCrypto انجام می‌شود
 *   - بررسی تطابق کلید و گواهی با WebCrypto انجام می‌شود
 *   - node-forge فقط برای ساخت ظرف PKCS#12 (رمزنگاری و MAC) به کار می‌رود
 *
 * جزئیات در README (بخش «نکات امنیتی») آمده است.
 */

import { execFileSync } from 'node:child_process';

const ALLOWED = new Set(['GHSA-86w9-cpqp-85rv']);

const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

let report;
try {
  const stdout = execFileSync(NPM, ['audit', '--json'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  report = JSON.parse(stdout);
} catch (error) {
  // npm audit exits with a non-zero code when vulnerabilities are found
  const stdout = error?.stdout;
  if (!stdout) {
    console.error('npm audit could not be executed:', error?.message ?? error);
    process.exit(1);
  }
  try {
    report = JSON.parse(stdout);
  } catch {
    console.error('npm audit returned unparsable output');
    process.exit(1);
  }
}

const vulnerabilities = report.vulnerabilities ?? {};
const names = Object.keys(vulnerabilities);
const blocking = names.filter((name) => {
  const entry = vulnerabilities[name];
  const via = Array.isArray(entry.via) ? entry.via : [];
  const advisoryIds = via.filter((v) => typeof v === 'object' && v.url).map((v) => v.url);
  // an advisory is allowed only if every advisory behind it is allow-listed
  if (advisoryIds.length === 0) return true;
  return !advisoryIds.every((url) => {
    const id = url.split('/').pop();
    return ALLOWED.has(id);
  });
});

if (blocking.length > 0) {
  console.error('✗ npm audit found blocking vulnerabilities:\n');
  for (const name of blocking) {
    const entry = vulnerabilities[name];
    console.error(`  ${name} (${entry.severity})`);
    for (const via of entry.via ?? []) {
      if (typeof via === 'object') console.error(`    ${via.url} — ${via.title}`);
      else console.error(`    via ${via}`);
    }
  }
  console.error('\nSee README → «نکات امنیتی» for the documented exception list.');
  process.exit(1);
}

const allowed = names.filter((name) => !blocking.includes(name));
if (allowed.length > 0) {
  console.log('✓ npm audit: no blocking vulnerabilities.');
  console.log(`  ${allowed.length} documented exception(s) allowed: ${allowed.join(', ')}`);
  for (const name of allowed) {
    const via = vulnerabilities[name].via ?? [];
    for (const v of via) {
      if (typeof v === 'object') console.log(`    - ${v.url}: ${v.title}`);
    }
  }
} else {
  console.log('✓ npm audit: no vulnerabilities at all.');
}
