-- ============================================================================
-- ORACLE platform rebuild — additive schema (profiles / job sessions / layers).
--
-- ADDITIVE ONLY. This migration:
--   - creates NEW tables
--   - backfills oracle_profiles FROM public.users.oracle_birth_profile
--   - does NOT drop, rewrite, or null out users.oracle_birth_profile
--   - does NOT drop or alter any existing column on any existing table
--
-- NAME COLLISION (explicit adjustment from the spec draft):
--   public.oracle_sessions already exists (20260530000001) as the share/vote
--   archive (share_id, voted_ai, responses). It is still written by
--   app/api/oracle/save-session and read by app/share/[share_id]. Dropping or
--   reshaping it would break that path and would violate ADDITIVE ONLY.
--   The rebuild job-control hub is therefore public.oracle_job_sessions
--   (TypeScript: OracleJobSession). The legacy archive is only given a
--   table comment so operators can tell the two apart.
--
-- Conventions (match 20260813000002_reconciliation_engine.sql):
--   - text + named check constraints, not create type ... as enum
--   - user_id FK → auth.users(id) (not public.users(id))
--   - create table / index if not exists
--   - RLS ENABLE + owner-only policies (defense-in-depth; routes use
--     supabaseAdmin and must still scope every query to session uid)
-- ============================================================================

comment on table public.oracle_sessions is
  'LEGACY share/vote archive (20260530000001). Untouched by the rebuild. New job sessions live in public.oracle_job_sessions.';

-- ── 1. oracle_profiles ──────────────────────────────────────────────────────
create table if not exists public.oracle_profiles (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  label                 text not null,
  is_self               boolean not null default false,
  birth_date            date not null,
  birth_time            time,
  birth_time_source     text not null,
  -- ONLY used for 대운 direction. Never sent to any AI.
  sex                   text,
  birth_place           text,
  lat                   numeric(9,6),
  lng                   numeric(9,6),
  tz                    text,
  name_local            text,
  name_hanja            text,
  name_latin            text,
  mbti                  text,
  survey_answers        jsonb,
  derived               jsonb not null default '{}'::jsonb,
  derived_engine_versions jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint oracle_profiles_user_label_uniq unique (user_id, label),
  constraint oracle_profiles_birth_time_source_chk
    check (birth_time_source in ('exact', 'estimated', 'unknown')),
  constraint oracle_profiles_sex_chk
    check (sex is null or sex in ('M', 'F'))
);

comment on column public.oracle_profiles.sex is
  'ONLY used for 대운 direction. Never sent to any AI.';

create index if not exists oracle_profiles_user_id_idx
  on public.oracle_profiles (user_id);

-- ── 2. oracle_job_sessions (spec name: oracle_sessions) ─────────────────────
create table if not exists public.oracle_job_sessions (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  kind                  text not null,
  subject_profile_id    uuid not null references public.oracle_profiles(id) on delete restrict,
  partner_profile_id    uuid references public.oracle_profiles(id) on delete set null,
  scope                 text not null,
  systems               text[] not null default '{}',
  question_raw          text,
  question_parsed       jsonb,
  reader_count          integer not null,
  reader_roster         text[] not null default '{}',
  status                text not null default 'queued',
  progress              jsonb not null default '{"done":[],"pending":[],"failed":[]}'::jsonb,
  seed                  text not null,
  -- B안 job control
  next_action           text,
  lease_until           timestamptz,
  attempt_count         integer not null default 0,
  last_heartbeat_at     timestamptz,
  credits_charged       integer,
  charged_at            timestamptz,
  locale                text,
  prompt_version        text,
  created_at            timestamptz not null default now(),
  completed_at          timestamptz,

  constraint oracle_job_sessions_kind_chk
    check (kind in ('personal', 'compat', 'daily', 'talisman')),
  constraint oracle_job_sessions_scope_chk
    check (scope in ('single', 'combined')),
  constraint oracle_job_sessions_reader_count_chk
    check (reader_count in (3, 5, 7, 9)),
  constraint oracle_job_sessions_status_chk
    check (status in ('queued', 'computing', 'layer1', 'layer2', 'done', 'partial', 'failed')),
  constraint oracle_job_sessions_next_action_chk
    check (next_action is null or next_action in ('compute', 'layer1', 'layer2', 'consensus'))
);

