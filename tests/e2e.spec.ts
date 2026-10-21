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

  it('fills the form, generates and produces the three files', async () => {
    const page = await browser!.newPage();
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    await page.goto(baseUrl, { waitUntil: 'networkidle0' });

    /* ---- pick the legal-person profile (شخص حقوقی) ---- */
    await page.waitForSelector('[role="tab"]');
    const tabs = await page.$$('[role="tab"]');
    await tabs[1]!.click();
    await page.waitForSelector('#f-serialNumber');
    const values: Record<string, string> = {
      'f-serialNumber': '14000405500',
      'f-cnOrgNameEn': 'IranCenterForEcommerceDevelopment',
      'f-ouOrg': 'مرکز توسعه تجارت الکترونیکی',
      'f-l': 'تهران',
      'f-st': 'تهران',
    };
    for (const [id, value] of Object.entries(values)) {
      await page.focus(`#${id}`);
      await page.type(`#${id}`, value);
    }

    // the live preview must show the subject
    await page.click('summary ::-p-text(پیش‌نمایش موضوع گواهی)');
    await page.waitForFunction(() =>
      document.body.innerText.includes('IranCenterForEcommerceDevelopment [Stamp]')
    );
    const bodyText = await page.evaluate(() => document.body.innerText);
    expect(bodyText).toContain('CN=IranCenterForEcommerceDevelopment [Stamp]');
    expect(bodyText).toContain('serialNumber=14000405500');
    expect(bodyText).toContain('C=IR');
    // the equivalent config.txt of the guide
    expect(bodyText).toContain('1.OU = مرکز توسعه تجارت الکترونیکی');

    /* ---- generate (no passphrase needed) ---- */
    await page.click('button ::-p-text(تولید کلیدهای سازمان مودیبان)');

    /* ---- results ---- */
    await page.waitForFunction(
      () => (document.body.textContent ?? '').includes('-----BEGIN CERTIFICATE REQUEST-----'),
      { timeout: 60_000 }
    );
    const resultText = await page.evaluate(() => document.body.textContent ?? '');
    expect(resultText).toContain('-----BEGIN CERTIFICATE REQUEST-----');
    expect(resultText).toContain('-----BEGIN PRIVATE KEY-----');
    expect(resultText).toContain('-----BEGIN PUBLIC KEY-----');
    // the three file names of the guide
    expect(resultText).toContain('mycsr.txt');
    expect(resultText).toContain('mykey.key');
    expect(resultText).toContain('mypublickey.pem');
    // the status panel reports success
    await page.waitForFunction(() =>
      document.body.innerText.includes('کلید، CSR و کلید عمومی با موفقیت ساخته')
    );

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
});
