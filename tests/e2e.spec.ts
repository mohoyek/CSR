import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * آزمون سرتاسری با مرورگر واقعی.
 *
 * کل مسیر کاربر را طی می‌کند: انتخاب پروفایل، پر کردن فرم، بازبینی، تعیین رمز
 * عبور، تولید و بررسی اینکه فایل‌های خروجی درست ساخته شده‌اند.
 *
 * اگر مرورگری (Chrome/Edge/Chromium) روی سیستم نباشد، آزمون رد می‌شود.
 */

function findBrowser(): string | null {
  if (process.env['CHROME_PATH']) return process.env['CHROME_PATH'];
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ];
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  return null;
}

const BROWSER = findBrowser();
const PORT = 4183;

function buildApp(): string {
  execFileSync('npx', ['vite', 'build'], { stdio: 'ignore', shell: process.platform === 'win32' });
  return join(process.cwd(), 'dist');
}

describe.skipIf(!BROWSER)('end-to-end (real browser)', () => {
  let server: Server | null = null;
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  let baseUrl = '';

  beforeAll(async () => {
    buildApp();
    const { createServer } = await import('node:http');
    const { readFile } = await import('node:fs/promises');
    const root = join(process.cwd(), 'dist');
    server = createServer(async (req, res) => {
      const url = (req.url ?? '/').split('?')[0]!;
      const file = url === '/' ? 'index.html' : url.replace(/^\//, '');
      const path = join(root, file);
      if (!existsSync(path)) {
        res.writeHead(404).end('not found');
        return;
      }
      const body = await readFile(path);
      const type = path.endsWith('.html')
        ? 'text/html; charset=utf-8'
        : path.endsWith('.js')
          ? 'text/javascript'
          : path.endsWith('.css')
            ? 'text/css'
            : 'font/woff2';
      res.writeHead(200, { 'content-type': type }).end(body);
    });
    await new Promise<void>((resolve) => server!.listen(PORT, resolve));
    baseUrl = `http://localhost:${PORT}/`;

    browser = await puppeteer.launch({
      executablePath: BROWSER!,
      headless: true,
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    });
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    server?.close();
  });

  it('walks through the wizard and produces the three files', async () => {
    const page = await browser!.newPage();
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    await page.goto(baseUrl, { waitUntil: 'networkidle0' });

    /* ---- step 1: profile ---- */
    await page.waitForSelector('input[name="profile"]');
    // profile 2 is the default; select it explicitly
    const profileRadios = await page.$$('input[name="profile"]');
    await profileRadios[1]!.click();
    await page.waitForFunction(
      () => document.body.innerText.includes('گواهی امضای شخص حقوقی')
    );
    await page.click('button ::-p-text(بعدی: تکمیل فرم)');

    /* ---- step 2: fill the form ---- */
    await page.waitForSelector('#f-serialNumber');
    const values: Record<string, string> = {
      'f-serialNumber': '14000405500',
      'f-cnOrgNameEn': 'Iran Center for Ecommerce Development',
      'f-ouOrg': 'مرکز توسعه تجارت الکترونیکی',
      'f-l': 'تهران',
      'f-st': 'تهران',
    };
    for (const [id, value] of Object.entries(values)) {
      await page.focus(`#${id}`);
      await page.type(`#${id}`, value);
    }
    // the live preview must show the subject
    await page.waitForFunction(() =>
      document.body.innerText.includes('Iran Center for Ecommerce Development [Stamp]')
    );
    const bodyText = await page.evaluate(() => document.body.innerText);
    expect(bodyText).toContain('CN=Iran Center for Ecommerce Development [Stamp]');
    expect(bodyText).toContain('serialNumber=14000405500');
    expect(bodyText).toContain('C=IR');

    await page.click('button ::-p-text(بعدی: بازبینی)');

    /* ---- step 3: review ---- */
    await page.waitForFunction(() => document.body.innerText.includes('config.txt'));
    const reviewText = await page.evaluate(() => document.body.innerText);
    expect(reviewText).toContain('1.OU = مرکز توسعه تجارت الکترونیکی');

    await page.click('button ::-p-text(بعدی: رمز عبور)');

    /* ---- step 4: passphrase + generate ---- */
    await page.waitForSelector('#passphrase');
    await page.type('#passphrase', 'Test Passphrase 123');
    await page.type('#passphrase-confirm', 'Test Passphrase 123');
    await page.click('button ::-p-text(تولید کلید و CSR)');

    /* ---- step 5: results ---- */
    await page.waitForFunction(
      () => (document.body.textContent ?? '').includes('-----BEGIN CERTIFICATE REQUEST-----'),
      { timeout: 60_000 }
    );
    const resultText = await page.evaluate(() => document.body.textContent ?? '');
    expect(resultText).toContain('-----BEGIN CERTIFICATE REQUEST-----');
    expect(resultText).toContain('-----BEGIN ENCRYPTED PRIVATE KEY-----');
    expect(resultText).toContain('-----BEGIN PUBLIC KEY-----');
    await page.waitForFunction(() => document.body.innerText.includes('خودارزیابی موفق'));

    // the CSR must be verifiable by OpenSSL
    const csr = await page.evaluate(() => {
      const match = (document.body.textContent ?? '').match(
        /-----BEGIN CERTIFICATE REQUEST-----[\s\S]*?-----END CERTIFICATE REQUEST-----/
      );
      return match ? match[0] : '';
    });
    expect(csr.length).toBeGreaterThan(100);
    const dir = mkdtempSync(join(tmpdir(), 'gica-e2e-'));
    const csrPath = join(dir, 'mycsr.txt');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(csrPath, csr, 'utf8');
    const verify = spawnSync(
      'openssl',
      ['req', '-in', csrPath, '-noout', '-verify', '-text'],
      { encoding: 'utf8' }
    );
    expect(verify.status).toBe(0);
    expect(`${verify.stdout}${verify.stderr}`).toContain(
      'Certificate request self-signature verify OK'
    );
    expect(`${verify.stdout}${verify.stderr}`).toContain('serialNumber=14000405500');

    // no console errors
    expect(consoleErrors).toEqual([]);
    await page.close();
  }, 120_000);

  it('the PFX tab builds a keystore from an issued certificate', async () => {
    const page = await browser!.newPage();
    await page.goto(baseUrl, { waitUntil: 'networkidle0' });

    // switch to the PFX tab
    await page.waitForSelector('[role="tab"]');
    const tabs = await page.$$('[role="tab"]');
    await tabs[1]!.click();
    await page.waitForFunction(() => document.body.innerText.includes('ساخت keystore.pfx'));

    // the tab must be independent: no CSR result is carried over
    const text = await page.evaluate(() => document.body.textContent ?? '');
    expect(text).not.toContain('-----BEGIN CERTIFICATE REQUEST-----');
    expect(text).not.toContain('-----BEGIN ENCRYPTED PRIVATE KEY-----');

    // build the inputs in the page — the certificate and the key must belong
    // together, so both are derived from the same key pair
    const { encryptPkcs8, encryptedPkcs8Pem, exportPkcs8Der, generateKeyPair } = await import(
      '../src/core/keys'
    );
    const { selfSignedCertDer } = await import('./helpers/selfSigned');

    const pair = await generateKeyPair();
    const pkcs8 = await exportPkcs8Der(pair.privateKey);
    const encryptedKeyPem = encryptedPkcs8Pem(await encryptPkcs8(pkcs8, 'Test Passphrase 123'));
    const certDer = await selfSignedCertDer(pair);

    const dir = mkdtempSync(join(tmpdir(), 'gica-e2e-pfx-'));
    const { writeFileSync } = await import('node:fs');
    const certPath = join(dir, 'certificate.crt');
    const keyPath = join(dir, 'mykey.key');
    writeFileSync(certPath, Buffer.from(certDer));
    writeFileSync(keyPath, encryptedKeyPem, 'utf8');

    const fileInputs = await page.$$('input[type="file"]');
    expect(fileInputs.length).toBeGreaterThanOrEqual(3);
    await fileInputs[0]!.uploadFile(certPath);
    await fileInputs[1]!.uploadFile(keyPath);
    await page.waitForFunction(() => document.body.innerText.includes('certificate.crt'));

    // enter the key passphrase and the export password
    await page.focus('#key-passphrase');
    await page.type('#key-passphrase', 'Test Passphrase 123');
    await page.focus('#export-password');
    await page.type('#export-password', 'Export Pass 123');
    await page.focus('#export-confirm');
    await page.type('#export-confirm', 'Export Pass 123');

    // the mismatch check must succeed
    await page.click('button ::-p-text(بررسی تطابق کلید و گواهی)');
    await page.waitForFunction(
      () => document.body.innerText.includes('کلید عمومی گواهی با کلید خصوصی یکسان است'),
      { timeout: 60_000 }
    );

    // building the PFX must succeed
    await page.click('button ::-p-text(ساخت و دریافت keystore.pfx)');
    await page.waitForFunction(
      () => document.body.innerText.includes('فایل keystore.pfx ساخته و دریافت شد'),
      { timeout: 120_000 }
    );

    await page.close();
  }, 180_000);

  it('reports a clear error when the certificate does not match the key', async () => {
    const page = await browser!.newPage();
    await page.goto(baseUrl, { waitUntil: 'networkidle0' });
    const tabs = await page.$$('[role="tab"]');
    await tabs[1]!.click();
    await page.waitForFunction(() => document.body.innerText.includes('ساخت keystore.pfx'));

    const { encryptPkcs8, encryptedPkcs8Pem, exportPkcs8Der, generateKeyPair } = await import(
      '../src/core/keys'
    );
    const { selfSignedCertDer } = await import('./helpers/selfSigned');

    // key A for the private key file …
    const keyA = await generateKeyPair();
    const encPem = encryptedPkcs8Pem(
      await encryptPkcs8(await exportPkcs8Der(keyA.privateKey), 'Test Passphrase 123')
    );
    // … and key B for the certificate
    const keyB = await generateKeyPair();
    const certDer = await selfSignedCertDer(keyB);

    const dir = mkdtempSync(join(tmpdir(), 'gica-e2e-mismatch-'));
    const { writeFileSync } = await import('node:fs');
    const certPath = join(dir, 'certificate.crt');
    const keyPath = join(dir, 'mykey.key');
    writeFileSync(certPath, Buffer.from(certDer));
    writeFileSync(keyPath, encPem, 'utf8');

    const fileInputs = await page.$$('input[type="file"]');
    await fileInputs[0]!.uploadFile(certPath);
    await fileInputs[1]!.uploadFile(keyPath);
    await page.waitForFunction(() => document.body.innerText.includes('certificate.crt'));
    await page.focus('#key-passphrase');
    await page.type('#key-passphrase', 'Test Passphrase 123');

    await page.click('button ::-p-text(بررسی تطابق کلید و گواهی)');
    await page.waitForFunction(
      () => document.body.innerText.includes('کلید عمومی گواهی با کلید خصوصی واردشده یکسان نیست'),
      { timeout: 60_000 }
    );
    await page.close();
  }, 180_000);
});
