import { useRef, useState } from 'react';
import {
  buildOrgPreset,
  parseOrgPreset,
  presetToFormValues,
  type OrgPreset,
} from '../../core/orgPreset';
import type { CertType } from '../../core/profiles';
import { downloadText } from './ui';

/**
 * خروجی/ورودی پیش‌تنظیم سازمان — فقط داده‌های غیرمحرمانه.
 * هیچ کلید یا رمز عبوری ذخیره یا منتقل نمی‌شود.
 */
export function OrgPresetPanel({
  values,
  certType,
  onApply,
}: {
  values: Record<string, string>;
  certType: CertType;
  onApply: (values: Record<string, string>, certType: CertType) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleExport = () => {
    const preset = buildOrgPreset({
      name: values['ouOrg'] ?? '',
      nameEn: values['cnOrgNameEn'] ?? '',
      identifier: values['orgId'] ?? '',
      units: [values['ou1'] ?? '', values['ou2'] ?? '', values['ou3'] ?? ''],
      province: values['st'] ?? '',
      city: values['l'] ?? '',
      certType,
    });
    downloadText('org-preset.json', JSON.stringify(preset, null, 2), 'application/json');
    setMessage('پیش‌تنظیم سازمان ذخیره شد (فقط داده‌های غیرمحرمانه).');
    setError(null);
  };

  const handleImport = async (file: File) => {
    setMessage(null);
    setError(null);
    try {
      const text = await file.text();
      const preset: OrgPreset = parseOrgPreset(text);
      onApply(presetToFormValues(preset), preset.organization.certType);
      setMessage('پیش‌تنظیم سازمان اعمال شد.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خواندن پیش‌تنظیم ناموفق بود');
    }
  };

  return (
    <details className="rounded-xl border border-slate-200 dark:border-slate-700">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800">
        پیش‌تنظیم سازمان (ذخیرهٔ نام سازمان، واحدها، استان و شهر برای استفادهٔ بعدی)
      </summary>
      <div className="border-t border-slate-200 p-4 dark:border-slate-700">
        <p className="hint mb-3">
          این فایل <strong>هیچ کلید یا رمز عبوری</strong> در خود ندارد.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={handleExport}>
            ⤓ خروجی پیش‌تنظیم
          </button>
          <button
            type="button"
            className="btn-secondary px-3 py-1.5 text-xs"
            onClick={() => fileRef.current?.click()}
          >
            ⤒ ورود پیش‌تنظیم
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            aria-label="انتخاب فایل پیش‌تنظیم سازمان"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImport(file);
              e.target.value = '';
            }}
          />
        </div>
        {message ? (
          <p className="mt-2 text-xs font-medium text-emerald-600 dark:text-emerald-400" role="status">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className="mt-2 text-xs font-medium text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </details>
  );
}
