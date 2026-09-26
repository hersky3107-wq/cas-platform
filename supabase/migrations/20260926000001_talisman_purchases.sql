-- 부적 unlocks: one PAID row per (user, integrated session, purpose).
-- UNIQUE makes retry / re-download free. First deficiency phone is computed
-- in app code (user's earliest finished integrated session + purpose
-- deficiency + format phone) and MUST NOT write a row — a deficiency row
-- means all 4 formats are paid. Later sessions charge 6 for phone too.
--
-- RLS: authenticated SELECT of own rows only. No INSERT / UPDATE / DELETE
-- policy for authenticated or anon. Writes go through supabaseAdmin
-- (service role), which bypasses RLS.
--
-- DO NOT apply via supabase db push. Paste into the SQL Editor.

create table if not exists public.talisman_purchases (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  session_id      uuid not null references public.oracle_job_sessions(id) on delete cascade,
  purpose         text not null,
  credits_charged integer not null default 0,
  created_at      timestamptz not null default now(),

  constraint talisman_purchases_user_session_purpose_uniq
    unique (user_id, session_id, purpose),
  constraint talisman_purchases_purpose_chk
    check (purpose in ('deficiency', 'wealth', 'love', 'promotion', 'health', 'exorcism')),
  constraint talisman_purchases_credits_chk
    check (credits_charged >= 0)
);

comment on table public.talisman_purchases is
  '부적 paid unlock. One row per (user, integrated session, purpose). Re-download is free because of the UNIQUE key. First deficiency phone is granted in app code and never writes a row.';

alter table public.talisman_purchases enable row level security;

-- SELECT own rows. No insert/update/delete policy on purpose:
--   create policy ... for insert/update/delete  — absent
--   create policy ... for all                    — absent
-- Anon and authenticated clients therefore cannot INSERT.
-- Service role bypasses RLS and is the only writer.
drop policy if exists "own_talisman_purchases" on public.talisman_purchases;
drop policy if exists "own_talisman_purchases_select" on public.talisman_purchases;
create policy "own_talisman_purchases_select" on public.talisman_purchases
  for select
  to authenticated
  using (user_id = auth.uid());

create index if not exists talisman_purchases_session_id_idx
  on public.talisman_purchases (session_id);
