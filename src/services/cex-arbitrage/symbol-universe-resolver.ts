import { DEFAULT_CURATED_USDT_UNIVERSE } from '../../config/app-config.js';
import { getLogger } from '../../core/logger/logger.js';

import type { CexSymbol } from '../../core/types/market.js';

const log = getLogger('cex.universe');

export type SymbolMode = 'fixed' | 'curated' | 'intersection';

export interface ResolveSymbolsInput {
  mode: SymbolMode;
  configuredSymbols: CexSymbol[];                       // raw CEX_SYMBOLS
  supportedSymbolsByVenue: Map<string, Set<CexSymbol>>; // from adapter.loadMarkets()
  minVenuesPerSymbol: number;
  maxSymbols: number;
}

export interface ResolvedUniverse {
  mode: SymbolMode;
  symbols: CexSymbol[];
  /** symbol -> venues that list it. Useful for the startup banner. */
  venuesBySymbol: Map<CexSymbol, string[]>;
  /** Symbols that were considered but dropped, with reason. */
  rejected: Array<{ symbol: CexSymbol; reason: string }>;
  /** True when the configured cap was hit and extra symbols were trimmed. */
  truncated: boolean;
}

/**
 * Pick the concrete (venue × symbol) universe to scan.
 *
 *  - fixed:        the user's list, verbatim. No venue-coverage check — kept
 *                  for backwards compatibility with the original behaviour.
 *  - curated:      seed with CEX_SYMBOLS if the user overrode the default,
 *                  otherwise the project-wide curated USDT list. Drop symbols
 *                  not listed by at least `minVenuesPerSymbol` enabled venues,
 *                  then cap at `maxSymbols`.
 *  - intersection: discover symbols dynamically from every enabled venue's
 *                  loadMarkets(), keep BASE/USDT symbols listed on at least
 *                  `minVenuesPerSymbol` venues, sort deterministically, cap
 *                  at `maxSymbols`.
 *
 * Mutating CEX_SYMBOLS only affects the `fixed` and `curated` paths.
 */
export function resolveSymbolUniverse(input: ResolveSymbolsInput): ResolvedUniverse {
  const venuesBySymbol = new Map<CexSymbol, string[]>();
  const rejected: Array<{ symbol: CexSymbol; reason: string }> = [];

  const recordVenues = (symbols: Iterable<CexSymbol>): void => {
    for (const symbol of symbols) {
      const venues: string[] = [];
      for (const [venue, listed] of input.supportedSymbolsByVenue) {
        if (listed.has(symbol)) venues.push(venue);
      }
      venuesBySymbol.set(symbol, venues);
    }
  };

  if (input.mode === 'fixed') {
    recordVenues(input.configuredSymbols);
    return {
      mode: 'fixed',
      symbols: dedupe(input.configuredSymbols),
      venuesBySymbol,
      rejected,
      truncated: false,
    };
  }

  if (input.mode === 'curated') {
    const usedDefault = sameMembership(input.configuredSymbols, [
      'BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'DOGE/USDT',
      'BNB/USDT', 'AVAX/USDT', 'ADA/USDT',
    ]);
    const seed = usedDefault ? DEFAULT_CURATED_USDT_UNIVERSE : input.configuredSymbols;
    const deduped = dedupe(seed);
    recordVenues(deduped);
    const kept: CexSymbol[] = [];
    for (const symbol of deduped) {
      const venues = venuesBySymbol.get(symbol) ?? [];
      if (venues.length < input.minVenuesPerSymbol) {
        rejected.push({
          symbol,
          reason: `listed on ${venues.length}/${input.supportedSymbolsByVenue.size} venues; needs ${input.minVenuesPerSymbol}+`,
        });
        continue;
      }
      kept.push(symbol);
    }
    const truncated = kept.length > input.maxSymbols;
    return {
      mode: 'curated',
      symbols: kept.slice(0, input.maxSymbols),
      venuesBySymbol,
      rejected,
      truncated,
    };
  }

  // intersection — pure discovery
  const counts = new Map<CexSymbol, string[]>();
  for (const [venue, listed] of input.supportedSymbolsByVenue) {
    for (const symbol of listed) {
      if (!symbol.endsWith('/USDT')) continue;
      const arr = counts.get(symbol) ?? [];
      arr.push(venue);
      counts.set(symbol, arr);
    }
  }
  const eligible: CexSymbol[] = [];
  for (const [symbol, venues] of counts) {
    venuesBySymbol.set(symbol, venues);
    if (venues.length >= input.minVenuesPerSymbol) {
      eligible.push(symbol);
    } else {
      rejected.push({
        symbol,
        reason: `listed on ${venues.length} venues; needs ${input.minVenuesPerSymbol}+`,
      });
    }
  }
  // Deterministic: most-listed first (ties broken alphabetically) so the
  // cap retains the widest-coverage symbols first.
  eligible.sort((a, b) => {
    const va = venuesBySymbol.get(a)?.length ?? 0;
    const vb = venuesBySymbol.get(b)?.length ?? 0;
    if (va !== vb) return vb - va;
    return a.localeCompare(b);
  });
  const truncated = eligible.length > input.maxSymbols;
  if (truncated) {
    log.warn(
      { eligible: eligible.length, cap: input.maxSymbols },
      'intersection discovery hit CEX_MAX_SYMBOLS — extra symbols dropped',
    );
  }
  return {
    mode: 'intersection',
    symbols: eligible.slice(0, input.maxSymbols),
    venuesBySymbol,
    rejected,
    truncated,
  };
}

function dedupe<T>(values: Iterable<T>): T[] {
  return Array.from(new Set(values));
}

function sameMembership(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  for (const x of b) if (!setA.has(x)) return false;
  return true;
}
