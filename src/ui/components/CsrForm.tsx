import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getProfile,
  presenceOf,
  visibleFields,
  type CertType,
  type FieldDef,
  type ProfileId,
} from '../../core/profiles';
import {
  buildSubjectRdns,
  normalizeAndValidate,
  type FormValues,
  type RdnValue,
} from '../../core/dn';
import { generateMaterials, type GenerateResult } from '../../core/x509';
import {
  PASSPHRASE_MIN_LENGTH,
  passphraseStrength,
  passphrasesMatch,
  validatePassphrase,
} from '../../core/validate';
import { Field, Spinner, StatusLog, copyToClipboard, downloadText, type LogEntry } from './ui';
import { OrgPresetPanel } from './OrgPresetPanel';
import { SubjectPreview } from './SubjectPreview';

const CERT_TYPE_LABELS: Record<CertType, string> = {
  Gov: 'دولتی',
  NGO: 'غیردولتی',
  Una: 'مستقل',
};

const STRENGTH_LABELS = ['خیلی ضعیف', 'ضعیف', 'متوسط', 'خوب', 'قوی'];

export interface CsrFormProps {
  profileId: ProfileId;
  certType: CertType;
  onCertTypeChange: (type: CertType) => void;
  onGenerated: (result: GenerateResult | null) => void;
  registerUnsaved: (dirty: boolean) => void;
}

/**
 * فرم ساخت CSR — همه‌چیز در یک صفحه:
 * نوع گواهی، فرم، رمز عبور، دکمهٔ تولید، وضعیت و خروجی‌ها.
 */