create index if not exists oracle_job_sessions_user_id_idx
  on public.oracle_job_sessions (user_id);

-- Cron sweep: claim expired / stale leases by status + heartbeat.
create index if not exists oracle_job_sessions_status_heartbeat_idx
  on public.oracle_job_sessions (status, last_heartbeat_at);

-- ── 3. oracle_computations ──────────────────────────────────────────────────
create table if not exists public.oracle_computations (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references public.oracle_job_sessions(id) on delete cascade,
  system          text not null,
  result          jsonb,
  ai_payload      jsonb,
  axes            jsonb,
  engine_version  text,
  constraint oracle_computations_session_system_uniq unique (session_id, system)
);

create index if not exists oracle_computations_session_id_idx
  on public.oracle_computations (session_id);

-- ── 4. oracle_readings ──────────────────────────────────────────────────────
create table if not exists public.oracle_readings (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references public.oracle_job_sessions(id) on delete cascade,
  computation_id  uuid not null references public.oracle_computations(id) on delete cascade,
  system          text not null,
  brand           text not null,
  model           text not null,
  narrative       text,
  summary         jsonb,
  status          text,
  latency_ms      integer,
  tokens_in       integer,
  tokens_out      integer,
  constraint oracle_readings_session_system_uniq unique (session_id, system)
);

comment on column public.oracle_readings.model is
  'server-only — must never be returned to the client';

create index if not exists oracle_readings_session_id_idx
  on public.oracle_readings (session_id);

-- ── 5. oracle_verdicts ──────────────────────────────────────────────────────
create table if not exists public.oracle_verdicts (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references public.oracle_job_sessions(id) on delete cascade,
  reader_slug     text not null,
  brand           text not null,
  model           text not null,
  verdict_line    text,
  ballot          jsonb,
  dissent         text,
  full_text       text,
  status          text,
  latency_ms      integer,
  tokens_in       integer,
  tokens_out      integer,
  constraint oracle_verdicts_session_reader_uniq unique (session_id, reader_slug)
);

comment on column public.oracle_verdicts.model is
  'server-only — must never be returned to the client';

create index if not exists oracle_verdicts_session_id_idx
  on public.oracle_verdicts (session_id);

-- ── 6. oracle_consensus ─────────────────────────────────────────────────────
create table if not exists public.oracle_consensus (
  session_id          uuid primary key references public.oracle_job_sessions(id) on delete cascade,
  system_agreement    jsonb,
  ballot_tally        jsonb,
  domain_stats        jsonb,
  unanimous           boolean,
  deficiency_vector   jsonb,
  computed_at         timestamptz not null default now()
);

-- ── 7. oracle_daily_cache (global, not per-user) ────────────────────────────
create table if not exists public.oracle_daily_cache (
  date          date primary key,
  values        jsonb not null default '{}'::jsonb,
  computed_at   timestamptz not null default now()
);

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.oracle_profiles      enable row level security;
alter table public.oracle_job_sessions  enable row level security;
alter table public.oracle_computations  enable row level security;
alter table public.oracle_readings      enable row level security;
alter table public.oracle_verdicts      enable row level security;
alter table public.oracle_consensus     enable row level security;
alter table public.oracle_daily_cache   enable row level security;

-- Owner-only (direct user_id)
drop policy if exists "own_oracle_profiles" on public.oracle_profiles;
create policy "own_oracle_profiles" on public.oracle_profiles
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own_oracle_job_sessions" on public.oracle_job_sessions;
create policy "own_oracle_job_sessions" on public.oracle_job_sessions
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Owner-only via session_id → oracle_job_sessions.user_id
drop policy if exists "own_oracle_computations" on public.oracle_computations;
create policy "own_oracle_computations" on public.oracle_computations
  using (exists (
    select 1 from public.oracle_job_sessions s
    where s.id = oracle_computations.session_id and s.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.oracle_job_sessions s
    where s.id = oracle_computations.session_id and s.user_id = auth.uid()
  ));

