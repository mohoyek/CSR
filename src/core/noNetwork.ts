/**
 * محافظ شبکه — این برنامه باید کاملاً آفلاین کار کند.
 *
 * هر تلاش برای برقراری ارتباط شبکه در زمان اجرا مسدود می‌شود، تا اگر
 * کدی (یا کتابخانه‌ای) خواسته باشد چیزی را از اینترنت بگیرد، خطا بدهد
 * به‌جای اینکه بی‌سروصدا داده‌ای را بیرون بفرستد.
 *
 * این محافظ فقط در ساخت نهایی فعال می‌شود؛ در حالت توسعه (dev) لازم است
 * تا HMR وی‌تی کار کند.
 */

const DENIED_MESSAGE = 'این ابزار هیچ ارتباط شبکه‌ای برقرار نمی‌کند. عملیات شبکه مسدود شد.';

const STORE = '__gicaNoNetworkOriginals';

interface Originals {
  fetch?: typeof fetch;
  XMLHttpRequest?: typeof XMLHttpRequest;
  WebSocket?: typeof WebSocket;
  EventSource?: typeof EventSource;
  sendBeacon?: Navigator['sendBeacon'];
}

function store(): Originals {
  const g = globalThis as unknown as Record<string, Originals | undefined>;
  if (!g[STORE]) g[STORE] = {};
  return g[STORE]!;
}

/** بازنشانی محافظ‌ها و بازگرداندن پیاده‌سازی‌های اصلی (فقط برای تست) */
export function resetNetworkGuard(): void {
  const g = globalThis as unknown as Record<string, Originals | undefined>;
  const originals = g[STORE];
  if (!originals) return;
  if (originals.fetch) globalThis.fetch = originals.fetch;
  if (originals.XMLHttpRequest) globalThis.XMLHttpRequest = originals.XMLHttpRequest;
  if (originals.WebSocket) globalThis.WebSocket = originals.WebSocket;
  if (originals.EventSource) globalThis.EventSource = originals.EventSource;
  if (originals.sendBeacon && typeof navigator !== 'undefined') {
    navigator.sendBeacon = originals.sendBeacon;
  }
  delete g[STORE];
}

function denied(): never {
  throw new Error(DENIED_MESSAGE);
}

/**
 * مسدود کردن همهٔ APIهای شبکهٔ مرورگر.
 * فراخوانی هر کدام یک خطای روشن می‌دهد (و درخواست انجام نمی‌شود).
 */
export function installNetworkGuard(): void {
  const originals = store();

  if (typeof globalThis.fetch === 'function' && !originals.fetch) {
    originals.fetch = globalThis.fetch;
    globalThis.fetch = denied as unknown as typeof fetch;
  }

  if (typeof globalThis.XMLHttpRequest === 'function' && !originals.XMLHttpRequest) {
    originals.XMLHttpRequest = globalThis.XMLHttpRequest;
    globalThis.XMLHttpRequest = function XMLHttpRequest() {
      return denied();
    } as unknown as typeof XMLHttpRequest;
  }

  if (typeof globalThis.WebSocket === 'function' && !originals.WebSocket) {
    originals.WebSocket = globalThis.WebSocket;
    globalThis.WebSocket = function WebSocket() {
      return denied();
    } as unknown as typeof WebSocket;
  }

  if (typeof globalThis.EventSource === 'function' && !originals.EventSource) {
    originals.EventSource = globalThis.EventSource;
    globalThis.EventSource = function EventSource() {
      return denied();
    } as unknown as typeof EventSource;
  }

  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function' && !originals.sendBeacon) {
    originals.sendBeacon = navigator.sendBeacon;
    navigator.sendBeacon = denied as unknown as Navigator['sendBeacon'];
  }
}
