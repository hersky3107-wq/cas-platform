-- League paid-view hardening: at most ONE live (charged, never refunded)
-- purchase row per (round, user) on league_generation_jobs.
--
-- Why: a purchase row IS the permanent view access (deep-runs model). The
-- inline generate route checks "already paid?" before charging, but two
-- presses racing across serverless isolates could both pass that read and
-- both charge. This partial unique index makes the second row insert fail,
-- and the route refunds that deduction — exactly-once purchase, enforced by
-- the database, not by request ordering.
--
-- Partial on (charged AND NOT refunded) on purpose:
--   * uncharged rows (admin deduct_skipped, system/cron jobs) are unlimited;
--   * a refunded row does NOT block a later fresh purchase of the same round
--     (pay -> job fails -> auto-refund -> user pays again is a legal, and
--     correct, sequence).
create unique index if not exists league_generation_jobs_paid_access_uniq
  on public.league_generation_jobs (round_id, user_id)
  where charged and not refunded;
