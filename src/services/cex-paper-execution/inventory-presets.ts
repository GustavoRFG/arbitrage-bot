/**
 * Phase 2.1 — inventory scenario presets.
 *
 * Auto-prefund builders for the paper simulator that let a single CLI/script
 * compare conservative, moderate, aggressive, and custom funding models on
 * the same lifecycle set without writing a portfolio JSON by hand.
 *
 * The custom preset accepts a raw `PaperPortfolioJson` — useful when callers
 * want to pin a specific venue/asset balance for a contention test.
 *
 * No agent or network call is involved; these functions only inspect the
 * already-loaded lifecycle list and emit a `PaperPortfolioJson`.
 */

import {
  buildAutoPrefundedPortfolio,
  type AutoPrefundInput,
} from './paper-simulator.js';

import type {
  LifecycleWithEstimates,
  PaperPortfolioJson,
} from './paper-trade-types.js';

export type InventoryPresetName =
  | 'conservative'
  | 'moderate'
  | 'aggressive'
  | 'custom';

export interface InventoryPresetSpec {
  name: InventoryPresetName;
  /** Human-readable label shown in comparison reports. */
  label: string;
  /** Quote notional seeded per buy-venue (e.g. USDT on the buy side). */
  quotePerBuyVenue: number;
  /** Base notional (in quote units) seeded per sell-venue, converted at the first observed avg_buy_price for that symbol. */
  baseNotionalPerSellVenue: number;
}

export interface CustomPresetSpec {
  name: 'custom';
  label: string;
  portfolio: PaperPortfolioJson;
}

export type PresetSpec = InventoryPresetSpec | CustomPresetSpec;

const VALID_PRESETS: ReadonlySet<InventoryPresetName> = new Set([
  'conservative',
  'moderate',
  'aggressive',
  'custom',
]);

/**
 * Canonical preset levels. Numbers are denominated in the symbol's quote
 * currency (USDT for the curated PYTH/MEXC universe). Conservative is sized
 * so that a single mid-cap top-of-book trade rarely exhausts inventory;
 * aggressive is sized so that 10–20 concurrent contentions on the same
 * sell-venue base asset will start triggering insufficient_base_inventory
 * rejections, which is exactly the realism this milestone is meant to
 * surface.
 */
export const PRESETS: Readonly<Record<Exclude<InventoryPresetName, 'custom'>, InventoryPresetSpec>> = {
  conservative: {
    name: 'conservative',
    label: 'conservative (1k quote / 1k base notional)',
    quotePerBuyVenue: 1_000,
    baseNotionalPerSellVenue: 1_000,
  },
  moderate: {
    name: 'moderate',
    label: 'moderate (5k quote / 5k base notional)',
    quotePerBuyVenue: 5_000,
    baseNotionalPerSellVenue: 5_000,
  },
  aggressive: {
    name: 'aggressive',
    label: 'aggressive (50k quote / 50k base notional)',
    quotePerBuyVenue: 50_000,
    baseNotionalPerSellVenue: 50_000,
  },
};

export function parsePresetName(raw: string | undefined): InventoryPresetName {
  if (!raw) return 'moderate';
  const normalised = raw.trim().toLowerCase();
  if (!VALID_PRESETS.has(normalised as InventoryPresetName)) {
    throw new Error(
      `Unknown --preset ${raw} (supported: conservative, moderate, aggressive, custom)`,
    );
  }
  return normalised as InventoryPresetName;
}

export function buildPresetPortfolio(
  spec: PresetSpec,
  lifecycles: LifecycleWithEstimates[],
): PaperPortfolioJson {
  if (spec.name === 'custom') {
    // Narrow to CustomPresetSpec; the union discriminant covers both shapes.
    const custom = spec as CustomPresetSpec;
    return clonePortfolio(custom.portfolio);
  }
  const auto = spec as InventoryPresetSpec;
  const input: AutoPrefundInput = {
    lifecycles,
    quotePerBuyVenue: auto.quotePerBuyVenue,
    baseNotionalPerSellVenue: auto.baseNotionalPerSellVenue,
  };
  return buildAutoPrefundedPortfolio(input);
}

export function presetByName(name: Exclude<InventoryPresetName, 'custom'>): InventoryPresetSpec {
  return PRESETS[name];
}

/** Deep-clone a portfolio so the simulator cannot mutate the caller's data. */
export function clonePortfolio(p: PaperPortfolioJson): PaperPortfolioJson {
  const out: PaperPortfolioJson = {};
  for (const [venue, assets] of Object.entries(p)) {
    const inner: Record<string, number> = {};
    for (const [asset, amount] of Object.entries(assets)) inner[asset] = amount;
    out[venue] = inner;
  }
  return out;
}
