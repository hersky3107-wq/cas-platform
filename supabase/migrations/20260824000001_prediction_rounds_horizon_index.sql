-- ============================================================================
-- AI Prediction League — HORIZON VOCABULARY UNIFICATION + selection support.
--
-- REPORT: `prediction_rounds.horizon` already exists as a NOT NULL free-text
-- column (see 20260813000001_prediction_ledger.sql: "kept as free text so new
-- horizons need no migration"). The app now uses ONE horizon vocabulary end to
-- end — the 4 codes '1d' / '1w' / '1m' / '3m' (see `lib/league/horizon.ts`).
-- These are BOTH the UI option AND the stored value; there is no UI↔DB
-- translation table anymore (the old `HORIZON_ROUND_VALUE` map was deleted).
--
-- Provenance of the legacy value: every live round historically stored '24h'
-- (the pre-unification daily token), written by `lib/league/instruments.ts`
-- (cron path) and `lib/league/catalog.ts` (public path). A live
-- `SELECT horizon, count(*) FROM prediction_rounds GROUP BY horizon` on
-- 2026-08-24 returned exactly one row: `24h → 1`. No '7d'/'1m'/'3m' rows
-- existed. That one row was backfilled to '1d'.
--
-- ORDER IS LOAD-BEARING. Step 1 (backfill) MUST run before step 2 (CHECK):
-- an unmigrated '24h' row would make the CHECK fail on apply. Both are in this
-- one file so a fresh apply on any environment is self-safe and idempotent —
-- the UPDATEs are no-ops on a DB that was already backfilled out-of-band.
--
-- Verify AFTER applying with pg catalogs / information_schema — NOT PostgREST
-- (its schema cache lags a freshly-applied DDL change):
--
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid = 'public.prediction_rounds'::regclass
--      and conname = 'prediction_rounds_horizon_chk';
--
--   select indexname, indexdef
--     from pg_indexes
--    where tablename = 'prediction_rounds'
--      and indexname = 'prediction_rounds_instrument_horizon_idx';
--
--   select horizon, count(*) from public.prediction_rounds group by horizon;
-- ============================================================================

-- 1. Backfill the retired tokens to the canonical set FIRST (order-critical).
update public.prediction_rounds set horizon = '1d' where horizon = '24h';
update public.prediction_rounds set horizon = '1w' where horizon = '7d';

-- 2. Pin `horizon` to the 4 canonical codes, so a future bug cannot silently
--    write an unrecognized token that `latestRankedRoundId` would never find.
alter table public.prediction_rounds
  add constraint prediction_rounds_horizon_chk
  check (horizon in ('1d', '1w', '1m', '3m'));

-- 3. Support the "current round for this (instrument, horizon)" lookup
--    (`lib/league/public-access.ts` -> `latestRankedRoundId`), which filters
--    on (instrument, horizon, item_type) newest-first. Without a horizon in
--    the key, two horizons for the same instrument would let the more recently
--    created one shadow the other regardless of which the caller asked for.
create index if not exists prediction_rounds_instrument_horizon_idx
  on public.prediction_rounds (instrument, horizon, item_type, created_at desc);

comment on constraint prediction_rounds_horizon_chk on public.prediction_rounds is
  'Pins horizon to the 4 canonical codes the app uses end to end (lib/league/horizon.ts: 1d | 1w | 1m | 3m). No UI/DB translation — the selected code IS the stored value. Legacy 24h/7d rows were backfilled to 1d/1w before this constraint was added.';
