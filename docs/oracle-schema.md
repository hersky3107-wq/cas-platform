# Oracle rebuild schema

Additive tables from `supabase/migrations/20260815000001_oracle_rebuild.sql`.
`public.users.oracle_birth_profile` is the backfill **source** and is never
nulled or dropped. Rollback: `supabase/rollbacks/20260815000001_oracle_rebuild_down.sql`
(manual apply only — not under `supabase/migrations/`).

Types: `lib/oracle/schema.ts`. No API route is wired to these tables yet.
All future routes must use `supabaseAdmin` and still scope every query to
the session uid (RLS is defense-in-depth; the admin client bypasses it).

## Name collision

`public.oracle_sessions` already exists (`20260530000001`) as the share/vote
archive (`share_id`, `voted_ai`, `responses`). It stays. The rebuild job hub
is **`public.oracle_job_sessions`** (TypeScript: `OracleJobSession`).

```
users.oracle_birth_profile ──backfill──► oracle_profiles
                                              │
                                              │ subject / partner
                                              ▼
                                       oracle_job_sessions
                                              │
              ┌───────────────┬───────────────┼───────────────┐
              ▼               ▼               ▼               ▼
     oracle_computations  oracle_readings  oracle_verdicts  oracle_consensus
              │                    ▲
              └────────────────────┘  readings.computation_id

     oracle_daily_cache   (global, no FK)
```

## Tables — who writes / who reads

| Table | Writes | Reads |
|---|---|---|
| `oracle_profiles` | Profile save route (not wired). One-time backfill from `users.oracle_birth_profile`. | Job create (subject/partner), engines (`fourPillars` / 대운), any later history UI. |
| `oracle_job_sessions` | Job-create route + cron sweeper (`status`, `lease_until`, `next_action`, `last_heartbeat_at`). | Cron claim, progress UI, every child-table join. |
| `oracle_computations` | Compute worker (`next_action='compute'`). | Layer-1 readers (as `ai_payload`), later re-view. |
| `oracle_readings` | Layer-1 worker. **Never `select model` in a client query.** | Layer-2 / UI narrative. |
| `oracle_verdicts` | Layer-2 worker. **Never `select model` in a client query.** | Consensus worker, UI ballot. |
| `oracle_consensus` | Consensus worker (`next_action='consensus'`). | Session-end UI. |
| `oracle_daily_cache` | Service-role cron only. | Authenticated SELECT (any logged-in user); no client writes. |
| `oracle_sessions` (legacy) | Existing `save-session` route. **Not part of the rebuild.** | Existing share page. |

`oracle_profiles.sex` is **only** for 대운 direction. Never send it to any AI.

## Backfill

The up migration copies one `oracle_profiles` row per `public.users` row that
has a JSON object in `oracle_birth_profile`, `label='self'`, `is_self=true`.

Mapped when unambiguous:

- `birth_date` ← `dob` or `date_of_birth` (must match `YYYY-MM-DD` or the row is skipped)
- `birth_time_source` ← `time_method` / `birth_time_known` / survey-or-band flags
- `birth_time` ← `birth_time_24h` or `birth_time`, only if source is `exact` or `estimated` and the string is a clock
- `sex` ← `male`/`M` → `M`, `female`/`F` → `F`; `prefer_not_to_say` → NULL
- `birth_place` ← `birth_city`
- `survey_answers` ← `survey_selections` (object only)
- `derived.resolved_sijin_kr` / `derived.time_approx_band` ← copied if present

Left NULL (not in the legacy blob, not guessed): `lat`, `lng`, `tz`, names, `mbti`,
`derived_engine_versions`. A bare time string with no method flag is **not**
treated as exact; time stays NULL and the row is counted as unmapped-fields.

Apply-time counts are `RAISE NOTICE`d as:

`oracle_profiles backfill: source_rows=… inserted=… already_present=… skipped_not_object=… skipped_no_auth=… skipped_no_date=… inserted_with_unmapped_fields=…`

Recount after apply:

```sql
select
  (select count(*) from public.users where oracle_birth_profile is not null) as source_rows,
  (select count(*) from public.oracle_profiles where label = 'self' and is_self) as self_profiles;
```

## RLS

- `oracle_profiles` / `oracle_job_sessions`: owner-only via `user_id = auth.uid()`.
- `oracle_computations` / `oracle_readings` / `oracle_verdicts` / `oracle_consensus`:
  owner-only via join to `oracle_job_sessions.user_id`.
- `oracle_daily_cache`: `SELECT` for `authenticated`; writes via `service_role` only.

## Cron index

`oracle_job_sessions (status, last_heartbeat_at)` — sweep for stale leases.
