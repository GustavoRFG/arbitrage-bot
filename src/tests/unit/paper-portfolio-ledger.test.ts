import { describe, expect, it } from 'vitest';

import {
  PortfolioLedger,
  portfolioDrift,
} from '../../services/cex-paper-execution/portfolio-ledger.js';

describe('PortfolioLedger', () => {
  it('seeds balances from the initial portfolio and reports them back', () => {
    const ledger = new PortfolioLedger({
      bitget: { USDT: 5000 },
      mexc: { PYTH: 100 },
    });
    expect(ledger.getBalance('bitget', 'USDT')).toBe(5000);
    expect(ledger.getBalance('mexc', 'PYTH')).toBe(100);
    expect(ledger.getBalance('binance', 'USDT')).toBe(0);
  });

  it('applies deltas additively', () => {
    const ledger = new PortfolioLedger({ binance: { USDT: 1000 } });
    ledger.apply([
      { venue: 'binance', asset: 'USDT', delta: -250 },
      { venue: 'binance', asset: 'BTC', delta: 0.01 },
    ]);
    expect(ledger.getBalance('binance', 'USDT')).toBe(750);
    expect(ledger.getBalance('binance', 'BTC')).toBeCloseTo(0.01, 12);
  });

  it('tryApply rejects atomically when any leg would go negative', () => {
    const ledger = new PortfolioLedger({
      kucoin: { USDT: 100 },
      mexc: { PYTH: 50 },
    });
    const result = ledger.tryApply([
      { venue: 'kucoin', asset: 'USDT', delta: -150 },
      { venue: 'mexc', asset: 'PYTH', delta: -10 },
    ]);
    expect(result.applied).toBe(false);
    expect(result.offendingLeg?.venue).toBe('kucoin');
    expect(ledger.getBalance('kucoin', 'USDT')).toBe(100);
    expect(ledger.getBalance('mexc', 'PYTH')).toBe(50);
  });

  it('tryApply commits when every negative leg has sufficient inventory', () => {
    const ledger = new PortfolioLedger({
      kucoin: { USDT: 1000 },
      mexc: { PYTH: 100 },
    });
    const result = ledger.tryApply([
      { venue: 'kucoin', asset: 'USDT', delta: -250 },
      { venue: 'kucoin', asset: 'PYTH', delta: 50 },
      { venue: 'mexc', asset: 'PYTH', delta: -50 },
      { venue: 'mexc', asset: 'USDT', delta: 252 },
    ]);
    expect(result.applied).toBe(true);
    expect(ledger.getBalance('kucoin', 'USDT')).toBe(750);
    expect(ledger.getBalance('kucoin', 'PYTH')).toBe(50);
    expect(ledger.getBalance('mexc', 'PYTH')).toBe(50);
    expect(ledger.getBalance('mexc', 'USDT')).toBe(252);
  });

  it('canAfford uses a tiny epsilon to forgive rounding errors', () => {
    const ledger = new PortfolioLedger({ mexc: { PYTH: 0.99999999999 } });
    expect(ledger.canAfford('mexc', 'PYTH', 1)).toBe(true);
    expect(ledger.canAfford('mexc', 'PYTH', 1.1)).toBe(false);
  });

  it('portfolioDrift returns per-asset deltas including assets only in one snapshot', () => {
    const drift = portfolioDrift(
      { bitget: { USDT: 5000 }, mexc: { PYTH: 100 } },
      { bitget: { USDT: 4500, PYTH: 25 }, mexc: { PYTH: 75, USDT: 510 } },
    );
    expect(drift.bitget?.USDT).toBe(-500);
    expect(drift.bitget?.PYTH).toBe(25);
    expect(drift.mexc?.PYTH).toBe(-25);
    expect(drift.mexc?.USDT).toBe(510);
  });
});
