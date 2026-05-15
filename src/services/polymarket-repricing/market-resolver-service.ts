import { PolymarketMarketDiscoveryAdapter } from '../../adapters/polymarket/polymarket-market-discovery-adapter.js';
import { PolymarketMarketRepository } from '../../persistence/repositories/polymarket-repository.js';

import type { PolymarketShortHorizonMarket } from '../../core/types/polymarket.js';

/**
 * Discovers active short-horizon markets and persists their metadata.
 *
 * Phase 1 SKELETON: relies on the adapter's stub. When the adapter is
 * implemented this service is already wired to upsert results into the DB.
 */
export class MarketResolverService {
  constructor(
    private readonly discovery: PolymarketMarketDiscoveryAdapter,
    private readonly repo: PolymarketMarketRepository,
  ) {}

  async resolveAndPersist(
    asset: string,
    horizon: string,
  ): Promise<PolymarketShortHorizonMarket[]> {
    const markets = await this.discovery.discoverActive(asset, horizon);
    for (const m of markets) this.repo.upsert(m);
    return markets;
  }
}
