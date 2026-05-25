import clsx from 'clsx';

export function EmptyState({
  title,
  description,
  hint,
  tone = 'neutral',
  className,
}: {
  title: string;
  description?: string;
  hint?: string;
  tone?: 'neutral' | 'warning';
  className?: string;
}) {
  return (
    <div
      className={clsx(
        'panel flex flex-col gap-2 px-6 py-10 text-center',
        tone === 'warning' ? 'border-accent-amber/40' : '',
        className,
      )}
    >
      <h3 className="text-base font-semibold text-text-primary">{title}</h3>
      {description && (
        <p className="mx-auto max-w-xl text-sm leading-relaxed text-text-secondary">
          {description}
        </p>
      )}
      {hint && (
        <pre className="mx-auto mt-2 max-w-xl overflow-auto rounded-md border border-border-subtle bg-bg-base px-3 py-2 text-left text-[12px] text-accent-cyan">
          {hint}
        </pre>
      )}
    </div>
  );
}
