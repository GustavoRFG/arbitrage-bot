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

const EnvSchema = z.object({
  DB_PATH: z.string().default('data/market_inefficiency_observatory.sqlite'),
  LOG_LEVEL: z.string().default('info'),
  LOG_PRETTY: boolStr(true),

  CEX_ENABLED: boolStr(true),
  CEX_EXCHANGES: csvList(['binance', 'gateio', 'kucoin']),
  CEX_SYMBOLS: csvList([
    'BTC/USDT',
    'ETH/USDT',
    'SOL/USDT',
    'XRP/USDT',
    'DOGE/USDT',
  ]),
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

  CEX_FEE_BINANCE_TAKER: numStr(0.001),
  CEX_FEE_GATEIO_TAKER: numStr(0.002),
  CEX_FEE_KUCOIN_TAKER: numStr(0.001),
  CEX_FEE_MEXC_TAKER: numStr(0.0008),

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

let cached: AppConfig | undefined;

export function getAppConfig(): AppConfig {
  if (!cached) cached = EnvSchema.parse(process.env);
  return cached;
}

/** Test-only escape hatch — re-reads `process.env`. */
export function _resetAppConfigForTests(): void {
  cached = undefined;
}
