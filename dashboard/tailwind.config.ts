import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        // Dark institutional palette. Tuned by hand for high tabular contrast.
        bg: {
          base: '#0a0d12',
          surface: '#10141b',
          panel: '#141923',
          elevated: '#1a202c',
        },
        border: {
          subtle: '#1f2937',
          DEFAULT: '#2a3548',
          strong: '#37445e',
        },
        text: {
          primary: '#e6ecf2',
          secondary: '#a3b1c2',
          muted: '#6b7a8f',
          faint: '#475569',
        },
        accent: {
          cyan: '#5fd2ff',
          teal: '#22d3b9',
          mint: '#5af5a8',
          amber: '#f5c87a',
          coral: '#f47272',
          violet: '#a78bfa',
        },
        signal: {
          // Semantic colors for PnL / status / regime
          positive: '#5af5a8',
          negative: '#f47272',
          warning: '#f5c87a',
          info: '#5fd2ff',
          neutral: '#a3b1c2',
        },
      },
      boxShadow: {
        card: '0 1px 0 0 rgba(255,255,255,0.02) inset, 0 0 0 1px rgba(42, 53, 72, 0.5)',
        glow: '0 0 24px -8px rgba(95, 210, 255, 0.45)',
      },
      backgroundImage: {
        'grid-faint':
          'linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)',
        'gradient-panel':
          'linear-gradient(180deg, rgba(255,255,255,0.018) 0%, rgba(255,255,255,0) 100%)',
        'gradient-brand':
          'linear-gradient(135deg, #5fd2ff 0%, #22d3b9 60%, #a78bfa 100%)',
      },
    },
  },
  plugins: [],
};

export default config;
