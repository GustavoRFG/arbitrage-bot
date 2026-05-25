import type { ReactNode } from 'react';

export function SectionHeader({
  eyebrow,
  title,
  description,
  right,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        {eyebrow && <div className="heading-eyebrow mb-1">{eyebrow}</div>}
        <h2 className="heading-h2">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-text-secondary">{description}</p>}
      </div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  );
}
