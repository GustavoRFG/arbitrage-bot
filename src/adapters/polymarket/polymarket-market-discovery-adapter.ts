import { getAppConfig } from '../../config/app-config.js';
import { getLogger } from '../../core/logger/logger.js';

import type { PolymarketShortHorizonMarket } from '../../core/types/polymarket.js';

const log = getLogger('poly.discovery');

/**
 * Discover Polymarket short-horizon crypto markets (e.g. BTC Up/Down 5m).
 *
 * Phase 1 SKELETON: this adapter outlines the contract and the public-API
 * shape against the Gamma API. The live integration will populate fields from
 * the JSON returned by `/markets` once we lock the exact filter to identify
 * short-horizon crypto contracts (slug pattern, tags, or dedicated endpoint).
 *
 * Reference: https://docs.polymarket.com/developers/gamma-markets-api
 *
 * Until the field mapping is validated against live data this method returns
 * an empty list — the rest of the pipeline runs cleanly without it, and the
 * Polymarket track is gated by `POLYMARKET_ENABLED` (default: false).
 */
export class PolymarketMarketDiscoveryAdapter {
  private readonly gammaUrl: string;

  constructor(gammaUrl?: string) {
    this.gammaUrl = gammaUrl ?? getAppConfig().POLYMARKET_GAMMA_API_URL;
  }

  async discoverActive(asset: string, horizon: string): Promise<PolymarketShortHorizonMarket[]> {
    log.warn(
      { gammaUrl: this.gammaUrl, asset, horizon },
      'PolymarketMarketDiscoveryAdapter.discoverActive() is a P3 skeleton — returning []',
    );
    // TODO(phase-1.B): query gamma `${gammaUrl}/markets?active=true&...` and
    // filter by asset/horizon (slug or tag), then map into
    // PolymarketShortHorizonMarket. See README "Polymarket — limitations".
    return [];
  }
}
