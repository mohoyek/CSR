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
  error?: string;
  warning?: string;
  children: (props: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}

/**
 * یک فیلد فرم با برچسب، نشانگر «اجباری» و پیام خطای درون‌خطی.
 * الگوی `children` باعث می‌شود کنترل واقعی (input/select/textarea)
 * توسط فرم کنترل شود و برچسب و aria همیشه درست بمانند.
 */
export function Field({ id, label, required, error, warning, children }: FieldProps) {
  const errorId = error ? `${id}-error` : undefined;
  const warningId = warning ? `${id}-warning` : undefined;
  const describedBy = [errorId, warningId].filter(Boolean).join(' ') || undefined;

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
/* Status log                                                          */
/* ------------------------------------------------------------------ */

export interface LogEntry {
  level: 'info' | 'success' | 'error';
  text: string;
}

const LOG_ICONS: Record<LogEntry['level'], string> = {
  info: '•',
  success: '✔',
  error: '✖',
};

const LOG_COLORS: Record<LogEntry['level'], string> = {
  info: 'text-slate-600 dark:text-slate-300',
  success: 'text-emerald-600 dark:text-emerald-400',
  error: 'text-red-600 dark:text-red-400',
};

/** ناحیهٔ «وضعیت» — گزارش مرحله‌به‌مرحلهٔ کار */
export function StatusLog({ entries }: { entries: LogEntry[] }) {
  return (
    <div
      className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950"
      role="log"
      aria-live="polite"
    >
      {entries.length === 0 ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">هنوز کاری انجام نشده است.</p>
      ) : (
        <ul className="space-y-1">
          {entries.map((entry, i) => (
            <li key={`${i}-${entry.text}`} className={`flex gap-2 text-xs ${LOG_COLORS[entry.level]}`}>
              <span aria-hidden="true" className="w-3 shrink-0 text-center">
                {LOG_ICONS[entry.level]}
              </span>
              <span>{entry.text}</span>
            </li>
          ))}
        </ul>
      )}
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

/** بخش تاشو (collapsible) برای موارد کم‌کاربرد */
export function Collapsible({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} className="rounded-xl border border-slate-200 dark:border-slate-700">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800">
        {title}
      </summary>
      <div className="border-t border-slate-200 p-4 dark:border-slate-700">{children}</div>
    </details>
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
