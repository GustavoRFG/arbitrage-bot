import type { Database as BetterDb } from 'better-sqlite3';

import type { NormalizedOrderBook } from '../../core/types/order-book.js';

export interface OrderBookSnapshotInsert {
  runId: string;
  exchange: string;
  symbol: string;
  book: NormalizedOrderBook;
  storeDepthJson: boolean;
}

export class OrderBookRepository {
  constructor(private readonly db: BetterDb) {}

  insert(args: OrderBookSnapshotInsert): number {
    const { runId, exchange, symbol, book, storeDepthJson } = args;
    const depthJson = storeDepthJson
      ? JSON.stringify({ bids: book.bids, asks: book.asks })
      : null;
    const result = this.db
      .prepare(
        `INSERT INTO cex_order_book_snapshots
         (run_id, exchange, symbol, source_timestamp, received_at, processed_at,
          top_bid, top_ask, depth_levels, depth_json, raw_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        runId,
        exchange,
        symbol,
        book.timestamps.sourceTimestampMs ?? null,
        book.timestamps.receivedAtMs,
        book.timestamps.processedAtMs ?? null,
        book.bids[0]?.price ?? null,
        book.asks[0]?.price ?? null,
        Math.max(book.bids.length, book.asks.length),
        depthJson,
      );
    return Number(result.lastInsertRowid);
  }
}
