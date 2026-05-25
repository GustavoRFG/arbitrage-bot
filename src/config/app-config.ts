import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

const csvList = (defaultValue: string[] = []) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v === undefined || v.trim() === ''
        ? defaultValue
        : v.split(',').map((s) => s.trim()).filter(Boolean),
    );

const csvNumberList = (defaultValue: number[] = []) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v === undefined || v.trim() === ''
        ? defaultValue
        : v
            .split(',')
            .map((s) => Number(s.trim()))
            .filter((n) => Number.isFinite(n) && n > 0),
    );

const boolStr = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? defaultValue : v.toLowerCase() === 'true'));

const numStr = (defaultValue: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? defaultValue : Number(v)))
    .pipe(z.number().finite());

// Curated default universe used when CEX_SYMBOL_MODE=curated and the user has
// not overridden CEX_SYMBOLS. Kept conservative on purpose: large enough to
// surface inefficiencies, small enough that one cycle of REST polls still
// fits comfortably under CEX_SCAN_INTERVAL_MS for a typical 6-9 exchange
// universe. Bump CEX_MAX_SYMBOLS to expand further once latency is measured.
const DEFAULT_CURATED_USDT_UNIVERSE = [
  // Majors / blue chips
  'BTC/USDT', 'ETH/USDT', 'BNB/USDT', 'SOL/USDT', 'XRP/USDT', 'ADA/USDT',
  'DOGE/USDT', 'TRX/USDT', 'AVAX/USDT', 'DOT/USDT', 'LINK/USDT', 'MATIC/USDT',
  'LTC/USDT', 'BCH/USDT', 'ATOM/USDT', 'NEAR/USDT', 'APT/USDT', 'ARB/USDT',
  'OP/USDT', 'SUI/USDT', 'TON/USDT', 'ICP/USDT', 'FIL/USDT', 'XLM/USDT',
  // High-volume mid-caps where cross-venue dislocations are common
  'INJ/USDT', 'TIA/USDT', 'SEI/USDT', 'PYTH/USDT', 'JUP/USDT', 'RNDR/USDT',
  'IMX/USDT', 'AAVE/USDT', 'GRT/USDT', 'UNI/USDT', 'LDO/USDT', 'FET/USDT',
  // Meme / volatile (frequent venue divergence)
  'PEPE/USDT', 'SHIB/USDT', 'WIF/USDT', 'BONK/USDT', 'FLOKI/USDT',
];

