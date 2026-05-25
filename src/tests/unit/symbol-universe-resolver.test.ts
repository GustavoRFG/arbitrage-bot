import { describe, expect, it } from 'vitest';

import { resolveSymbolUniverse } from '../../services/cex-arbitrage/symbol-universe-resolver.js';

function venues(map: Record<string, string[]>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [venue, symbols] of Object.entries(map)) {
    out.set(venue, new Set(symbols));
  }
  return out;
}

describe('resolveSymbolUniverse', () => {
  it('fixed mode keeps the configured list verbatim and dedupes', () => {
    const r = resolveSymbolUniverse({
      mode: 'fixed',
      configuredSymbols: ['BTC/USDT', 'ETH/USDT', 'BTC/USDT'],
      supportedSymbolsByVenue: venues({ binance: ['BTC/USDT'] }),
      minVenuesPerSymbol: 5,    // ignored
      maxSymbols: 1,            // ignored
    });
    expect(r.symbols).toEqual(['BTC/USDT', 'ETH/USDT']);
    expect(r.truncated).toBe(false);
  });

  it('curated mode drops symbols below the min-venues floor', () => {
    const r = resolveSymbolUniverse({
      mode: 'curated',
      configuredSymbols: ['ABC/USDT', 'XYZ/USDT', 'DEF/USDT'],   // user-overridden
      supportedSymbolsByVenue: venues({
        binance: ['ABC/USDT', 'XYZ/USDT'],
        gateio: ['ABC/USDT'],
        kucoin: ['ABC/USDT', 'XYZ/USDT', 'DEF/USDT'],
      }),
      minVenuesPerSymbol: 2,
      maxSymbols: 10,
    });
    // DEF only on kucoin (1 venue) -> dropped
    expect(r.symbols.sort()).toEqual(['ABC/USDT', 'XYZ/USDT']);
    expect(r.rejected.find((x) => x.symbol === 'DEF/USDT')).toBeDefined();
  });

  it('curated mode caps at maxSymbols and reports truncated=true', () => {
    const seed = Array.from({ length: 5 }, (_, i) => `S${i}/USDT`);
    const r = resolveSymbolUniverse({
      mode: 'curated',
      configuredSymbols: seed,
      supportedSymbolsByVenue: venues({
        binance: seed,
        gateio: seed,
      }),
      minVenuesPerSymbol: 2,
      maxSymbols: 3,
    });
    expect(r.symbols.length).toBe(3);
    expect(r.truncated).toBe(true);
  });

  it('intersection mode discovers USDT pairs by venue coverage', () => {
    const r = resolveSymbolUniverse({
      mode: 'intersection',
      configuredSymbols: [],     // ignored
      supportedSymbolsByVenue: venues({
        binance: ['BTC/USDT', 'ETH/USDT', 'WEIRD/BUSD'],
        gateio: ['BTC/USDT', 'ETH/USDT', 'SOLO/USDT'],
        kucoin: ['BTC/USDT', 'SOLO/USDT'],
      }),
      minVenuesPerSymbol: 2,
      maxSymbols: 10,
    });
    // BTC: 3 venues, ETH: 2, SOLO: 2, WEIRD: 0 USDT match
    expect(r.symbols).toEqual(['BTC/USDT', 'ETH/USDT', 'SOLO/USDT']);
  });

  it('intersection mode truncates when over the cap and prefers widest coverage', () => {
    const r = resolveSymbolUniverse({
      mode: 'intersection',
      configuredSymbols: [],
      supportedSymbolsByVenue: venues({
        a: ['BTC/USDT', 'ETH/USDT', 'X/USDT'],
        b: ['BTC/USDT', 'ETH/USDT'],
        c: ['BTC/USDT'],
      }),
      minVenuesPerSymbol: 2,
      maxSymbols: 1,
    });
    expect(r.symbols).toEqual(['BTC/USDT']);   // most-listed wins the cap
    expect(r.truncated).toBe(true);
  });
});
