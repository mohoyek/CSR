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
import { Field, Spinner, StatusLog, copyToClipboard, downloadText, type LogEntry } from './ui';
import { SubjectPreview } from './SubjectPreview';

export interface CsrFormProps {
  profileId: ProfileId;
  onGenerated: (result: GenerateResult | null) => void;
  registerUnsaved: (dirty: boolean) => void;
}

/**
 * فرم ساخت CSR — همه‌چیز در یک صفحه:
 * نوع گواهی، فرم، دکمهٔ تولید، وضعیت و خروجی‌ها.
 */
export function CsrForm({ profileId, onGenerated, registerUnsaved }: CsrFormProps) {
  const [values, setValues] = useState<FormValues>({});
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  /** فیلدهایی که کاربر در آن‌ها تایپ کرده — تا قبل از آن خطا نشان داده نمی‌شود */
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  /** تلاش برای تولید انجام شده — از این پس همهٔ خطاها نمایش داده می‌شود */
  const [submitted, setSubmitted] = useState(false);

  const profile = getProfile(profileId);
  /** هر پروفایل فقط یک نوع گواهی دارد (شخص حقیقی: مستقل، شخص حقوقی: غیردولتی) */
  const certType: CertType = profile.certTypes[0]!;
  const fields = useMemo(() => visibleFields(profile, certType), [profile, certType]);
  const normalized = useMemo(
    () => normalizeAndValidate(profile, certType, values),
    [profile, certType, values]
  );
  const rdns: RdnValue[] = useMemo(
    () => buildSubjectRdns(profileId, certType, normalized.values),
    [profileId, certType, normalized.values]
  );

  const showErrors = useCallback(
    (id: string) => submitted || touched.has(id),
    [submitted, touched]
  );

  useEffect(() => {
    registerUnsaved(result !== null);
  }, [result, registerUnsaved]);

  const setField = useCallback((id: string, value: string) => {
    setValues((prev) => ({ ...prev, [id]: value }));
    setResult(null);
    setCopied(null);
  }, []);

  const markTouched = useCallback((id: string) => {
    setTouched((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
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
      if (rdns.length === 0) {
        push({ level: 'error', text: 'موضوع گواهی (CN) هنوز کامل نیست.' });
        return;
      }

      const generated = await generateMaterials(rdns, (p) => push(p));
      setResult(generated);
      onGenerated(generated);
    } catch (e) {
      push({ level: 'error', text: e instanceof Error ? e.message : 'تولید کلید و CSR ناموفق بود.' });
    } finally {
      setBusy(false);
    }
  }, [normalized.valid, rdns, onGenerated]);

  const handleReset = useCallback(() => {
    setValues({});
    setResult(null);
    setLog([]);
    setCopied(null);
    setTouched(new Set());
    setSubmitted(false);
    onGenerated(null);
  }, [onGenerated]);

  const copy = async (name: string, text: string) => {
    setCopied((await copyToClipboard(text)) ? name : null);
  };

  return (
    <div className="space-y-3">

      {/* ---- the form ---- */}
      <section className="card p-4">
        <h2 className="mb-3 text-base font-bold">{profile.title}</h2>
        <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
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
                error={showErrors(f.id) ? res?.error : undefined}
                warning={showErrors(f.id) ? res?.warning : undefined}
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
                    onBlur={() => markTouched(f.id)}
                    onChange={(e) => setField(f.id, e.target.value)}
                  />
                )}
              </Field>
            );
          })}
        </div>

        <button
          type="button"
          className="btn-primary mt-4 w-full py-3"
          onClick={() => void handleGenerate()}
          disabled={busy}
        >
          {busy ? <Spinner label="در حال تولید…" /> : '🔐 تولید کلیدهای سازمان مودیبان'}
        </button>
        {result || Object.keys(values).length > 0 ? (
          <button type="button" className="btn-ghost mt-2 w-full" onClick={handleReset}>
            پاک‌سازی فرم
          </button>
        ) : null}
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
              title="کلید خصوصی"
              description="محرمانه — فقط نزد خودتان نگه دارید و به هیچ‌کس ندهید."
              danger
              onDownload={() => downloadText('mykey.key', result.privateKeyPem)}
              onCopy={() => copy('mykey.key', result.privateKeyPem)}
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
                <pre className="code max-h-64 overflow-y-auto">{result.privateKeyPem}</pre>
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
