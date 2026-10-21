import { opensslConfig, subjectLine, type RdnValue } from '../../core/dn';
import { CodeBlock } from './ui';

/**
 * پیش‌نمایش زندهٔ موضوع گواهی (Subject) و معادل فایل config.txt راهنما،
 * تا کاربر بتواند خروجی را با نمونهٔ راهنما مقایسه کند.
 */
export function SubjectPreview({ rdns }: { rdns: RdnValue[] }) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
          موضوع گواهی (Subject)
        </h3>
        {rdns.length === 0 ? (
          <p className="hint">هنوز فیلدی تکمیل نشده است.</p>
        ) : (
          <pre className="code whitespace-pre-wrap">{subjectLine(rdns)}</pre>
        )}
      </div>

      <div>
        <h3 className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
          معادل فایل <span className="ltr inline-block">config.txt</span> راهنما
        </h3>
        <CodeBlock>{opensslConfig(rdns)}</CodeBlock>
      </div>
    </div>
  );
}
