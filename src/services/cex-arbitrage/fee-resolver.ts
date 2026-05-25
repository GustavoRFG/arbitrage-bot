import { getAppConfig, type AppConfig } from '../../config/app-config.js';
import { DEFAULT_FALLBACK_TAKER_FEE, type CexFeeModel } from '../../core/types/fees.js';

/**
 * Phase 1 fee model: read taker fees from configuration. The structure is
 * ready to be replaced by a fee API in later phases (the `source` field
 * already encodes provenance for audit).
 *
 * To add a new venue: declare `CEX_FEE_<ID>_TAKER` in app-config.ts and the
 * value is picked up automatically. Unknown venues silently fall back to
 * DEFAULT_FALLBACK_TAKER_FEE, which is intentionally conservative.
 */
export class FeeResolver {
  private readonly map: Map<string, CexFeeModel> = new Map();

  constructor() {
    const cfg = getAppConfig();
    const now = Date.now();
    const set = (id: string, takerFeeRate: number | undefined) => {
      if (takerFeeRate === undefined || !Number.isFinite(takerFeeRate)) return;
      this.map.set(id, {
        exchange: id,
        marketType: 'spot',
        makerFeeRate: takerFeeRate,    // not used in Phase 1
        takerFeeRate,
        source: 'config',
        updatedAtMs: now,
      });
    };
    // Statically declared rates — keyed by the lowercase CCXT id.
    set('binance', pickFee(cfg, 'BINANCE'));
    set('gateio', pickFee(cfg, 'GATEIO'));
    set('kucoin', pickFee(cfg, 'KUCOIN'));
    set('mexc', pickFee(cfg, 'MEXC'));
    set('coinex', pickFee(cfg, 'COINEX'));
    set('coinbase', pickFee(cfg, 'COINBASE'));
    set('bitget', pickFee(cfg, 'BITGET'));
    set('bitfinex', pickFee(cfg, 'BITFINEX'));
    set('htx', pickFee(cfg, 'HTX'));
    set('okx', pickFee(cfg, 'OKX'));
    set('bybit', pickFee(cfg, 'BYBIT'));
    set('kraken', pickFee(cfg, 'KRAKEN'));
    set('bingx', pickFee(cfg, 'BINGX'));
    set('cryptocom', pickFee(cfg, 'CRYPTOCOM'));
  }

  takerFeeRate(exchangeId: string): number {
    return this.map.get(exchangeId)?.takerFeeRate ?? DEFAULT_FALLBACK_TAKER_FEE;
  }

  feeModel(exchangeId: string): CexFeeModel {
    return (
      this.map.get(exchangeId) ?? {
        exchange: exchangeId,
        marketType: 'spot',
        makerFeeRate: DEFAULT_FALLBACK_TAKER_FEE,
        takerFeeRate: DEFAULT_FALLBACK_TAKER_FEE,
        source: 'config',
        updatedAtMs: Date.now(),
      }
    );
  }
}

function pickFee(cfg: AppConfig, exchangeKey: string): number | undefined {
  const k = `CEX_FEE_${exchangeKey}_TAKER` as keyof AppConfig;
  const v = cfg[k];
  return typeof v === 'number' ? v : undefined;
}
