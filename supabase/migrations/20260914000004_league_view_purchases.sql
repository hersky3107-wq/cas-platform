-- League paid-view receipts for surfaces that are NOT a single round.
--
-- Why a new table: league_generation_jobs is the permanent-access receipt
-- for a ROUND (unique on round_id + user_id while charged and not refunded).
-- The leaderboard and the record room have no round_id — stuffing a sentinel
-- into the jobs table would be read by the generation sweeper and the paid-
-- access unique index. Same money columns as league_generation_jobs /
-- league_deep_runs so charge / refund-once stay one pattern.
--
-- Products:
--   leaderboard  — one live row per user (partial unique). Access is
--                  permanent and live: later grades update the board.
--   record_room  — one row per purchase. Each row freezes a 30-round
--                  window at as_of. Re-purchase slides the window;
--                  reopening the latest window does not charge again.
--
-- Service-role only. RLS on, no policies.

create table if not exists public.league_view_purchases (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  product         text not null,
  charged         boolean not null default false,
  charged_cost    integer not null default 0,
  deduct_skipped  boolean not null default false,
  refunded        boolean not null default false,
  -- Record-room window. Null on leaderboard rows.
  as_of           timestamptz,
  round_limit     integer,
  created_at      timestamptz not null default now(),

  constraint league_view_purchases_product_chk
    check (product in ('leaderboard', 'record_room')),
  constraint league_view_purchases_round_limit_chk
    check (round_limit is null or round_limit > 0)
);

alter table public.league_view_purchases enable row level security;

-- One live receipt per (user, product). A record-room refresh updates
-- as_of in place rather than inserting a second live row (two racing
-- first purchases cannot both keep the money).
create unique index if not exists league_view_purchases_live_uniq
  on public.league_view_purchases (user_id, product)
  where charged and not refunded;

create index if not exists league_view_purchases_user_product_live_idx
  on public.league_view_purchases (user_id, product, created_at desc)
  where charged and not refunded;
