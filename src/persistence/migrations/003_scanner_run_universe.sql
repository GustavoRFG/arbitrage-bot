-- Capture the resolved exchange/symbol universe + the material-candidate rule
-- that was active during each scanner run, so reports can recover the
-- analytical context without re-reading the live config.
--
-- universe_json shape (see ScannerRunUniverse in scanner-run.ts):
--   {
--     "symbolMode": "fixed" | "curated" | "intersection",
--     "enabledExchanges": [string],
--     "resolvedSymbols": [string],
--     "minVenuesPerSymbol": number,
--     "maxSymbols": number,
--     "truncated": boolean,
--     "materialRule": {
--       "minNetProfitQuote": number,
--       "minExecutableNetSpreadPct": number,
--       "description": string
--     }
--   }

ALTER TABLE scanner_runs ADD COLUMN universe_json TEXT;
