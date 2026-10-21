import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { installNetworkGuard, resetNetworkGuard } from '../src/core/noNetwork';

/**
 * تضمین «بدون شبکه» — سه لایه:
 *
 *  1) محافظ زمان اجرا: هر تلاش برای برقراری ارتباط شبکه خطا می‌دهد.
 *  2) اسکن خروجی ساخت: هیچ منبع بیرونی (CDN، فونت آنلاین، API) نباید وجود داشته باشد.
 *  3) اسکن کد: هیچ API شبکه‌ای نباید صدا زده شود.
 */

/**
 * دامنه‌های بی‌خطری که فقط در پیام‌های هشدار کتابخانه‌ها و شناسه‌های فضای‌نام
 * XML ظاهر می‌شوند. هیچ‌کدام هرگز بارگذاری نمی‌شوند.
 *
 * هر دامنهٔ بیرونی دیگری (CDN، گوگل‌فونت، API و …) باعث شکست آزمون می‌شود.
 */
const INERT_URL_DOMAINS = [
  'www.w3.org', // شناسهٔ فضای‌نام XML
  'react.dev', // پیوندهای مستندات در پیام‌های هشدار React
  'reactjs.org',
  'developer.mozilla.org',
  'github.com', // پیوند به issue tracker در پیام‌های هشدار
  'bugs.webkit.org',
  'tailwindcss.com',
];

function domainOf(url: string): string {
  const match = url.match(/^https?:\/\/([^/?#]+)/i);
  return match ? match[1]!.toLowerCase() : url.toLowerCase();
}

const DIST = join(process.cwd(), 'dist');

function distFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...distFiles(full));
    else out.push(full);
  }
  return out;
}

function ensureBuild(): string[] {
  const files = distFiles(DIST);
  if (files.length === 0) {
    execFileSync('npx', ['vite', 'build'], { stdio: 'ignore', shell: process.platform === 'win32' });
  }
  return distFiles(DIST);
}

/** all source files of the application (TypeScript / TSX / CSS) */
function collectSources(dir: string): { file: string; content: string }[] {
  if (!existsSync(dir)) return [];
  const out: { file: string; content: string }[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectSources(full));
    } else if (/\.(ts|tsx|css)$/.test(entry)) {
      out.push({ file: full, content: readFileSync(full, 'utf8') });
    }
  }
  return out;
}

/** remove comments so that only real code is inspected */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('runtime network guard', () => {
  afterEach(() => {
    resetNetworkGuard();
  });

  it('blocks fetch, XMLHttpRequest and WebSocket', () => {
    installNetworkGuard();
    expect(() => globalThis.fetch('https://example.com')).toThrow(/شبکه/);
    expect(() => new globalThis.WebSocket('wss://example.com')).toThrow(/شبکه/);
    if (typeof XMLHttpRequest === 'function') {
      expect(() => new globalThis.XMLHttpRequest()).toThrow(/شبکه/);
    }
  });

  it('can be reset so the original implementations are restored', () => {
    const original = globalThis.fetch;
    installNetworkGuard();
    expect(globalThis.fetch).not.toBe(original);
    resetNetworkGuard();
    expect(globalThis.fetch).toBe(original);
  });
});

