import { useCallback, useEffect, useState } from 'react';
import { CsrForm } from './components/CsrForm';
import { PfxPanel } from './components/PfxPanel';
import type { CertType, ProfileId } from '../core/profiles';
import type { GenerateResult } from '../core/x509';

type Tab = ProfileId | 'pfx';

const THEME_STORAGE_KEY = 'gica-csr:theme';

const PROFILE_TABS: { id: ProfileId; label: string }[] = [
  { id: 1, label: 'شخص حقیقی' },
  { id: 2, label: 'مهر سازمانی' },
  { id: 3, label: 'دفتر ثبت‌نام' },
];

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
  const [tab, setTab] = useState<Tab>(2);
  const [certType, setCertType] = useState<CertType>('NGO');
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
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-extrabold sm:text-lg">
              ابزار ساخت CSR و PFX
            </h1>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">
              بر اساس راهنمای GICA (GICA.SW.User.CertProfilev1.0، نسخهٔ ۱.۰، ۱۴۰۴/۰۷/۲۵)
            </p>
          </div>
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

      <main className="mx-auto max-w-5xl space-y-4 px-4 py-5">
        {/* one-line confidentiality notice */}
        <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          <span aria-hidden="true">🔐</span>
          <p>
            فایل <span className="ltr inline-block">mykey.key</span> محرمانه است — آن را به
            هیچ‌کس ندهید. فقط <span className="ltr inline-block">mycsr.txt</span> را برای
            صدور گواهی بفرستید.
          </p>
        </div>

        {/* tabs */}
        <div role="tablist" aria-label="بخش‌های ابزار" className="flex flex-wrap gap-2">
          {PROFILE_TABS.map((t) => (
            <TabButton
              key={t.id}
              active={tab === t.id}
              onClick={() => setTab(t.id)}
              label={t.label}
            />
          ))}
          <TabButton
            active={tab === 'pfx'}
            onClick={() => setTab('pfx')}
            label="ساخت PFX"
          />
        </div>

        <div role="tabpanel">
          {tab === 'pfx' ? (
            <PfxPanel />
          ) : (
            <CsrForm
              key={tab}
              profileId={tab}
              certType={certType}
              onCertTypeChange={setCertType}
              onGenerated={handleGenerated}
              registerUnsaved={registerUnsaved}
            />
          )}
        </div>
      </main>

      <footer className="border-t border-slate-200 py-5 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
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
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-xl px-4 py-2 text-sm font-bold transition-colors ${
        active
          ? 'bg-brand-700 text-white shadow-sm'
          : 'border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
      }`}
    >
      {label}
    </button>
  );
}
