import type { Metadata } from 'next';
import './globals.css';
import { TopNav } from '@/components/nav/TopNav';

export const metadata: Metadata = {
  title: 'Arbitrage-Bot Observatory',
  description:
    'Quantitative research console for CEX cross-exchange arbitrage opportunities and prefunded paper-execution simulations.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <div className="min-h-screen">
          <TopNav />
          <main className="mx-auto max-w-[1400px] px-6 pb-24 pt-6">{children}</main>
          <footer className="mx-auto max-w-[1400px] px-6 pb-8 text-[11px] text-text-faint">
            Arbitrage-Bot Observatory · Phase 2.5 · Local read-only console
          </footer>
        </div>
      </body>
    </html>
  );
}
