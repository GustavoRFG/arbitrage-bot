import type { PaperPortfolioJson } from './paper-trade-types.js';

export interface BalanceDelta {
  venue: string;
  asset: string;
  delta: number;
}

/**
 * In-memory multi-venue, multi-asset balance ledger.
 *
 * All assets default to 0. The simulator pre-seeds balances with the
 * configured initial portfolio (auto or JSON) and then accumulates deltas as
 * paper trades execute. Negative balances are not permitted: `canAfford`
 * returns false and the simulator records an inventory rejection instead of
 * letting the balance go negative.
 */
export class PortfolioLedger {
  private readonly balances: Map<string, Map<string, number>> = new Map();

  constructor(initial?: PaperPortfolioJson) {
    if (initial) this.applyInitial(initial);
  }

  private applyInitial(initial: PaperPortfolioJson): void {
    for (const [venue, assets] of Object.entries(initial)) {
      for (const [asset, amount] of Object.entries(assets)) {
        if (!Number.isFinite(amount)) continue;
        this.set(venue, asset, amount);
      }
    }
  }

  getBalance(venue: string, asset: string): number {
    return this.balances.get(venue)?.get(asset) ?? 0;
  }

  /**
   * Sufficient inventory means >= the requested amount. A small absolute
   * epsilon (1e-9) forgives floating-point drift accumulated through many
   * multiplicative ledger updates — at the precision of practical trading
   * size this is well below a satoshi/quote-unit boundary.
   */
  canAfford(venue: string, asset: string, amount: number): boolean {
    if (amount <= 0) return true;
    return this.getBalance(venue, asset) + 1e-9 >= amount;
  }

  set(venue: string, asset: string, amount: number): void {
    let venueMap = this.balances.get(venue);
    if (!venueMap) {
      venueMap = new Map();
      this.balances.set(venue, venueMap);
    }
    venueMap.set(asset, amount);
  }

  apply(deltas: BalanceDelta[]): void {
    for (const d of deltas) {
      const current = this.getBalance(d.venue, d.asset);
      this.set(d.venue, d.asset, current + d.delta);
    }
  }

  /** Atomic two-leg apply: if any leg would go negative, nothing changes. */
  tryApply(deltas: BalanceDelta[]): { applied: boolean; offendingLeg?: BalanceDelta } {
    for (const d of deltas) {
      if (d.delta >= 0) continue;
      if (!this.canAfford(d.venue, d.asset, -d.delta)) {
        return { applied: false, offendingLeg: d };
      }
    }
    this.apply(deltas);
    return { applied: true };
  }

  snapshot(): PaperPortfolioJson {
    const out: PaperPortfolioJson = {};
    for (const [venue, assets] of this.balances.entries()) {
      const inner: { [asset: string]: number } = {};
      for (const [asset, amount] of assets.entries()) inner[asset] = amount;
      out[venue] = inner;
    }
    return out;
  }

  venues(): string[] {
    return Array.from(this.balances.keys()).sort();
  }
}

/** Subtract two portfolios per (venue, asset). Missing keys count as 0. */
export function portfolioDrift(
  before: PaperPortfolioJson,
  after: PaperPortfolioJson,
): PaperPortfolioJson {
  const venues = new Set<string>([...Object.keys(before), ...Object.keys(after)]);
  const out: PaperPortfolioJson = {};
  for (const venue of venues) {
    const b = before[venue] ?? {};
    const a = after[venue] ?? {};
    const assets = new Set<string>([...Object.keys(b), ...Object.keys(a)]);
    const inner: { [asset: string]: number } = {};
    for (const asset of assets) {
      inner[asset] = (a[asset] ?? 0) - (b[asset] ?? 0);
    }
    out[venue] = inner;
  }
  return out;
}