const EnvSchema = z.object({
  DB_PATH: z.string().default('data/market_inefficiency_observatory.sqlite'),
  LOG_LEVEL: z.string().default('info'),
  LOG_PRETTY: boolStr(true),

  CEX_ENABLED: boolStr(true),
  // Default universe enables every exchange the project has a fee default for.
  // Disable any of them by setting CEX_EXCHANGES explicitly in .env.
  CEX_EXCHANGES: csvList([
    'binance', 'gateio', 'kucoin', 'mexc', 'bitget', 'htx',
    'coinex', 'bitfinex', 'coinbase',
  ]),
  CEX_SYMBOLS: csvList([
    'BTC/USDT',
    'ETH/USDT',
    'SOL/USDT',
    'XRP/USDT',
    'DOGE/USDT',
    'BNB/USDT',
    'AVAX/USDT',
    'ADA/USDT',
  ]),
  // fixed         — use CEX_SYMBOLS verbatim (legacy behaviour).
  // curated       — start from DEFAULT_CURATED_USDT_UNIVERSE (or CEX_SYMBOLS
  //                 if overridden), then keep only symbols listed by at least
  //                 CEX_MIN_VENUES_PER_SYMBOL of the enabled exchanges,
  //                 capped at CEX_MAX_SYMBOLS.
  // intersection  — discover every spot/USDT symbol via the enabled exchanges'
  //                 loadMarkets() and keep those listed on at least
  //                 CEX_MIN_VENUES_PER_SYMBOL venues, capped at
  //                 CEX_MAX_SYMBOLS (deterministic alphabetical order).
  CEX_SYMBOL_MODE: z.enum(['fixed', 'curated', 'intersection']).default('fixed'),
  CEX_MIN_VENUES_PER_SYMBOL: numStr(2),
  CEX_MAX_SYMBOLS: numStr(40),
  CEX_SCAN_INTERVAL_MS: numStr(1000),
  CEX_MAX_BOOK_STALENESS_MS: numStr(2000),
  CEX_ORDER_BOOK_DEPTH_LEVELS: numStr(20),
  CEX_TARGET_NOTIONALS: csvNumberList([50, 100, 250, 500, 1000]),
  CEX_MIN_GROSS_SPREAD_PCT: numStr(0),
  CEX_MIN_APPROX_NET_SPREAD_PCT: numStr(0),
  CEX_MIN_EXECUTABLE_NET_SPREAD_PCT: numStr(0),
  CEX_MIN_NET_PROFIT_QUOTE: numStr(0),
  CEX_OPPORTUNITY_CLOSE_GRACE_MS: numStr(1500),
  CEX_PERSIST_BOOK_SNAPSHOTS: z
    .enum(['none', 'opportunities_only', 'all'])
    .default('opportunities_only'),
  // Soft warning when the predicted per-cycle work (symbols × exchanges ×
  // expected ms per REST call) exceeds this budget. Does not abort the scan.
  CEX_SLOW_CYCLE_WARN_MS: numStr(15_000),
  CEX_EXPECTED_MS_PER_REQUEST: numStr(120),

  // Per-exchange taker fee overrides (decimal: 0.001 = 0.1%). If unset, the
  // FeeResolver falls back to DEFAULT_FALLBACK_TAKER_FEE (0.002).
  CEX_FEE_BINANCE_TAKER: numStr(0.001),
  CEX_FEE_GATEIO_TAKER: numStr(0.002),
  CEX_FEE_KUCOIN_TAKER: numStr(0.001),
  CEX_FEE_MEXC_TAKER: numStr(0.0008),
  CEX_FEE_COINEX_TAKER: numStr(0.002),
  CEX_FEE_COINBASE_TAKER: numStr(0.006),     // Advanced Trade public tier
  CEX_FEE_BITGET_TAKER: numStr(0.001),
  CEX_FEE_BITFINEX_TAKER: numStr(0.002),
  CEX_FEE_HTX_TAKER: numStr(0.002),
  CEX_FEE_OKX_TAKER: numStr(0.001),
  CEX_FEE_BYBIT_TAKER: numStr(0.001),
  CEX_FEE_KRAKEN_TAKER: numStr(0.0026),
  CEX_FEE_BINGX_TAKER: numStr(0.001),
  CEX_FEE_CRYPTOCOM_TAKER: numStr(0.004),

  // ---- Phase 2 — CEX Prefunded Paper Execution Simulator -----------------
  // These knobs configure the paper-execution simulator (`paper:cex` CLI),
  // which replays Phase 1 lifecycles under prefunded inventory + latency
  // assumptions. They never reach a real exchange — the simulator is a
  // read/replay layer over the Observatory database.
  PAPER_POLICY: z.enum(['once_per_lifecycle', 'cooldown_reentry']).default('once_per_lifecycle'),
  PAPER_SELECTION_MODE: z.enum(['best_profit', 'largest_notional']).default('best_profit'),
  PAPER_MIN_NET_PROFIT_QUOTE: numStr(0.10),
  PAPER_MIN_NET_SPREAD_PCT: numStr(0.03),
  PAPER_MAX_TARGET_NOTIONAL_QUOTE: numStr(1000),
  PAPER_EXECUTION_LATENCY_MS: csvNumberList([0, 1000, 3000, 5000, 10000]),
  PAPER_INITIAL_QUOTE_PER_BUY_VENUE: numStr(5000),
  PAPER_INITIAL_BASE_NOTIONAL_PER_SELL_VENUE: numStr(5000),
  PAPER_REENTRY_COOLDOWN_MS: numStr(60000),

  POLYMARKET_ENABLED: boolStr(false),
  POLYMARKET_ASSETS: csvList(['BTC']),
  POLYMARKET_HORIZONS: csvList(['5m']),
  POLYMARKET_SCAN_ACTIVE_MARKETS: boolStr(true),
  POLYMARKET_SCAN_INTERVAL_MS: numStr(500),
  POLYMARKET_MAX_BOOK_STALENESS_MS: numStr(1500),
  POLYMARKET_TOP_BOOK_DEPTH_LEVELS: numStr(20),
  POLYMARKET_TRACK_BINANCE_FEED: boolStr(true),
  POLYMARKET_TRACK_CHAINLINK_FEED: boolStr(false),
  POLYMARKET_REFERENCE_MOVE_THRESHOLD_PCT: numStr(0.05),
  POLYMARKET_LATE_WINDOW_THRESHOLD_MS: numStr(30000),
  POLYMARKET_DISTANCE_FROM_OPEN_THRESHOLD_PCT: numStr(0.03),
  POLYMARKET_REPRICING_CLOSE_GRACE_MS: numStr(1500),
  POLYMARKET_STORE_RAW_BOOKS: boolStr(false),
  POLYMARKET_STORE_FEATURE_SNAPSHOTS: boolStr(true),

  POLYMARKET_GAMMA_API_URL: z.string().url().default('https://gamma-api.polymarket.com'),
  POLYMARKET_CLOB_API_URL: z.string().url().default('https://clob.polymarket.com'),
  POLYMARKET_CLOB_WS_URL: z
    .string()
    .url()
    .default('wss://ws-subscriptions-clob.polymarket.com/ws/market'),
});

export type AppConfig = z.infer<typeof EnvSchema>;

export { DEFAULT_CURATED_USDT_UNIVERSE };

let cached: AppConfig | undefined;

export function getAppConfig(): AppConfig {
  if (!cached) cached = EnvSchema.parse(process.env);
  return cached;
}

/** Test-only escape hatch — re-reads `process.env`. */
export function _resetAppConfigForTests(): void {
  cached = undefined;
}
