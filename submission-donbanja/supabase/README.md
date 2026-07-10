# Supabase schema (동반자)

SQL migrations for every table the care app reads or writes.
Run them in order against your Supabase project (SQL Editor or `supabase db push`).

| # | File | Table | Used by |
| --- | --- | --- | --- |
| 1 | `migrations/001_care_tale.sql` | `care_tale` | `app/api/care/tale` — daily 이야기 cache |
| 2 | `migrations/002_care_news.sql` | `care_news` | `app/api/care/news` — daily 소식 cache |
| 3 | `migrations/003_care_brain.sql` | `care_brain` | `app/api/care/brain` — daily 뇌 운동 cache |
| 4 | `migrations/004_care_welfare_services.sql` | `care_welfare_services` | `lib/care/welfare` — 복지 매칭 catalog |

## Notes

- **RLS:** All tables enable RLS. Daily content caches allow public `SELECT`; writes
  go through the service-role client (`supabaseAdmin`) in API routes. Welfare rows
  are reference data — public read, service write.
- **Welfare data:** The `care_welfare_services` table schema is included, but row
  population requires separate offline ingestion from data.go.kr (not part of this
  submission). Without rows, 복지 매칭 returns empty results but the app still runs.
- **Optional caches:** If Supabase is not configured, tale/brain/news skip caching
  and regenerate on each request; welfare matching fails gracefully when the table
  is empty or unreachable.

## Quick apply (Supabase SQL Editor)

Paste and run each file in `migrations/` in numeric order (001 → 004).
