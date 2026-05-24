create table if not exists public.deep_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  deep_type text not null,
  question text not null,
  responses jsonb not null,
  is_public boolean not null default false,
  share_id text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists deep_sessions_share_id_idx on public.deep_sessions (share_id);
create index if not exists deep_sessions_user_id_idx on public.deep_sessions (user_id);
