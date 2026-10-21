import { useCallback, useEffect, useState } from 'react';
import { CsrForm } from './components/CsrForm';
import type { ProfileId } from '../core/profiles';
import type { GenerateResult } from '../core/x509';

type Tab = ProfileId;

const THEME_STORAGE_KEY = 'gica-csr:theme';

const PROFILE_TABS: { id: ProfileId; label: string }[] = [
  { id: 1, label: 'شخص حقیقی' },
  { id: 2, label: 'شخص حقوقی' },
];

const PROFILE_TABS_HINTS: Record<ProfileId, string> = {
  1: 'گواهی امضای شخص حقیقی مستقل',
  2: 'گواهی امضای شخص حقوقی غیردولتی',
  3: 'گواهی دفتر ثبت‌نام',
};

function preferredTheme(): 'light' | 'dark' {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* storage may be unavailable */
  }
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export default function App() {
  const [tab, setTab] = useState<Tab>(1);
  const [theme, setTheme] = useState<'light' | 'dark'>(preferredTheme);
  const [unsaved, setUnsaved] = useState(false);

  // theme — only the colour preference is stored, never key material
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.classList.toggle('light', theme === 'light');
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* storage may be unavailable — the theme still works */
    }
  }, [theme]);

  // warn before leaving the page while unsaved key material exists
  useEffect(() => {
    if (!unsaved) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [unsaved]);

  const registerUnsaved = useCallback((dirty: boolean) => setUnsaved(dirty), []);
  const handleGenerated = useCallback((_result: GenerateResult | null) => {
    /* the result lives in the form component; nothing to keep here */
  }, []);

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5">
          <h1 className="min-w-0 flex-1 truncate text-base font-extrabold sm:text-lg">
            ابزار ساخت کلید های مودیان
          </h1>
          <button
            type="button"
            className="btn-secondary px-3 py-1.5"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            aria-label={theme === 'dark' ? 'تغییر به حالت روشن' : 'تغییر به حالت تاریک'}
          >
            {theme === 'dark' ? '☀ روشن' : '🌙 تاریک'}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-3 px-4 py-3">
        {/* ---- انتخاب نوع گواهی (جدول: شخص حقیقی راست، شخص حقوقی چپ) ---- */}
        <div
          role="tablist"
          aria-label="نوع گواهی"
          className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        >
          {PROFILE_TABS.map((t) => (
            <TabButton
              key={t.id}
              active={tab === t.id}
              onClick={() => setTab(t.id)}
              label={t.label}
              hint={PROFILE_TABS_HINTS[t.id]}
            />
          ))}
        </div>

        <div role="tabpanel">
          <CsrForm
            key={tab}
            profileId={tab}
            onGenerated={handleGenerated}
            registerUnsaved={registerUnsaved}
          />
        </div>
      </main>

      <footer className="border-t border-slate-200 py-2.5 text-center text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
        همهٔ عملیات رمزنگاری درون مرورگر شما انجام می‌شود؛ هیچ داده‌ای به هیچ سروری ارسال
        نمی‌شود.
      </footer>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-xl border px-4 py-2 text-right transition-colors ${
        active
          ? 'border-brand-600 bg-brand-50 ring-2 ring-brand-500/40 dark:border-brand-500 dark:bg-brand-950/40'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800'
      }`}
    >
      <span className="block text-sm font-bold text-slate-800 dark:text-slate-100">{label}</span>
      <span className="mt-0.5 block text-[11px] text-slate-500 dark:text-slate-400">{hint}</span>
    </button>
  );
}
