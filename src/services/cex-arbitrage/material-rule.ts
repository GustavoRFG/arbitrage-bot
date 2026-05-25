/**
 * The "material candidate" predicate — kept in one place so the scanner
 * orchestrator, the startup banner, and the report layer all describe the
 * same rule.
 *
 * A candidate is **material** when *any* of its depth estimates satisfies
 * ALL of:
 *   1. `supportedByDepth` — both legs filled fully at the target notional
 *      (i.e. the order book had enough volume on both sides).
 *   2. `netProfitQuote >= CEX_MIN_NET_PROFIT_QUOTE`.
 *   3. `netSpreadPct  >= CEX_MIN_EXECUTABLE_NET_SPREAD_PCT`.
 *
 * The flag is written by `ArbitrageDetector.detect()` onto each candidate's
 * `isMaterial` property; the scan orchestrator counts those flags into
 * `scanner_runs.total_material_candidates`. Candidates that pass the gross
 * and approx-net pre-filters but fail one of the three rules above are
 * persisted (for audit) but **not** counted as material.
 *
 * If you change the predicate, also update:
 *   - ArbitrageDetector#detect (the actual evaluation)
 *   - CexReportService startup log + report header
 *   - README "How metrics are computed"
 */
export interface MaterialRule {
  minNetProfitQuote: number;
  minExecutableNetSpreadPct: number;
  /** Free-text human-readable summary, suitable for logs and reports. */
  description: string;
}

export function buildMaterialRule(args: {
  minNetProfitQuote: number;
  minExecutableNetSpreadPct: number;
}): MaterialRule {
  const description =
    `at least one depth estimate must (a) fill both legs at the target notional, ` +
    `(b) clear netProfitQuote >= ${args.minNetProfitQuote}, and ` +
    `(c) clear netSpreadPct >= ${args.minExecutableNetSpreadPct}%`;
  return {
    minNetProfitQuote: args.minNetProfitQuote,
    minExecutableNetSpreadPct: args.minExecutableNetSpreadPct,
    description,
  };
}
