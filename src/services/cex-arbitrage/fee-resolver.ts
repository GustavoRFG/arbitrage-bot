import { getAppConfig } from '../../config/app-config.js';
import { DEFAULT_FALLBACK_TAKER_FEE, type CexFeeModel } from '../../core/types/fees.js';

/**
 * Phase 1 fee model: read taker fees from configuration. The structure is
 * ready to be replaced by a fee API in later phases (the `source` field
 * already encodes provenance for audit).
 */
export class FeeResolver {
  private readonly map: Map<string, CexFeeModel> = new Map();

  constructor() {
    const cfg = getAppConfig();
    const now = Date.now();
    const set = (id: string, takerFeeRate: number) => {
      this.map.set(id, {
        exchange: id,
        marketType: 'spot',
        makerFeeRate: takerFeeRate,    // not used in Phase 1
        takerFeeRate,
        source: 'config',
        updatedAtMs: now,
      });
    };
    set('binance', cfg.CEX_FEE_BINANCE_TAKER);
    set('gateio', cfg.CEX_FEE_GATEIO_TAKER);
    set('kucoin', cfg.CEX_FEE_KUCOIN_TAKER);
    set('mexc', cfg.CEX_FEE_MEXC_TAKER);
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
