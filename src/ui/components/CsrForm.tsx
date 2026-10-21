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

export interface CsrFormProps {
  profileId: ProfileId;
  onGenerated: (result: GenerateResult | null) => void;
  registerUnsaved: (dirty: boolean) => void;
}

/**
 * فرم ساخت CSR — چیدمان دوستونی:
 *   ستون راست: فرم (فیلدها روی هم)
 *   ستون چپ:  وضعیت و سه باکس خروجی
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
    <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      {/* ---- ستون راست: فرم ---- */}
      <section className="card p-4">
        <h2 className="mb-3 text-sm font-bold">{profile.title}</h2>

        <div className="space-y-2">
          {fields.map((f: FieldDef) => {
            const presence = presenceOf(f, certType);
            const res = normalized.results[f.id];
            const value = values[f.id] ?? '';
            return (
              <div key={f.id} className="w-full sm:w-60">
                <Field
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
                      placeholder={f.placeholder}
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
              </div>
            );
          })}
        </div>

        <button
          type="button"
          className="btn-primary mt-3 w-full py-2"
          onClick={() => void handleGenerate()}
          disabled={busy}
        >
          {busy ? <Spinner label="در حال تولید…" /> : '🔐 تولید کلیدهای سازمان مودیبان'}
        </button>
        {result || Object.keys(values).length > 0 ? (
          <button type="button" className="btn-ghost mt-1 w-full" onClick={handleReset}>
            پاک‌سازی فرم
          </button>
        ) : null}
      </section>

      {/* ---- ستون چپ: وضعیت و خروجی ---- */}
      <div className="space-y-3">
        {log.length > 0 ? <StatusLog entries={log} /> : null}

        {result ? (
          <section className="card p-4">
            <h2 className="mb-3 text-sm font-bold">خروجی</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <OutputBox
                filename="CSR.txt"
                title="درخواست گواهی (CSR)"
                description="برای صدور گواهی بفرستید"
                content={result.csrPem}
                onDownload={() => downloadText('CSR.txt', result.csrPem)}
                onCopy={() => copy('CSR.txt', result.csrPem)}
              />
              <OutputBox
                filename="PrivateKey.key"
                title="کلید خصوصی"
                description="محرمانه — به هیچ‌کس ندهید"
                content={result.privateKeyPem}
                danger
                onDownload={() => downloadText('PrivateKey.key', result.privateKeyPem)}
                onCopy={() => copy('PrivateKey.key', result.privateKeyPem)}
              />
              <OutputBox
                filename="PublicKey.pem"
                title="کلید عمومی"
                description="کلید عمومی متناظر"
                content={result.publicKeyPem}
                onDownload={() => downloadText('PublicKey.pem', result.publicKeyPem)}
                onCopy={() => copy('PublicKey.pem', result.publicKeyPem)}
              />
            </div>
            {copied ? (
              <p className="mt-2 text-xs font-medium text-emerald-600 dark:text-emerald-400" role="status">
                «{copied}» در حافظه کپی شد.
              </p>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}

/**
 * یک باکس خروجی: دکمه‌ها بالای باکس، و محتوای فایل غیرقابل انتخاب
 * (بدون امکان کپی با ماوس و بدون منوی راست‌کلیک).
 */
function OutputBox({
  filename,
  title,
  description,
  content,
  onDownload,
  onCopy,
  danger,
}: {
  filename: string;
  title: string;
  description: string;
  content: string;
  onDownload: () => void;
  onCopy: () => void;
  danger?: boolean;
}) {
  const boxClass = danger
    ? 'border-red-300 dark:border-red-900'
    : 'border-slate-200 dark:border-slate-700';

  return (
    <div className={`flex flex-col overflow-hidden rounded-xl border ${boxClass}`}>
      <div className="border-b border-slate-200 p-2 dark:border-slate-700">
        <p className="text-xs font-bold">
          {title}
          {danger ? (
            <span className="mr-1.5 text-[10px] text-red-600 dark:text-red-400">محرمانه</span>
          ) : null}
        </p>
        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{description}</p>
        <p className="ltr mt-1 font-mono text-[10px] text-slate-400">{filename}</p>
        <div className="mt-1.5 flex items-center gap-1.5">
          <button type="button" className="btn-secondary px-2 py-1 text-[11px]" onClick={onDownload}>
            ⤓ دریافت
          </button>
          <button type="button" className="btn-ghost px-2 py-1 text-[11px]" onClick={onCopy}>
            ⧉ رونوشت
          </button>
        </div>
      </div>
      <pre
        className="max-h-32 flex-1 overflow-auto bg-slate-50 p-2 font-mono text-[10px] leading-4 text-slate-700 select-none dark:bg-slate-950 dark:text-slate-300"
        onContextMenu={(e) => e.preventDefault()}
        onDragStart={(e) => e.preventDefault()}
      >
        {content}
      </pre>
    </div>
  );
}