describe('build output contains no external resources', () => {
  const files = ensureBuild();

  it('the build produced output', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('the HTML loads no external script, style, font or image', () => {
    const html = readFileSync(join(DIST, 'index.html'), 'utf8');
    // every script/link/img reference must be relative
    const refs = html.matchAll(/<(script|link|img|iframe|embed|object)\b[^>]*>/gi);
    for (const [, tag] of refs) {
      expect(tag).toBeTruthy();
    }
    const external = html.matchAll(/(?:src|href)\s*=\s*["'](https?:)?\/\//gi);
    expect([...external]).toEqual([]);
  });

  it('the CSS references no external font or image', () => {
    for (const file of files.filter((f) => f.endsWith('.css'))) {
      const css = readFileSync(file, 'utf8');
      expect(css.match(/url\(\s*['"]?https?:/gi) ?? []).toEqual([]);
      expect(css.match(/@import\s+url\(\s*['"]?https?:/gi) ?? []).toEqual([]);
    }
  });

  it('no unexpected absolute URL appears anywhere in the build output', () => {
    for (const file of files) {
      if (file.endsWith('.woff2') || file.endsWith('.woff') || file.endsWith('.ttf')) continue;
      const content = readFileSync(file, 'utf8');
      const urls = content.match(/https?:\/\/[^\s'"()<>]+/gi) ?? [];
      for (const url of urls) {
        const domain = domainOf(url);
        expect(
          INERT_URL_DOMAINS.includes(domain),
          `external URL in build output: ${url} (${file})`
        ).toBe(true);
      }
    }
  });

  it('no remote resource is referenced from the bundle', () => {
    for (const file of files.filter((f) => f.endsWith('.js'))) {
      const js = readFileSync(file, 'utf8');
      // dynamic import of a remote module
      expect(js.match(/import\s*\(\s*["'`]https?:/gi) ?? []).toEqual([]);
      // remote source assigned to a DOM property
      expect(js.match(/\.(?:src|href)\s*=\s*["'`]https?:/gi) ?? []).toEqual([]);
      // fetch with a remote URL
      expect(js.match(/fetch\s*\(\s*["'`]https?:/gi) ?? []).toEqual([]);
    }
  });

  it('no network API is called in the bundle', () => {
    for (const file of files.filter((f) => f.endsWith('.js'))) {
      const js = readFileSync(file, 'utf8');
      // react-dom ships a resource-preload helper that calls fetch(); the app
      // never triggers it, and the runtime guard blocks it. What must not
      // exist is a call with a remote URL.
      expect(js.match(/fetch\s*\(\s*["'`]https?:/gi) ?? []).toEqual([]);
      expect(js.match(/new\s+XMLHttpRequest/g) ?? []).toEqual([]);
      expect(js.match(/new\s+WebSocket/g) ?? []).toEqual([]);
      expect(js.match(/new\s+EventSource/g) ?? []).toEqual([]);
      expect(js.match(/sendBeacon\s*\(/g) ?? []).toEqual([]);
      expect(js.match(/importScripts\s*\(/g) ?? []).toEqual([]);
    }
  });

  it('the application source itself contains no network API call', () => {
    const sources = collectSources(join(process.cwd(), 'src'));
    expect(sources.length).toBeGreaterThan(0);
    for (const { file, content } of sources) {
      const code = stripComments(content);
      // the network guard itself is the only place allowed to mention these
      if (file.replace(/\\/g, '/').endsWith('core/noNetwork.ts')) continue;
      expect(code.match(/\bfetch\s*\(/g) ?? [], file).toEqual([]);
      expect(code.match(/\bXMLHttpRequest\b/g) ?? [], file).toEqual([]);
      expect(code.match(/\bWebSocket\b/g) ?? [], file).toEqual([]);
      expect(code.match(/\bEventSource\b/g) ?? [], file).toEqual([]);
      expect(code.match(/sendBeacon/g) ?? [], file).toEqual([]);
      expect(code.match(/importScripts/g) ?? [], file).toEqual([]);
      // no absolute URL literals in the application code
      expect(code.match(/https?:\/\//g) ?? [], file).toEqual([]);
    }
  });

  it('no key material is written to web storage', () => {
    for (const file of files.filter((f) => f.endsWith('.js'))) {
      const js = readFileSync(file, 'utf8');
      // only the theme preference may be stored
      const storageKeys = js.match(/localStorage\.setItem\(\s*["'`]([^"'`]+)/g) ?? [];
      for (const call of storageKeys) {
        expect(call).toContain('gica-csr:theme');
      }
      expect(js.match(/indexedDB/g) ?? []).toEqual([]);
      expect(js.match(/document\.cookie/g) ?? []).toEqual([]);
    }
  });
});