export function CsrForm({
  profileId,
  certType,
  onCertTypeChange,
  onGenerated,
  registerUnsaved,
}: CsrFormProps) {
  const [values, setValues] = useState<FormValues>({});
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  /** فیلدهایی که کاربر در آن‌ها تایپ کرده — تا قبل از آن خطا نشان داده نمی‌شود */
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  /** تلاش برای تولید انجام شده — از این پس همهٔ خطاها نمایش داده می‌شود */
  const [submitted, setSubmitted] = useState(false);

  const showErrors = useCallback(
    (id: string) => submitted || touched.has(id),
    [submitted, touched]
  );

  const profile = getProfile(profileId);
  const fields = useMemo(() => visibleFields(profile, certType), [profile, certType]);
  const normalized = useMemo(
    () => normalizeAndValidate(profile, certType, values),
    [profile, certType, values]
  );
  const rdns: RdnValue[] = useMemo(
    () => buildSubjectRdns(profileId, certType, normalized.values),
    [profileId, certType, normalized.values]
  );

  const passResult = validatePassphrase(passphrase);
  const confirmResult = passphrasesMatch(passphrase, confirm);
  const strength = passphraseStrength(passphrase);

  useEffect(() => {
    registerUnsaved(result !== null);
  }, [result, registerUnsaved]);

  const setField = useCallback((id: string, value: string) => {
    setValues((prev) => ({ ...prev, [id]: value }));
    setResult(null);
    setCopied(null);
  }, []);

  const handleGenerate = useCallback(async () => {
    setBusy(true);
    setCopied(null);
    setResult(null);
    setSubmitted(true);
    setLog([{ level: 'info', text: 'در حال آماده‌سازی…' }]);

    const entries: LogEntry[] = [];
    const push = (entry: LogEntry) => {
      entries.push(entry);
      setLog([...entries]);
    };

    try {
      if (!normalized.valid) {
        push({ level: 'error', text: 'فرم ناقص است — فیلدهای ستاره‌دار را تکمیل کنید.' });
        return;
      }
      if (!passResult.ok || !confirmResult.ok) {
        push({ level: 'error', text: 'رمز عبور معتبر نیست یا با تکرار آن یکسان نیست.' });
        return;
      }
      if (rdns.length === 0) {
        push({ level: 'error', text: 'موضوع گواهی (CN) هنوز کامل نیست.' });
        return;
      }

      const generated = await generateMaterials(rdns, passphrase, (p) => push(p));
      setResult(generated);
      onGenerated(generated);
    } catch (e) {
      push({ level: 'error', text: e instanceof Error ? e.message : 'تولید کلید و CSR ناموفق بود.' });
    } finally {
      setBusy(false);
    }
  }, [normalized.valid, passResult.ok, confirmResult.ok, rdns, passphrase, onGenerated]);

  const handleReset = useCallback(() => {
    setValues({});
    setPassphrase('');
    setConfirm('');
    setResult(null);
    setLog([]);
    setCopied(null);
    onGenerated(null);
  }, [onGenerated]);

  const copy = async (name: string, text: string) => {
    setCopied((await copyToClipboard(text)) ? name : null);
  };

  return (
    <div className="space-y-4">
      {/* ---- type of certificate ---- */}
      <fieldset className="card p-4">
        <legend className="label">نوع گواهی</legend>
        <div className="flex flex-wrap gap-4">
          {profile.certTypes.map((t) => (
            <label key={t} className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                name="certType"
                checked={certType === t}
                onChange={() => {
                  onCertTypeChange(t);
                  setResult(null);
                }}
              />
              {CERT_TYPE_LABELS[t]}
              <span className="ltr text-xs text-slate-400">({t})</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* ---- the form ---- */}
      <section className="card p-4">
        <h2 className="mb-3 text-base font-bold">{profile.title}</h2>
        <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {fields.map((f: FieldDef) => {
            const presence = presenceOf(f, certType);
            const res = normalized.results[f.id];
            const value = values[f.id] ?? '';
            return (
              <Field
                key={f.id}
                id={`f-${f.id}`}
                label={f.label}
                required={presence === 'required'}
                sample={f.sample}
                error={showErrors(f.id) ? res?.error : undefined}
                warning={showErrors(f.id) ? res?.warning : undefined}
                hint={
                  f.hint ??
                  (f.lang === 'Fa'
                    ? 'این فیلد باید فارسی باشد (حروف لاتین فقط هشدار دارد).'
                    : f.lang === 'En'
                      ? 'این فیلد باید انگلیسی و فقط ASCII باشد.'
                      : undefined)
                }
              >
                {({ id, describedBy, invalid }) => (
                  <input
                    id={id}
                    type="text"
                    className={`input ${invalid ? 'input-error' : ''}`}
                    value={value}
                    aria-describedby={describedBy}
                    aria-invalid={invalid || undefined}
                    inputMode={f.numeric ? 'numeric' : undefined}
                    autoComplete="off"
                    spellCheck={false}
                    onBlur={() =>
                      setTouched((prev) => {
                        const next = new Set(prev);
                        next.add(f.id);
                        return next;
                      })
                    }
                    onChange={(e) => setField(f.id, e.target.value)}
                  />
                )}
              </Field>
            );
          })}
        </div>
      </section>

      {/* ---- passphrase ---- */}
      <section className="card p-4">
        <h2 className="mb-3 text-base font-bold">رمز عبور کلید خصوصی</h2>
        <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
          <Field
            id="passphrase"
            label={`رمز عبور (حداقل ${PASSPHRASE_MIN_LENGTH} نویسه)`}
            required
            error={showErrors('passphrase') ? passResult.error : undefined}
            hint="اگر رمز را فراموش کنید، بازیابی کلید ممکن نیست."
          >
            {({ id, describedBy, invalid }) => (
              <input
                id={id}
                type="password"
                className={`input ${invalid ? 'input-error' : ''}`}
                value={passphrase}
                autoComplete="new-password"
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                onBlur={() =>
                  setTouched((prev) => {
                    const next = new Set(prev);
                    next.add('passphrase');
                    return next;
                  })
                }
                onChange={(e) => {
                  setPassphrase(e.target.value);
                  setResult(null);
                }}
              />
            )}
          </Field>

          <Field
            id="passphrase-confirm"
            label="تکرار رمز عبور"
            required
            error={showErrors('passphrase-confirm') ? confirmResult.error : undefined}
          >
            {({ id, describedBy, invalid }) => (
              <input
                id={id}
                type="password"
                className={`input ${invalid ? 'input-error' : ''}`}
                value={confirm}
                autoComplete="new-password"
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                onBlur={() =>
                  setTouched((prev) => {
                    const next = new Set(prev);
                    next.add('passphrase-confirm');
                    return next;
                  })
                }
                onChange={(e) => {
                  setConfirm(e.target.value);
                  setResult(null);
                }}
              />
            )}
          </Field>
        </div>

        {passphrase.length > 0 ? (
          <div className="mt-3 flex items-center gap-2">
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

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-primary"
            onClick={() => void handleGenerate()}
            disabled={busy}
          >
            {busy ? <Spinner label="در حال تولید…" /> : '🔐 تولید CSR و کلیدها'}
          </button>
          {result || values['ouOrg'] ? (
            <button type="button" className="btn-ghost" onClick={handleReset}>
              پاک‌سازی
            </button>
          ) : null}
        </div>
      </section>

      {/* ---- status ---- */}
      {log.length > 0 ? <StatusLog entries={log} /> : null}

      {/* ---- output ---- */}
      {result ? (
        <section className="card p-4">
          <h2 className="mb-3 text-base font-bold">خروجی</h2>
          <div className="divide-y divide-slate-200 dark:divide-slate-700">
            <OutputRow
              filename="mycsr.txt"
              title="درخواست گواهی (CSR)"
              description="این فایل را برای صدور گواهی به مرجع صدور (CA) بفرستید."
              onDownload={() => downloadText('mycsr.txt', result.csrPem)}
              onCopy={() => copy('mycsr.txt', result.csrPem)}
            />
            <OutputRow
              filename="mykey.key"
              title="کلید خصوصی رمزگذاری‌شده"
              description="محرمانه — فقط نزد خودتان نگه دارید و به هیچ‌کس ندهید."
              danger
              onDownload={() => downloadText('mykey.key', result.encryptedKeyPem)}
              onCopy={() => copy('mykey.key', result.encryptedKeyPem)}
            />
            <OutputRow
              filename="mypublickey.pem"
              title="کلید عمومی"
              description="کلید عمومی متناظر با کلید خصوصی."
              onDownload={() => downloadText('mypublickey.pem', result.publicKeyPem)}
              onCopy={() => copy('mypublickey.pem', result.publicKeyPem)}
            />
          </div>
          {copied ? (
            <p className="mt-2 text-xs font-medium text-emerald-600 dark:text-emerald-400" role="status">
              «{copied}» در حافظه کپی شد.
            </p>
          ) : null}

          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-semibold text-slate-600 dark:text-slate-300">
              نمایش محتوای فایل‌ها
            </summary>
            <div className="mt-2 space-y-2">
              <div>
                <p className="mb-1 text-xs font-semibold">mycsr.txt</p>
                <pre className="code max-h-64 overflow-y-auto">{result.csrPem}</pre>
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold">mykey.key</p>
                <pre className="code max-h-64 overflow-y-auto">{result.encryptedKeyPem}</pre>
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold">mypublickey.pem</p>
                <pre className="code max-h-64 overflow-y-auto">{result.publicKeyPem}</pre>
              </div>
            </div>
          </details>
        </section>
      ) : null}

      {/* ---- rarely used: preview and organization preset ---- */}
      <details className="rounded-xl border border-slate-200 dark:border-slate-700">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800">
          پیش‌نمایش موضوع گواهی (Subject) و معادل config.txt
        </summary>
        <div className="border-t border-slate-200 p-4 dark:border-slate-700">
          <SubjectPreview rdns={rdns} />
        </div>
      </details>

      <OrgPresetPanel
        values={values as Record<string, string>}
        certType={certType}
        onApply={(next, nextType) => {
          setValues((prev) => ({ ...prev, ...next }));
          onCertTypeChange(nextType);
        }}
      />
    </div>
  );
}

function OutputRow({
  filename,
  title,
  description,
  onDownload,
  onCopy,
  danger,
}: {
  filename: string;
  title: string;
  description: string;
  onDownload: () => void;
  onCopy: () => void;
  danger?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">
          {title}
          {danger ? <span className="mr-2 text-xs text-red-600 dark:text-red-400">محرمانه</span> : null}
        </p>
        <p className="ltr text-xs font-mono text-slate-500 dark:text-slate-400">{filename}</p>
        <p className="text-xs text-slate-600 dark:text-slate-300">{description}</p>
      </div>
      <div className="flex gap-2">
        <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={onDownload}>
          ⤓ دریافت
        </button>
        <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={onCopy}>
          ⧉ رونوشت
        </button>
      </div>
    </div>
  );
}
