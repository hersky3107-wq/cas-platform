-- ============================================================================
-- AI Prediction League — same-day KRX portal provisional closes.
--
-- After the 15:30 KST close the OPEN API daily file is not published until
-- ~08:00 KST next morning. Generation must still be possible, so we store
-- 전종목 시세 from data.krx.co.kr as provisional closes and record that on
-- the round. Official OPEN API rows overwrite provisional (same PK).
-- Grading always uses official (provisional = false) closes.
--
-- Run in the Supabase SQL Editor. Do NOT `supabase db push`.
-- ============================================================================

alter table public.league_krx_daily
  add column if not exists source text not null default 'krx_open_api';

alter table public.league_krx_daily
  add column if not exists provisional boolean not null default false;

comment on column public.league_krx_daily.source is
  'krx_open_api (official daily file) or krx_data_portal (same-day 전종목 시세).';

comment on column public.league_krx_daily.provisional is
  'true only for portal same-day closes used as a generate-time anchor until the official file lands.';

create index if not exists league_krx_daily_bas_dd_provisional_idx
  on public.league_krx_daily (bas_dd, provisional);

alter table public.prediction_rounds
  add column if not exists anchor_provisional boolean;

alter table public.prediction_rounds
  add column if not exists anchor_correction_note text;

comment on column public.prediction_rounds.anchor_provisional is
  'KRSTOCK: true when generate used a portal same-day close (source = krx_data_portal). Cleared when the official file is applied.';

comment on column public.prediction_rounds.anchor_correction_note is
  'KRSTOCK: admin-visible note when a portal provisional anchor was rewritten to the official close.';
