import { useCallback, useRef, useState } from 'react';
import {
  buildPfx,
  certificateChainFromPem,
  certificateDerFromInput,
  keyMatchesCertificate,
  loadPrivateKeyFile,
  parseCertificateDer,
} from '../../core/pfx';
import { PASSPHRASE_MIN_LENGTH, passphraseStrength, passphrasesMatch } from '../../core/validate';
import { Field, Notice, Spinner, downloadBytes } from './ui';

const STRENGTH_LABELS = ['خیلی ضعیف', 'ضعیف', 'متوسط', 'خوب', 'قوی'];

interface CertificateFile {
  name: string;
  der: Uint8Array;
}

/**
 * ساخت فایل PFX (PKCS#12) از گواهی صادرشده و کلید خصوصی.
 *
 * این تب مستقل از تب «ساخت CSR» است: می‌توانید چند روز بعد، فقط با
 * داشتن گواهی صادرشده و فایل mykey.key، این کار را انجام دهید.
 * هیچ داده‌ای از تب قبلی به اینجا منتقل نمی‌شود.
 */
export function PfxPanel() {
  const certInputRef = useRef<HTMLInputElement>(null);
  const keyInputRef = useRef<HTMLInputElement>(null);
  const chainInputRef = useRef<HTMLInputElement>(null);

  const [cert, setCert] = useState<CertificateFile | null>(null);
  const [chain, setChain] = useState<CertificateFile[]>([]);
  const [keyPem, setKeyPem] = useState<string>('');
  const [keyName, setKeyName] = useState<string>('');
  const [keyPassphrase, setKeyPassphrase] = useState('');
  const [exportPassword, setExportPassword] = useState('');
  const [exportConfirm, setExportConfirm] = useState('');
  const [legacy, setLegacy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [keyMatch, setKeyMatch] = useState<boolean | null>(null);

  const strength = passphraseStrength(exportPassword);
  const confirmOk = passphrasesMatch(exportPassword, exportConfirm).ok;
  const passwordOk = exportPassword.length >= PASSPHRASE_MIN_LENGTH;

  const readCertificate = useCallback(async (file: File) => {
    setError(null);
    setSuccess(null);
    try {
      const buf = await file.arrayBuffer();
      const text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
      const der = certificateDerFromInput(buf, text);
      // validate that it really is an X.509 certificate
      parseCertificateDer(der);
      setCert({ name: file.name, der });
    } catch (e) {
      setCert(null);
      setError(
        e instanceof Error
          ? `خواندن گواهی ناموفق بود: ${e.message}`
          : 'خواندن گواهی ناموفق بود'
      );
    }
  }, []);

  const readChain = useCallback(async (file: File) => {
    setError(null);
    try {
      const text = await file.text();
      const ders = certificateChainFromPem(text);
      if (ders.length === 0) {
        setError('در فایل زنجیره، هیچ گواهی PEM یافت نشد.');
        return;
      }
      setChain(ders.map((der, i) => ({ name: `${file.name}#${i + 1}`, der })));
    } catch {
      setError('خواندن زنجیرهٔ CA ناموفق بود.');
    }
  }, []);

  const readKey = useCallback(async (file: File) => {
    setError(null);
    setKeyName(file.name);
    setKeyPem(await file.text());
  }, []);

  const handleCheckMatch = useCallback(async () => {
    if (!cert || !keyPem) return;
    setError(null);
    setKeyMatch(null);
    try {
      const { pkcs8 } = await loadPrivateKeyFile(keyPem, keyPassphrase);
      const matches = await keyMatchesCertificate(cert.der, pkcs8);
      setKeyMatch(matches);
      if (!matches) {
        setError(
          'کلید عمومی گواهی با کلید خصوصی واردشده یکسان نیست. این فایل PFX ساخته نخواهد شد.'
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'بررسی تطابق کلید ناموفق بود.');
    }
  }, [cert, keyPem, keyPassphrase]);

  const handleBuild = useCallback(async () => {
    setError(null);
    setSuccess(null);
    if (!cert) {
      setError('ابتدا فایل گواهی صادرشده را انتخاب کنید.');
      return;
    }
    if (!keyPem) {
      setError('ابتدا فایل کلید خصوصی (mykey.key) را انتخاب کنید.');
      return;
    }
    if (!passwordOk || !confirmOk) {
      setError('رمز خروجی معتبر نیست یا با تکرار آن یکسان نیست.');
      return;
    }

    setBusy(true);
    try {
      const { pkcs8 } = await loadPrivateKeyFile(keyPem, keyPassphrase);
      const matches = await keyMatchesCertificate(cert.der, pkcs8);
      if (!matches) {
        setError(
          'کلید عمومی گواهی با کلید خصوصی واردشده یکسان نیست — ساخت PFX متوقف شد.'
        );
        return;
      }
      const pfx = await buildPfx({
        certs: { leaf: cert.der, chain: chain.map((c) => c.der) },
        privateKeyPkcs8Der: pkcs8,
        exportPassword,
        legacy,
        friendlyName: 'keystore',
      });
      downloadBytes('keystore.pfx', pfx);
      setKeyMatch(true);
      setSuccess('فایل keystore.pfx ساخته و دریافت شد.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ساخت فایل PFX ناموفق بود.');
    } finally {
      setBusy(false);
    }
  }, [cert, keyPem, keyPassphrase, passwordOk, confirmOk, exportPassword, legacy, chain]);

  return (
    <div className="space-y-5">
      <Notice tone="info" title="این تب مستقل است">
        برای ساخت PFX به گواهی صادرشده و فایل کلید خصوصی نیاز دارید. می‌توانید این کار را
        چند روز بعد و روی هر رایانه‌ای انجام دهید؛ هیچ اطلاعاتی از بخش «ساخت CSR» اینجا
        منتقل نمی‌شود.
      </Notice>

      <section className="card p-5">
        <h2 className="mb-4 text-lg font-bold">ساخت keystore.pfx</h2>

        <div className="grid gap-5 lg:grid-cols-2">
          {/* ---- certificate ---- */}
          <div className="space-y-4">
            <div>
              <h3 className="mb-2 text-sm font-bold">۱) گواهی صادرشده</h3>
              <p className="hint mb-2">
                فایل گواهی که از مرجع صدور دریافت کرده‌اید (PEM یا DER، پسوندهای
                <span className="ltr inline-block"> .crt / .cer / .pem</span>).
              </p>
              <input
                ref={certInputRef}
                type="file"
                accept=".crt,.cer,.pem,.der,application/x-x509-ca-cert,application/pkix-cert"
                className="sr-only"
                aria-label="انتخاب فایل گواهی صادرشده"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void readCertificate(file);
                  e.target.value = '';
                }}
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => certInputRef.current?.click()}
                >
                  ⤒ انتخاب گواهی
                </button>
                {cert ? (
                  <span className="chip bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    ✓ {cert.name}
                  </span>
                ) : null}
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-bold">۲) کلید خصوصی (mykey.key)</h3>
              <p className="hint mb-2">
                همان فایل رمزگذاری‌شده‌ای که در مرحلهٔ ساخت CSR گرفتید.
              </p>
              <input
                ref={keyInputRef}
                type="file"
                accept=".key,.pem,application/x-pem-file"
                className="sr-only"
                aria-label="انتخاب فایل کلید خصوصی"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void readKey(file);
                  e.target.value = '';
                }}
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => keyInputRef.current?.click()}
                >
                  ⤒ انتخاب کلید خصوصی
                </button>
                {keyName ? (
                  <span className="chip bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    ✓ {keyName}
                  </span>
                ) : null}
              </div>
            </div>

            <Field
              id="key-passphrase"
              label="رمز عبور فایل کلید خصوصی"
              hint="همان رمزی که هنگام ساخت CSR انتخاب کردید."
            >
              {({ id, describedBy }) => (
                <input
                  id={id}
                  type="password"
                  className="input"
                  value={keyPassphrase}
                  autoComplete="off"
                  aria-describedby={describedBy}
                  onChange={(e) => {
                    setKeyPassphrase(e.target.value);
                    setKeyMatch(null);
                  }}
                />
              )}
            </Field>

            <button
              type="button"
              className="btn-secondary"
              onClick={() => void handleCheckMatch()}
              disabled={!cert || !keyPem}
            >
              🔍 بررسی تطابق کلید و گواهی
            </button>
            {keyMatch === true ? (
              <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400" role="status">
                ✓ کلید عمومی گواهی با کلید خصوصی یکسان است.
              </p>
            ) : null}

            <div>
              <h3 className="mb-2 text-sm font-bold">۳) زنجیرهٔ CA (اختیاری)</h3>
              <p className="hint mb-2">
                اگر گواهی ریشه یا گواهی میانی دارید، اینجا اضافه کنید تا در PFX قرار گیرد.
              </p>
              <input
                ref={chainInputRef}
                type="file"
                accept=".crt,.cer,.pem"
                className="sr-only"
                aria-label="انتخاب فایل زنجیرهٔ CA"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void readChain(file);
                  e.target.value = '';
                }}
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => chainInputRef.current?.click()}
                >
                  ⤒ انتخاب زنجیره
                </button>
                {chain.length > 0 ? (
                  <span className="chip bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    ✓ {chain.length} گواهی
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {/* ---- export password + options ---- */}
          <div className="space-y-4">
            <div className="grid gap-4">
              <Field
                id="export-password"
                label="رمز خروجی PFX"
                required
                hint={`حداقل ${PASSPHRASE_MIN_LENGTH} نویسه — هنگام وارد کردن فایل در ویندوز لازم است.`}
                error={exportPassword.length > 0 && !passwordOk ? `رمز باید حداقل ${PASSPHRASE_MIN_LENGTH} نویسه باشد` : undefined}
              >
                {({ id, describedBy, invalid }) => (
                  <input
                    id={id}
                    type="password"
                    className={`input ${invalid ? 'input-error' : ''}`}
                    value={exportPassword}
                    autoComplete="new-password"
                    aria-describedby={describedBy}
                    aria-invalid={invalid || undefined}
                    onChange={(e) => setExportPassword(e.target.value)}
                  />
                )}
              </Field>

              <Field
                id="export-confirm"
                label="تکرار رمز خروجی"
                required
                error={exportConfirm.length > 0 && !confirmOk ? 'رمز و تکرار آن یکسان نیستند' : undefined}
              >
                {({ id, describedBy, invalid }) => (
                  <input
                    id={id}
                    type="password"
                    className={`input ${invalid ? 'input-error' : ''}`}
                    value={exportConfirm}
                    autoComplete="new-password"
                    aria-describedby={describedBy}
                    aria-invalid={invalid || undefined}
                    onChange={(e) => setExportConfirm(e.target.value)}
                  />
                )}
              </Field>
            </div>

            {exportPassword.length > 0 ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-600 dark:text-slate-300">قدرت رمز:</span>
                <span className="chip bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  {STRENGTH_LABELS[strength]}
                </span>
                <span className="flex gap-1" aria-hidden="true">
                  {[0, 1, 2, 3].map((i) => (
                    <span
                      key={i}
                      className={`h-1.5 w-6 rounded-full ${
                        i < strength ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-700'
                      }`}
                    />
                  ))}
                </span>
              </div>
            ) : null}

            <details className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <summary className="cursor-pointer text-sm font-semibold text-slate-700 dark:text-slate-200">
                تنظیمات پیشرفته
              </summary>
              <label className="mt-3 flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={legacy}
                  onChange={(e) => setLegacy(e.target.checked)}
                />
                <span className="text-sm">
                  <span className="block font-medium">سازگاری قدیمی (۳DES / SHA-1)</span>
                  <span className="hint">
                    برای نسخه‌های قدیمی ویندوز و برنامه‌هایی که فقط PKCS#12 کلاسیک را می‌پذیرند.
                    در حالت پیش‌فرض، PFX با AES-256 و MAC بر پایهٔ SHA-1 ساخته می‌شود.
                  </span>
                </span>
              </label>
            </details>

            {error ? <Notice tone="danger">{error}</Notice> : null}
            {success ? <Notice tone="success">{success}</Notice> : null}

            <button
              type="button"
              className="btn-primary w-full"
              onClick={() => void handleBuild()}
              disabled={busy || !cert || !keyPem || !passwordOk || !confirmOk}
            >
              {busy ? <Spinner label="در حال ساخت…" /> : '📦 ساخت و دریافت keystore.pfx'}
            </button>

            <p className="hint">
              ساخت PFX ممکن است چند ثانیه طول بکشد (مشتق کلید با تعداد بالای تکرار).
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