drop policy if exists "own_oracle_readings" on public.oracle_readings;
create policy "own_oracle_readings" on public.oracle_readings
  using (exists (
    select 1 from public.oracle_job_sessions s
    where s.id = oracle_readings.session_id and s.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.oracle_job_sessions s
    where s.id = oracle_readings.session_id and s.user_id = auth.uid()
  ));

drop policy if exists "own_oracle_verdicts" on public.oracle_verdicts;
create policy "own_oracle_verdicts" on public.oracle_verdicts
  using (exists (
    select 1 from public.oracle_job_sessions s
    where s.id = oracle_verdicts.session_id and s.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.oracle_job_sessions s
    where s.id = oracle_verdicts.session_id and s.user_id = auth.uid()
  ));

drop policy if exists "own_oracle_consensus" on public.oracle_consensus;
create policy "own_oracle_consensus" on public.oracle_consensus
  using (exists (
    select 1 from public.oracle_job_sessions s
    where s.id = oracle_consensus.session_id and s.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.oracle_job_sessions s
    where s.id = oracle_consensus.session_id and s.user_id = auth.uid()
  ));

-- daily_cache: authenticated may SELECT; no client INSERT/UPDATE/DELETE.
-- service_role bypasses RLS; the explicit write policy documents intent.
drop policy if exists "oracle_daily_cache_select_authenticated" on public.oracle_daily_cache;
create policy "oracle_daily_cache_select_authenticated"
  on public.oracle_daily_cache
  for select
  to authenticated
  using (true);

drop policy if exists "oracle_daily_cache_service_write" on public.oracle_daily_cache;
create policy "oracle_daily_cache_service_write"
  on public.oracle_daily_cache
  for all
  to service_role
  using (true)
  with check (true);

-- ============================================================================
-- BACKFILL from public.users.oracle_birth_profile
-- Conservative mapping. Ambiguous values → NULL. Source column is NOT touched.
--
-- Recognized source shapes (see lib/oracle/users-oracle-storage.ts):
--   A. OracleBirthProfileV1: { version:1, dob, birth_city, gender, birth_time_known, ... }
--   B. Flattened: { date_of_birth, birth_time, birth_city, gender, time_method, ... }
-- ============================================================================
do $$
declare
  source_rows          integer := 0;
  skipped_not_object   integer := 0;
  skipped_no_auth      integer := 0;
  skipped_no_date      integer := 0;
  inserted_rows        integer := 0;
  already_present      integer := 0;
  rows_with_unmapped   integer := 0;
  rec                  record;
  p                    jsonb;
  v_date               date;
  v_time               time;
  v_time_src           text;
  v_time_raw           text;
  v_sex                text;
  v_place              text;
  v_survey             jsonb;
  v_derived            jsonb;
  v_unmapped           boolean;
  v_inserted           integer;
