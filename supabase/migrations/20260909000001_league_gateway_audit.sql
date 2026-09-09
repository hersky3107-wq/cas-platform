-- ============================================================================
-- AI Prediction League — freeform gateway abuse + quarantine store.
--
-- Raw user text is UNTRUSTED. This table is the only place it is stored.
-- It must never be interpolated into later prompts (40 models, research
-- director, admin tooling). Service-role only.
-- ============================================================================

create table if not exists public.league_gateway_audit (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  category_id  text not null,
  locale       text not null,
  raw_text     text not null,
  untrusted    boolean not null default true,
  created_at   timestamptz not null default now()
);

create index if not exists league_gateway_audit_user_created_idx
  on public.league_gateway_audit (user_id, created_at desc);

alter table public.league_gateway_audit enable row level security;

comment on table public.league_gateway_audit is
  'QUARANTINED freeform user text. untrusted=true always. Never interpolate into prompts.';

create table if not exists public.league_gateway_normalize_cache (
  cache_key   text primary key,
  output      jsonb not null,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

create index if not exists league_gateway_normalize_cache_exp_idx
  on public.league_gateway_normalize_cache (expires_at);

alter table public.league_gateway_normalize_cache enable row level security;

comment on table public.league_gateway_normalize_cache is
  '24h normalize cache keyed by sha256(category + normalized text + locale). Service-role only.';

create table if not exists public.league_gateway_quota (
  user_id  uuid not null references auth.users(id) on delete cascade,
  day      date not null,
  units    numeric not null default 0,
  primary key (user_id, day)
);

alter table public.league_gateway_quota enable row level security;

comment on table public.league_gateway_quota is
  'Per-account daily normalize quota (20 units; cache hits 0; clarify miss 0.5).';

create table if not exists public.league_gateway_circuit (
  day              date primary key,
  normalize_calls  integer not null default 0,
  search_calls     integer not null default 0
);

alter table public.league_gateway_circuit enable row level security;

comment on table public.league_gateway_circuit is
  'Global daily circuit: 2000 normalize LLM calls, 400 Perplexity candidate searches.';
