import { useCallback, useEffect, useState } from 'react';
import { CsrWizard } from './components/CsrWizard';
import { PfxPanel } from './components/PfxPanel';
import { Notice } from './components/ui';
import type { GenerateResult } from '../core/x509';

type Tab = 'csr' | 'pfx';
type Theme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'gica-csr:theme';

function readStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : null;
  } catch {
    return null;
  }
}

function preferredTheme(): Theme {
  const stored = readStoredTheme();
  if (stored) return stored;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export default function App() {
  const [tab, setTab] = useState<Tab>('csr');
  const [theme, setTheme] = useState<Theme>(preferredTheme);
  const [unsaved, setUnsaved] = useState(false);
  const [lastResult, setLastResult] = useState<GenerateResult | null>(null);

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
  const handleGenerated = useCallback((result: GenerateResult | null) => setLastResult(result), []);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-extrabold sm:text-lg">
              ابزار ساخت CSR و PFX — مرکز توسعه تجارت الکترونیکی
            </h1>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">
              بر اساس راهنمای GICA (GICA.SW.User.CertProfilev1.0، نسخهٔ ۱.۰، ۱۴۰۴/۰۷/۲۵)
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary px-3 py-1.5"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'تغییر به حالت روشن' : 'تغییر به حالت تاریک'}
          >
            {theme === 'dark' ? '☀ روشن' : '🌙 تاریک'}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6">
        <Notice tone="warning" title="🔐 کلید خصوصی را محرمانه نگه دارید">
          فایل <span className="ltr inline-block">mykey.key</span> حاوی کلید خصوصی شماست.
          <strong> این فایل را به هیچ‌کس ندهید و آن را برای هیچ‌کس ارسال نکنید.</strong> فقط
          فایل <span className="ltr inline-block">mycsr.txt</span> (درخواست گواهی) را برای
          صدور گواهی به مرجع صدور (CA) بفرستید. رمز عبور کلید را هم در اختیار هیچ‌کس
          قرار ندهید.
        </Notice>

        <div role="tablist" aria-label="بخش‌های ابزار" className="flex gap-2">
          <TabButton
            active={tab === 'csr'}
            onClick={() => setTab('csr')}
            label="ساخت CSR"
            icon="📝"
          />
          <TabButton
            active={tab === 'pfx'}
            onClick={() => setTab('pfx')}
            label="ساخت PFX"
            icon="📦"
          />
        </div>

        <div role="tabpanel">
          {tab === 'csr' ? (
            <CsrWizard onGenerated={handleGenerated} registerUnsaved={registerUnsaved} />
          ) : (
            <PfxPanel />
          )}
        </div>

        {lastResult && tab === 'csr' ? (
          <p className="hint text-center">
            کلید و CSR تولیدشده فقط در حافظهٔ همین صفحه نگهداری می‌شود و با بستن یا نوسازی
            صفحه از بین می‌رود. اگر فایل‌ها را نگرفته‌اید، ابتدا آن‌ها را دریافت کنید.
          </p>
        ) : null}
      </main>

      <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
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
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-xl px-4 py-2.5 text-sm font-bold transition-colors ${
        active
          ? 'bg-brand-700 text-white shadow-sm'
          : 'border border-slate-300 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
      }`}
    >
      <span aria-hidden="true">{icon}</span> {label}
    </button>
  );
}