begin
  for rec in
    select u.id as user_id, u.oracle_birth_profile as raw
    from public.users u
    where u.oracle_birth_profile is not null
  loop
    source_rows := source_rows + 1;
    v_unmapped := false;
    v_date := null;
    v_time := null;
    v_time_src := 'unknown';
    v_time_raw := null;
    v_sex := null;
    v_place := null;
    v_survey := null;
    v_derived := '{}'::jsonb;

    if jsonb_typeof(rec.raw) is distinct from 'object' then
      skipped_not_object := skipped_not_object + 1;
      continue;
    end if;

    p := rec.raw;

    if not exists (select 1 from auth.users a where a.id = rec.user_id) then
      skipped_no_auth := skipped_no_auth + 1;
      continue;
    end if;

    -- birth_date: dob (V1) or date_of_birth (flattened). Must be YYYY-MM-DD.
    if (p->>'dob') ~ '^\d{4}-\d{2}-\d{2}$' then
      v_date := (p->>'dob')::date;
    elsif (p->>'date_of_birth') ~ '^\d{4}-\d{2}-\d{2}$' then
      v_date := (p->>'date_of_birth')::date;
    end if;

    if v_date is null then
      skipped_no_date := skipped_no_date + 1;
      continue;
    end if;

    -- birth_time_source. Do not infer 'exact' from a bare time string.
    if p->>'time_method' = 'exact'
       or p->>'birth_time_known' = 'true' then
      v_time_src := 'exact';
    elsif p->>'time_method' in ('survey', 'band')
       or p->>'time_from_survey' = 'true'
       or nullif(p->>'time_approx_band', '') is not null
       or jsonb_typeof(p->'survey_selections') = 'object' then
      v_time_src := 'estimated';
    elsif p->>'birth_time_known' = 'false'
       or p->>'time_method' is not null then
      v_time_src := 'unknown';
    else
      v_time_src := 'unknown';
    end if;

    -- birth_time: only when source is exact/estimated AND the string is a clock.
    -- Placeholder 12:00 written by the old storage for unknown times is NOT copied
    -- when source is unknown (that 12:00 is a guess, not a fact).
    v_time_raw := coalesce(nullif(p->>'birth_time_24h', ''), nullif(p->>'birth_time', ''));
    if v_time_src in ('exact', 'estimated')
       and v_time_raw ~ '^\d{1,2}:\d{2}(:\d{2})?$' then
      v_time := v_time_raw::time;
    elsif v_time_raw is not null and v_time_src = 'unknown' then
      v_unmapped := true;
    elsif v_time_src in ('exact', 'estimated') and v_time_raw is null then
      v_unmapped := true;
    elsif v_time_raw is not null and v_time_raw !~ '^\d{1,2}:\d{2}(:\d{2})?$' then
      v_unmapped := true;
    end if;

    -- sex: only male/female (and M/F). prefer_not_to_say → NULL (intentional, not unmapped).
    if p->>'gender' in ('male', 'M', 'm') then
      v_sex := 'M';
    elsif p->>'gender' in ('female', 'F', 'f') then
      v_sex := 'F';
    elsif p->>'gender' is not null
          and p->>'gender' not in ('prefer_not_to_say', '') then
      v_unmapped := true;
    end if;

    v_place := nullif(trim(coalesce(p->>'birth_city', '')), '');
    if p->>'birth_city' is not null and v_place is null then
      v_unmapped := true;
    end if;

    if jsonb_typeof(p->'survey_selections') = 'object' then
      v_survey := p->'survey_selections';
    end if;

    -- Copy only explicitly stored derived facts. Do not recompute.
    if nullif(trim(coalesce(p->>'resolved_sijin_kr', '')), '') is not null then
      v_derived := jsonb_build_object('resolved_sijin_kr', p->>'resolved_sijin_kr');
    end if;
    if nullif(p->>'time_approx_band', '') is not null then
      v_derived := v_derived || jsonb_build_object('time_approx_band', p->>'time_approx_band');
    end if;

    -- lat / lng / tz / names / mbti are not in the legacy blob → stay NULL (not unmapped).

    insert into public.oracle_profiles (
      user_id, label, is_self,
      birth_date, birth_time, birth_time_source, sex, birth_place,
      survey_answers, derived
    ) values (
      rec.user_id, 'self', true,
      v_date, v_time, v_time_src, v_sex, v_place,
      v_survey, v_derived
    )
    on conflict (user_id, label) do nothing;

    get diagnostics v_inserted = row_count;
    if v_inserted = 1 then
      inserted_rows := inserted_rows + 1;
      if v_unmapped then
        rows_with_unmapped := rows_with_unmapped + 1;
      end if;
    else
      already_present := already_present + 1;
    end if;
  end loop;

  raise notice 'oracle_profiles backfill: source_rows=% inserted=% already_present=% skipped_not_object=% skipped_no_auth=% skipped_no_date=% inserted_with_unmapped_fields=%',
    source_rows, inserted_rows, already_present,
    skipped_not_object, skipped_no_auth, skipped_no_date,
    rows_with_unmapped;
end $$;
