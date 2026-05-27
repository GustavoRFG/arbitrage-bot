'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import { LiveRefreshIndicator } from '../common/LiveRefreshIndicator';

const TABS = [
  { href: '/', label: 'Overview' },
  { href: '/observatory', label: 'Observatory' },
  { href: '/simulator', label: 'Paper Simulator' },
  { href: '/compare', label: 'Compare Simulator' },
  { href: '/runs', label: 'Runs' },
];

export function TopNav() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-30 border-b border-border-subtle bg-bg-base/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1400px] items-center gap-6 px-6 py-3.5">
        <Link href="/" className="group flex items-center gap-3">
          <Logo />
          <div className="flex flex-col leading-tight">
            <span className="text-[15px] font-semibold tracking-tight text-text-primary">
              Arbitrage-Bot
            </span>
            <span className="text-[10px] uppercase tracking-[0.22em] text-accent-cyan">
              Observatory · Phase 2.5
            </span>
          </div>
        </Link>

        <nav className="ml-4 flex items-center gap-1">
          {TABS.map((tab) => {
            const active =
              tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={clsx(
                  'relative rounded-md px-3 py-1.5 text-sm transition-colors',
                  active
                    ? 'text-text-primary'
                    : 'text-text-secondary hover:text-text-primary',
                )}
              >
                {tab.label}
                {active && (
                  <span className="absolute inset-x-3 -bottom-[14px] h-px bg-gradient-to-r from-transparent via-accent-cyan to-transparent" />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <LiveRefreshIndicator />
        </div>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <div className="relative grid h-9 w-9 place-items-center rounded-md border border-border bg-bg-panel">
      <svg
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="none"
        stroke="url(#brand-grad)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <defs>
          <linearGradient id="brand-grad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#5fd2ff" />
            <stop offset="60%" stopColor="#22d3b9" />
            <stop offset="100%" stopColor="#a78bfa" />
          </linearGradient>
        </defs>
        <path d="M3 17 L8 12 L12 14 L16 8 L21 13" />
        <path d="M3 21 L21 21" opacity="0.5" />
      </svg>
      <div className="pointer-events-none absolute -inset-px rounded-md shadow-glow opacity-50" />
    </div>
  );
}
