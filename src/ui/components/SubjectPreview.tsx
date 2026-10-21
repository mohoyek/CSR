import { opensslConfig, subjectLine, type RdnValue } from '../../core/dn';
import { CodeBlock } from './ui';

/**
 * پیش‌نمایش زندهٔ موضوع گواهی (Subject) و معادل فایل config.txt راهنما،
 * تا کاربر بتواند خروجی را با نمونهٔ راهنما مقایسه کند.
 */
export function SubjectPreview({ rdns }: { rdns: RdnValue[] }) {
  const line = subjectLine(rdns);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
          موضوع گواهی (Subject)
        </h3>
        {rdns.length === 0 ? (
          <p className="hint">هنوز فیلدی تکمیل نشده است.</p>
        ) : (
          <pre className="code whitespace-pre-wrap">{line}</pre>
        )}
      </div>

      <div>
        <h3 className="mb-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
          معادل فایل <span className="ltr inline-block">config.txt</span> راهنما
        </h3>
        <CodeBlock>{opensslConfig(rdns)}</CodeBlock>
      </div>

      {rdns.length > 0 ? (
        <details className="text-xs">
          <summary className="cursor-pointer font-medium text-slate-600 dark:text-slate-300">
            ترتیب و نوع رشتهٔ هر ویژگی (RDN)
          </summary>
          <div className="code mt-2">
            {rdns
              .map(
                (r, i) =>
                  `${String(i + 1).padStart(2, ' ')}. ${r.shortName.padEnd(22)} ${r.asn1Type.padEnd(
                    15
                  )} ${r.value}`
              )
              .join('\n')}
          </div>
        </details>
      ) : null}
    </div>
  );
}
