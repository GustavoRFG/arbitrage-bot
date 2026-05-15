import type { SourceTimestamps } from './timestamps.js';

export interface OrderBookLevel {
  price: number;
  amountBaseOrShares: number;
  notionalQuote: number;
}

/**
 * A single normalised order-book snapshot. Bids are sorted DESC by price,
 * asks ASC. `amountBaseOrShares` is the quantity at that level in the base
 * asset (CEX) or in shares (Polymarket).
 */
export interface NormalizedOrderBook {
  venue: string;
  symbolOrMarketId: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  timestamps: SourceTimestamps;
  tickSize?: number;
  minOrderSize?: number;
  bookHash?: string;
  isStale?: boolean;
}

/** Best (top-of-book) ask price, or undefined if the side is empty. */
export function topAsk(book: NormalizedOrderBook): number | undefined {
  return book.asks[0]?.price;
}

/** Best (top-of-book) bid price, or undefined if the side is empty. */
export function topBid(book: NormalizedOrderBook): number | undefined {
  return book.bids[0]?.price;
}
