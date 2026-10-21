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
import { ASSUMPTIONS } from '../../core/assumptions';
import { Field, Notice, Spinner, StepBadge, copyToClipboard, downloadText } from './ui';
import { OrgPresetPanel } from './OrgPresetPanel';
import { SubjectPreview } from './SubjectPreview';

const PROFILE_LABELS: Record<ProfileId, string> = {
  1: 'گواهی امضای شخص حقیقی',
  2: 'گواهی امضای شخص حقوقی / مهر سازمانی',
  3: 'گواهی دفتر ثبت‌نام',
};

const PROFILE_HINTS: Record<ProfileId, string> = {
  1: 'برای کارمندان و اشخاص حقیقی وابسته به سازمان (پیوست ۱ راهنما)',
  2: 'مهر سازمانی و امضای رسمی اشخاص حقوقی (پیوست ۲ راهنما) — پرکاربردترین حالت',
  3: 'گواهی دفتر ثبت‌نام (پیوست ۳ راهنما)',
};

const CERT_TYPE_LABELS: Record<CertType, string> = {
  Gov: 'دولتی (Governmental)',
  NGO: 'غیردولتی (Non-Governmental)',
  Una: 'مستقل (Unaffiliated)',
};

const CERT_TYPE_HINTS: Record<CertType, string> = {
  Gov: 'وابسته به سازمان‌های دولتی',
  NGO: 'وابسته به سازمان‌های غیردولتی',
  Una: 'شخص حقیقی مستقل (بدون وابستگی سازمانی)',
};

const STEP_TITLES = [
  'انتخاب پروفایل',
  'تکمیل فرم',
  'بازبینی',
  'رمز عبور و تولید',
  'دریافت فایل‌ها',
];

const STRENGTH_LABELS = ['خیلی ضعیف', 'ضعیف', 'متوسط', 'خوب', 'قوی'];

export interface CsrWizardProps {
  onGenerated: (result: GenerateResult | null) => void;
  registerUnsaved: (dirty: boolean) => void;
}

