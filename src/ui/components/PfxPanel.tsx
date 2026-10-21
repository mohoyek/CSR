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
import { Field, Spinner, StatusLog, downloadBytes, type LogEntry } from './ui';

const STRENGTH_LABELS = ['خیلی ضعیف', 'ضعیف', 'متوسط', 'خوب', 'قوی'];

/**
 * ساخت فایل PFX (PKCS#12) از گواهی صادرشده و کلید خصوصی.
 *
 * این تب مستقل از ساخت CSR است: چند روز بعد و روی هر رایانه‌ای، فقط با
 * داشتن گواهی صادرشده و فایل mykey.key قابل استفاده است.
 */
export function PfxPanel() {
  const certInputRef = useRef<HTMLInputElement>(null);
  const keyInputRef = useRef<HTMLInputElement>(null);
  const chainInputRef = useRef<HTMLInputElement>(null);

  const [certDer, setCertDer] = useState<Uint8Array | null>(null);
  const [certName, setCertName] = useState<string | null>(null);
  const [chainDers, setChainDers] = useState<Uint8Array[]>([]);
  const [keyName, setKeyName] = useState<string | null>(null);
  const [keyPem, setKeyPem] = useState<string>('');
  const [exportPassword, setExportPassword] = useState('');
  const [exportConfirm, setExportConfirm] = useState('');
  const [legacy, setLegacy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);

  const strength = passphraseStrength(exportPassword);
  const confirmOk = passphrasesMatch(exportPassword, exportConfirm).ok;
  const passwordOk = exportPassword.length >= PASSPHRASE_MIN_LENGTH;

  const push = useCallback((entry: LogEntry) => {
    setLog((prev) => [...prev, entry]);
  }, []);

  const readCertificate = useCallback(
    async (file: File) => {
      setLog([]);
      try {
        const buf = await file.arrayBuffer();
        const text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
        const der = certificateDerFromInput(buf, text);
        parseCertificateDer(der); // validate that it really is an X.509 certificate
        setCertDer(der);
        setCertName(file.name);
        push({ level: 'success', text: `گواهی «${file.name}» خوانده شد.` });
      } catch (e) {
        setCertDer(null);
        setCertName(null);
        push({
          level: 'error',
          text: e instanceof Error ? `خواندن گواهی ناموفق بود: ${e.message}` : 'خواندن گواهی ناموفق بود',
        });
      }
    },
    [push]
  );

  const readChain = useCallback(
    async (file: File) => {
      try {
        const ders = certificateChainFromPem(await file.text());
        if (ders.length === 0) {
          push({ level: 'error', text: 'در فایل زنجیره، هیچ گواهی PEM یافت نشد.' });
          return;
        }
        setChainDers(ders);
        push({ level: 'success', text: `${ders.length} گواهی از زنجیرهٔ CA خوانده شد.` });
      } catch {
        push({ level: 'error', text: 'خواندن زنجیرهٔ CA ناموفق بود.' });
      }
    },
    [push]
  );

  const readKey = useCallback(
    async (file: File) => {
      setLog([]);
      setKeyName(file.name);
      setKeyPem(await file.text());
      push({ level: 'success', text: `کلید خصوصی «${file.name}» خوانده شد.` });
    },
    [push]
  );

  const handleBuild = useCallback(async () => {
    setLog([]);
    setBusy(true);
    try {
      if (!certDer) {
        push({ level: 'error', text: 'ابتدا فایل گواهی صادرشده را انتخاب کنید.' });
        return;
      }
      if (!keyPem) {
        push({ level: 'error', text: 'ابتدا فایل کلید خصوصی (mykey.key) را انتخاب کنید.' });
        return;
      }
      if (!passwordOk || !confirmOk) {
        push({ level: 'error', text: 'رمز خروجی معتبر نیست یا با تکرار آن یکسان نیست.' });
        return;
      }

      push({ level: 'info', text: 'در حال باز کردن کلید خصوصی…' });
      const { pkcs8 } = await loadPrivateKeyFile(keyPem, '');

      push({ level: 'info', text: 'در حال بررسی تطابق کلید و گواهی…' });
      const matches = await keyMatchesCertificate(certDer, pkcs8);
      if (!matches) {
        push({
          level: 'error',
          text: 'کلید عمومی گواهی با کلید خصوصی واردشده یکسان نیست — ساخت PFX متوقف شد.',
        });
        return;
      }
      push({ level: 'success', text: 'کلید عمومی گواهی با کلید خصوصی یکسان است.' });

      push({ level: 'info', text: 'در حال ساخت keystore.pfx…' });
      const pfx = await buildPfx({
        certs: { leaf: certDer, chain: chainDers },
        privateKeyPkcs8Der: pkcs8,
        exportPassword,
        legacy,
        friendlyName: 'keystore',
      });
      downloadBytes('keystore.pfx', pfx);
      push({ level: 'success', text: 'فایل keystore.pfx ساخته و دریافت شد.' });
    } catch (e) {
      push({ level: 'error', text: e instanceof Error ? e.message : 'ساخت فایل PFX ناموفق بود.' });
    } finally {
      setBusy(false);
    }
  }, [certDer, keyPem, passwordOk, confirmOk, exportPassword, legacy, chainDers, push]);

  return (
    <div className="space-y-4">
      <section className="card p-4">
        <h2 className="mb-3 text-base font-bold">ساخت keystore.pfx</h2>
        <p className="hint mb-4">
          برای ساخت PFX به گواهی صادرشده و فایل کلید خصوصی نیاز دارید. این کار را می‌توانید
          چند روز بعد و روی هر رایانه‌ای انجام دهید.
        </p>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* inputs */}
          <div className="space-y-3">
            <FileRow
              label="گواهی صادرشده"
              hint="فایل دریافتی از مرجع صدور (PEM یا DER؛ پسوندهای .crt / .cer / .pem)."
              picked={certName}
              onPick={() => certInputRef.current?.click()}
              inputRef={certInputRef}
              accept=".crt,.cer,.pem,.der,application/x-x509-ca-cert,application/pkix-cert"
              onFile={(f) => void readCertificate(f)}
            />
            <FileRow
              label="کلید خصوصی (mykey.key)"
              hint="همان فایلی که هنگام ساخت CSR گرفتید."
              picked={keyName}
              onPick={() => keyInputRef.current?.click()}
              inputRef={keyInputRef}
              accept=".key,.pem,application/x-pem-file"
              onFile={(f) => void readKey(f)}
            />
            <FileRow
              label="زنجیرهٔ CA (اختیاری)"
              hint="گواهی ریشه یا میانی، اگر دارید."
              picked={chainDers.length > 0 ? `${chainDers.length} گواهی` : null}
              onPick={() => chainInputRef.current?.click()}
              inputRef={chainInputRef}
              accept=".crt,.cer,.pem"
              onFile={(f) => void readChain(f)}
            />

          </div>

          {/* export password */}
          <div className="space-y-3">
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

            {exportPassword.length > 0 ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-600 dark:text-slate-300">قدرت رمز:</span>
                <span className="chip bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  {STRENGTH_LABELS[strength]}
                </span>
              </div>
            ) : null}

            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={legacy}
                onChange={(e) => setLegacy(e.target.checked)}
              />
              <span>
                <span className="block font-medium">سازگاری قدیمی (۳DES / SHA-1)</span>
                <span className="hint">
                  برای نسخه‌های قدیمی ویندوز و برنامه‌هایی که فقط PKCS#12 کلاسیک را می‌پذیرند.
                </span>
              </span>
            </label>

            <button
              type="button"
              className="btn-primary w-full"
              onClick={() => void handleBuild()}
              disabled={busy}
            >
              {busy ? <Spinner label="در حال ساخت…" /> : '📦 ساخت keystore.pfx'}
            </button>
          </div>
        </div>
      </section>

      {log.length > 0 ? <StatusLog entries={log} /> : null}
    </div>
  );
}

/** یک ردیف انتخاب فایل */
function FileRow({
  label,
  hint,
  picked,
  onPick,
  inputRef,
  accept,
  onFile,
}: {
  label: string;
  hint: string;
  picked: string | null;
  onPick: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  accept: string;
  onFile: (file: File) => void;
}) {
  return (
    <div>
      <p className="text-sm font-semibold">{label}</p>
      <p className="hint mb-1.5">{hint}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={onPick}>
          ⤒ انتخاب فایل
        </button>
        {picked ? (
          <span className="chip bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            ✓ {picked}
          </span>
        ) : null}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        aria-label={label}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}
