import type { ReactNode } from 'react';

/* ------------------------------------------------------------------ */
/* Notices                                                             */
/* ------------------------------------------------------------------ */

type NoticeTone = 'info' | 'warning' | 'danger' | 'success';

const NOTICE_STYLES: Record<NoticeTone, string> = {
  info: 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100',
  warning:
    'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100',
  danger:
    'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100',
  success:
    'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100',
};

const NOTICE_ICONS: Record<NoticeTone, string> = {
  info: 'ℹ',
  warning: '⚠',
  danger: '⛔',
  success: '✔',
};

export function Notice({
  tone = 'info',
  title,
  children,
}: {
  tone?: NoticeTone;
  title?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex gap-3 rounded-xl border p-4 text-sm leading-6 ${NOTICE_STYLES[tone]}`}
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      <span aria-hidden="true" className="text-lg leading-6">
        {NOTICE_ICONS[tone]}
      </span>
      <div className="min-w-0 flex-1">
        {title ? <p className="mb-1 font-bold">{title}</p> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Form field                                                          */
/* ------------------------------------------------------------------ */

export interface FieldProps {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  warning?: string;
  sample?: string;
  children: (props: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

/**
 * یک فیلد فرم با برچسب، نشانگر «اجباری»، متن راهنما و پیام خطای درون‌خطی.
 * الگوی `children` باعث می‌شود کنترل واقعی (input/select/textarea)
 * توسط فرم کنترل شود و برچسب و aria همیشه درست بمانند.
 */
export function Field({ id, label, required, hint, error, warning, sample, children }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const sampleId = sample ? `${id}-sample` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const warningId = warning ? `${id}-warning` : undefined;
  const describedBy = [errorId, warningId, hintId, sampleId].filter(Boolean).join(' ') || undefined;

  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
        {required ? (
          <span className="text-red-600 dark:text-red-400" aria-hidden="true">
            {' '}
            *
          </span>
        ) : null}
        {required ? <span className="sr-only">(اجباری)</span> : null}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint ? (
        <p id={hintId} className="hint">
          {hint}
        </p>
      ) : null}
      {sample ? (
        <p id={sampleId} className="hint">
          نمونه: <span className="ltr inline-block">{sample}</span>
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
      {warning ? (
        <p id={warningId} className="mt-1 text-xs font-medium text-amber-600 dark:text-amber-400">
          {warning}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */

export function CodeBlock({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div>
      {title ? <h4 className="mb-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</h4> : null}
      <pre className="code">{children}</pre>
    </div>
  );
}

export function StepBadge({ index, title, active, done }: { index: number; title: string; active: boolean; done: boolean }) {
  return (
    <li className="flex items-center gap-2" aria-current={active ? 'step' : undefined}>
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          done
            ? 'bg-brand-700 text-white'
            : active
              ? 'bg-brand-100 text-brand-900 ring-2 ring-brand-600 dark:bg-brand-900 dark:text-brand-100'
              : 'bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
        }`}
      >
        {done ? '✓' : index}
      </span>
      <span
        className={`text-xs sm:text-sm ${
          active ? 'font-bold text-slate-900 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'
        }`}
      >
        {title}
      </span>
    </li>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2" role="status" aria-live="polite">
      <span
        aria-hidden="true"
        className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
      />
      <span>{label}</span>
    </span>
  );
}

/** Download a text file from the browser (never leaves the page) */
export function downloadText(filename: string, content: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Download binary content (e.g. the .pfx) */
export function downloadBytes(filename: string, bytes: Uint8Array, mime = 'application/x-pkcs12') {
  const copy = new Uint8Array(bytes);
  const blob = new Blob([copy.buffer as ArrayBuffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Copy text to the clipboard, with a fallback for browsers without the API */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
