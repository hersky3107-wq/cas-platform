create table if not exists public.arena_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  topic text not null,
  turn_number integer not null,
  rounds jsonb not null,
  is_public boolean not null default false,
  share_id text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists arena_sessions_share_id_idx on public.arena_sessions (share_id);
create index if not exists arena_sessions_user_id_idx on public.arena_sessions (user_id);
