-- ============================================================================
-- league_kr_universe.exchange — US listing venue for STOCK:{exchange}:{code}.
--
-- Run in the Supabase SQL Editor. Do NOT `supabase db push`.
-- Backfills the 35 SEIBro US chips verified via Twelve Data (2026-10-02).
-- ============================================================================

alter table public.league_kr_universe
  add column if not exists exchange text null;

comment on column public.league_kr_universe.exchange is
  'US listing exchange (NASDAQ / NYSE / …). Null for KOSPI/KOSDAQ.';

update public.league_kr_universe
set exchange = 'NASDAQ', updated_at = now()
where market = 'US'
  and code in (
    'TSLA', 'NVDA', 'GOOGL', 'AAPL', 'MU', 'PLTR', 'MSFT', 'AVGO', 'SNDK', 'SPCX',
    'AMZN', 'AMD', 'INTC', 'META', 'MRVL', 'IREN', 'MSTR', 'RKLB', 'ASML', 'AMAT',
    'LRCX', 'LITE', 'PANW', 'MRNA'
  );

update public.league_kr_universe
set exchange = 'NYSE', updated_at = now()
where market = 'US'
  and code in (
    'IONQ', 'TSM', 'BMNR', 'CRCL', 'BE', 'BRK.B', 'O', 'ORCL', 'SMR', 'DELL', 'COHR'
  );
