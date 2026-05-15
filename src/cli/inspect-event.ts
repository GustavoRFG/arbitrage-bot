#!/usr/bin/env node
import { getDb } from '../persistence/db.js';

function findIdArg(): string | undefined {
  const a = process.argv.find((x) => x.startsWith('--id='));
  return a ? a.slice('--id='.length) : undefined;
}

async function main(): Promise<void> {
  const id = findIdArg();
  if (!id) {
    // eslint-disable-next-line no-console
    console.error('usage: inspect:event -- --id=<lifecycle_id|candidate_id>');
    process.exit(2);
  }

  const db = getDb();
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) {
    // eslint-disable-next-line no-console
    console.error('id must be numeric');
    process.exit(2);
  }

  // Try the four event tables in order, print whichever matches.
  const tables: { table: string; idCol: string }[] = [
    { table: 'cex_arbitrage_lifecycles', idCol: 'id' },
    { table: 'cex_arbitrage_candidates', idCol: 'id' },
    { table: 'repricing_lag_lifecycles', idCol: 'id' },
    { table: 'repricing_lag_candidates', idCol: 'id' },
  ];

  for (const t of tables) {
    const row = db.prepare(`SELECT * FROM ${t.table} WHERE ${t.idCol} = ?`).get(numericId);
    if (row) {
      // eslint-disable-next-line no-console
      console.log(`[${t.table}]`);
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(row, null, 2));
      return;
    }
  }

  // eslint-disable-next-line no-console
  console.error(`No event found with id=${id}`);
  process.exit(1);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