export function CsrWizard({ onGenerated, registerUnsaved }: CsrWizardProps) {
  const [step, setStep] = useState(1);
  const [profileId, setProfileId] = useState<ProfileId>(2);
  const [certType, setCertType] = useState<CertType>('NGO');
  const [values, setValues] = useState<FormValues>({});
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

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

  // the wizard reports whether unsaved key material exists (beforeunload guard)
  useEffect(() => {
    registerUnsaved(result !== null);
  }, [result, registerUnsaved]);

  const setField = useCallback((id: string, value: string) => {
    setValues((prev) => ({ ...prev, [id]: value }));
    setError(null);
  }, []);

  const handleGenerate = useCallback(async () => {
    setError(null);
    if (!normalized.valid) {
      setError('لطفاً ابتدا خطاهای فرم را برطرف کنید.');
      setStep(2);
      return;
    }
    if (!passResult.ok || !confirmResult.ok) {
      setError('رمز عبور معتبر نیست یا با تکرار آن یکسان نیست.');
      setStep(4);
      return;
    }
    setBusy(true);
    try {
      const generated = await generateMaterials(rdns, passphrase);
      setResult(generated);
      onGenerated(generated);
      setStep(5);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تولید کلید و CSR ناموفق بود.');
    } finally {
      setBusy(false);
    }
  }, [normalized.valid, passResult.ok, confirmResult.ok, rdns, passphrase, onGenerated]);

  const handleReset = useCallback(() => {
    setValues({});
    setPassphrase('');
    setConfirm('');
    setResult(null);
    setError(null);
    setCopied(null);
    onGenerated(null);
    setStep(1);
  }, [onGenerated]);

  const canGoToStep3 = normalized.valid && rdns.length > 0;

  return (
    <div className="space-y-6">
      {/* ---------------- stepper ---------------- */}
      <nav aria-label="مراحل ساخت CSR">
        <ol className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {STEP_TITLES.map((title, i) => (
            <StepBadge
              key={title}
              index={i + 1}
              title={title}
              active={step === i + 1}
              done={step > i + 1}
            />
          ))}
        </ol>
      </nav>

      {/* ---------------- step 1 ---------------- */}
      {step === 1 ? (
        <section className="card p-5">
          <h2 className="mb-1 text-lg font-bold">۱) انتخاب نوع گواهی</h2>
          <p className="hint mb-4">
            پروفایل‌ها دقیقاً مطابق جدول‌های پیوست ۱ تا ۳ راهنمای GICA هستند. با تغییر پروفایل،
            فیلدهای فرم به‌طور خودکار تغییر می‌کنند.
          </p>

          <fieldset className="mb-5">
            <legend className="label">پروفایل گواهی</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {([1, 2, 3] as ProfileId[]).map((id) => (
                <label
                  key={id}
                  className={`cursor-pointer rounded-xl border p-3 transition-colors ${
                    profileId === id
                      ? 'border-brand-600 bg-brand-50 ring-2 ring-brand-500/40 dark:border-brand-500 dark:bg-brand-950/40'
                      : 'border-slate-300 hover:border-slate-400 dark:border-slate-700'
                  }`}
                >
                  <span className="flex items-start gap-2">
                    <input
                      type="radio"
                      name="profile"
                      className="mt-1"
                      checked={profileId === id}
                      onChange={() => {
                        setProfileId(id);
                        setResult(null);
                        onGenerated(null);
                        setError(null);
                      }}
                    />
                    <span>
                      <span className="block text-sm font-bold">{PROFILE_LABELS[id]}</span>
                      <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                        {PROFILE_HINTS[id]}
                      </span>
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="label">وابستگی سازمانی</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {profile.certTypes.map((t) => (
                <label
                  key={t}
                  className={`cursor-pointer rounded-xl border p-3 transition-colors ${
                    certType === t
                      ? 'border-brand-600 bg-brand-50 ring-2 ring-brand-500/40 dark:border-brand-500 dark:bg-brand-950/40'
                      : 'border-slate-300 hover:border-slate-400 dark:border-slate-700'
                  }`}
                >
                  <span className="flex items-start gap-2">
                    <input
                      type="radio"
                      name="certType"
                      className="mt-1"
                      checked={certType === t}
                      onChange={() => {
                        setCertType(t);
                        setResult(null);
                        onGenerated(null);
                      }}
                    />
                    <span>
                      <span className="block text-sm font-bold">{CERT_TYPE_LABELS[t]}</span>
                      <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                        {CERT_TYPE_HINTS[t]}
                      </span>
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="mt-6 flex justify-end">
            <button type="button" className="btn-primary" onClick={() => setStep(2)}>
              بعدی: تکمیل فرم ←
            </button>
          </div>
        </section>
      ) : null}

      {/* ---------------- step 2 ---------------- */}
      {step === 2 ? (
        <div className="grid gap-5 lg:grid-cols-[1fr_minmax(0,22rem)]">
          <section className="card p-5">
            <h2 className="mb-1 text-lg font-bold">۲) تکمیل فرم</h2>
            <p className="hint mb-4">
              فیلدهای ستاره‌دار اجباری هستند. نویسه‌های عربی «ي/ك» خودکار به «ی/ک» و ارقام
              فارسی به ارقام انگلیسی تبدیل می‌شوند. پسوندهای CN ([Sign]، [Stamp] و …) را
              خودکار اضافه می‌کنیم.
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
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
                    error={res?.error}
                    warning={res?.warning}
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
                        onChange={(e) => setField(f.id, e.target.value)}
                      />
                    )}
                  </Field>
                );
              })}
            </div>

            <div className="mt-5">
              <OrgPresetPanel
                values={values as Record<string, string>}
                certType={certType}
                onApply={(next, nextType) => {
                  setValues((prev) => ({ ...prev, ...next }));
                  setCertType(nextType);
                  setError(null);
                }}
              />
            </div>

            <div className="mt-6 flex flex-wrap justify-between gap-2">
              <button type="button" className="btn-ghost" onClick={() => setStep(1)}>
                → بازگشت
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => setStep(3)}
                disabled={!canGoToStep3}
              >
                بعدی: بازبینی ←
              </button>
            </div>
            {!canGoToStep3 ? (
              <p className="hint mt-2">برای ادامه، فیلدهای اجباری را تکمیل کنید.</p>
            ) : null}
          </section>

          <aside className="lg:sticky lg:top-4 lg:self-start">
            <div className="card p-4">
              <SubjectPreview rdns={rdns} />
            </div>
          </aside>
        </div>
      ) : null}

      {/* ---------------- step 3 ---------------- */}
      {step === 3 ? (
        <section className="card p-5">
          <h2 className="mb-1 text-lg font-bold">۳) بازبینی</h2>
          <p className="hint mb-4">
            خروجی زیر را با نمونهٔ راهنما مقایسه کنید. این همان چیزی است که در فایل CSR
            ثبت می‌شود.
          </p>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
            <SubjectPreview rdns={rdns} />

            <div className="space-y-3">
              <Notice tone="warning" title="فرضیات این پیاده‌سازی">
                <ul className="list-inside list-disc space-y-1">
                  {ASSUMPTIONS.map((a) => (
                    <li key={a.id}>
                      <strong>{a.title}:</strong> {a.default}
                    </li>
                  ))}
                </ul>
              </Notice>
              <Notice tone="info">
                اگر موضوع (Subject) با چیزی که سازمان شما در گواهی‌های قبلی دارد فرق دارد،
                همین‌جا اصلاح کنید؛ هنوز چیزی تولید نشده است.
              </Notice>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap justify-between gap-2">
            <button type="button" className="btn-ghost" onClick={() => setStep(2)}>
              → بازگشت به فرم
            </button>
            <button type="button" className="btn-primary" onClick={() => setStep(4)}>
              بعدی: رمز عبور ←
            </button>
          </div>
        </section>
      ) : null}

      {/* ---------------- step 4 ---------------- */}
      {step === 4 ? (
        <section className="card p-5">
          <h2 className="mb-1 text-lg font-bold">۴) رمز عبور و تولید</h2>
          <p className="hint mb-4">
            کلید خصوصی با این رمز عبور رمزنگاری می‌شود (PKCS#8 رمزگذاری‌شده). اگر رمز را
            فراموش کنید، امکان بازیابی کلید وجود ندارد.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="passphrase"
              label="رمز عبور کلید خصوصی"
              required
              error={passphrase.length > 0 ? passResult.error : undefined}
              hint={`حداقل ${PASSPHRASE_MIN_LENGTH} نویسه`}
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
                  onChange={(e) => {
                    setPassphrase(e.target.value);
                    setError(null);
                  }}
                />
              )}
            </Field>

            <Field
              id="passphrase-confirm"
              label="تکرار رمز عبور"
              required
              error={confirm.length > 0 ? confirmResult.error : undefined}
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
                  onChange={(e) => {
                    setConfirm(e.target.value);
                    setError(null);
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

          {error ? (
            <div className="mt-4">
              <Notice tone="danger">{error}</Notice>
            </div>
          ) : null}

          <div className="mt-6 flex flex-wrap justify-between gap-2">
            <button type="button" className="btn-ghost" onClick={() => setStep(3)}>
              → بازگشت
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => void handleGenerate()}
              disabled={busy || !passResult.ok || !confirmResult.ok}
            >
              {busy ? <Spinner label="در حال تولید…" /> : '🔐 تولید کلید و CSR'}
            </button>
          </div>
        </section>
      ) : null}

      {/* ---------------- step 5 ---------------- */}
      {step === 5 && result ? (
        <section className="card p-5">
          <h2 className="mb-1 text-lg font-bold">۵) دریافت فایل‌ها</h2>
          <p className="hint mb-4">
            سه فایل زیر با نام‌های راهنما ساخته شد. فایل <span className="ltr inline-block">mykey.key</span>{' '}
            محرمانه است.
          </p>

          <div className="mb-4">
            <Notice tone="success" title="خودارزیابی موفق">
              امضای CSR با کلید عمومی خودش راستی‌آزمایی شد و کلید رمزگذاری‌شده با همین رمز
              عبور دوباره باز و با کلید عمومی مقایسه شد.
            </Notice>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <DownloadCard
              filename="mycsr.txt"
              title="درخواست گواهی (CSR)"
              description="این فایل را برای صدور گواهی به مرجع صدور (CA) بفرستید."
              onDownload={() => downloadText('mycsr.txt', result.csrPem)}
              onCopy={async () => setCopied(await copyToClipboard(result.csrPem) ? 'mycsr.txt' : null)}
            />
            <DownloadCard
              filename="mykey.key"
              title="کلید خصوصی رمزگذاری‌شده"
              description="محرمانه — فقط نزد خودتان نگه دارید."
              danger
              onDownload={() => downloadText('mykey.key', result.encryptedKeyPem)}
              onCopy={async () => setCopied(await copyToClipboard(result.encryptedKeyPem) ? 'mykey.key' : null)}
            />
            <DownloadCard
              filename="mypublickey.pem"
              title="کلید عمومی"
              description="کلید عمومی متناظر با کلید خصوصی."
              onDownload={() => downloadText('mypublickey.pem', result.publicKeyPem)}
              onCopy={async () => setCopied(await copyToClipboard(result.publicKeyPem) ? 'mypublickey.pem' : null)}
            />
          </div>

          {copied ? (
            <p className="mt-3 text-xs font-medium text-emerald-600 dark:text-emerald-400" role="status">
              «{copied}» در حافظه کپی شد.
            </p>
          ) : null}

          <details className="mt-5">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700 dark:text-slate-200">
              مشاهدهٔ محتوای فایل‌ها
            </summary>
            <div className="mt-3 space-y-3">
              <div>
                <h4 className="mb-1 text-xs font-semibold">mycsr.txt</h4>
                <pre className="code max-h-64 overflow-y-auto">{result.csrPem}</pre>
              </div>
              <div>
                <h4 className="mb-1 text-xs font-semibold">mykey.key</h4>
                <pre className="code max-h-64 overflow-y-auto">{result.encryptedKeyPem}</pre>
              </div>
              <div>
                <h4 className="mb-1 text-xs font-semibold">mypublickey.pem</h4>
                <pre className="code max-h-64 overflow-y-auto">{result.publicKeyPem}</pre>
              </div>
            </div>
          </details>

          <div className="mt-6 flex flex-wrap justify-between gap-2">
            <button type="button" className="btn-ghost" onClick={() => setStep(1)}>
              → ساخت درخواست جدید
            </button>
            <button type="button" className="btn-secondary" onClick={handleReset}>
              پاک‌سازی کامل (Reset)
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function DownloadCard({
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
    <div
      className={`rounded-xl border p-4 ${
        danger
          ? 'border-red-300 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20'
          : 'border-slate-200 dark:border-slate-700'
      }`}
    >
      <h3 className="text-sm font-bold">{title}</h3>
      <p className="ltr mt-1 text-xs font-mono text-slate-500 dark:text-slate-400">{filename}</p>
      <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">{description}</p>
      <div className="mt-3 flex gap-2">
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
