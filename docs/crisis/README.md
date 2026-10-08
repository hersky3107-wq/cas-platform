# Crisis module

The crisis-risk map is a module inside AIMANI. It is not a separate app. Tables, functions, scripts, and docs for it use the `crisis_` prefix and live under `scripts/crisis` and `docs/crisis`.

## Scope

This slice is storage and geography only:

- `crisis_regions` — country and admin1 polygons
- `crisis_raw_signals` — points from outside sources, assigned to a region on insert
- `crisis_sources` — license and attribution registry
- `crisis_hypotheses` and `crisis_hypothesis_outcomes` — append-only proof ledger

No ingestion workers, model calls, API routes, or UI are part of this slice.

## Isolation

Do not import crisis code from league, oracle, jeju, or gunpo, and do not import those modules from crisis scripts.

Do not edit `lib/ai/router.ts`, `lib/ai/platform-providers.ts`, `middleware.ts`, existing migrations, or existing API routes while working on this module. Do not create or edit `.env.local` from the crisis task. New env names go in `.env.example` only.

Work happens on the `crisis-work` branch. Do not mix it with `league-work`.

## Apply order

The production database is a very small compute tier. Simplifying polygons and applying the migration while the instance is undersized can stall it.

1. Upgrade compute if the current tier is too small for a PostGIS load, then scale back after the load if you want.
2. Paste `docs/crisis/APPLY_MIGRATION.md` into the Supabase SQL editor. Do not use `supabase db push`. The migration file in `supabase/migrations` is the same SQL and stays unapplied until that paste.
3. Dry-run the region loader (default; no database writes):

   ```
   npx tsx scripts/crisis/load-regions.ts
   ```

4. After the migration is applied, load regions:

   ```
   npx tsx --env-file=.env.local scripts/crisis/load-regions.ts --apply
   ```

5. Confirm the schema:

   ```
   npx tsx --env-file=.env.local scripts/crisis/verify-schema.ts
   ```

`verify-schema` inserts one signal from `../crisis-probe/out/normalized.json`, prints the assigned region, and deletes that signal. It also inserts the genesis hypothesis `Ledger genesis — CrisisWatch proof ledger initialized`. Update and delete of that row must fail. The row stays; the ledger is append-only. Both this script and `load-regions` exit if `.env.local` is missing from the current folder.

## Env names

Supabase uses the existing `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Source tokens are listed under `# crisis module` in `.env.example`. None of them are read by this slice.
