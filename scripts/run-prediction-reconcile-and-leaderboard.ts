/**
 * Manually run one prediction-league reconciliation pass, then print the
 * leaderboard snapshot. Calls `reconcileDuePredictionRounds` directly (same
 * function the cron/admin routes use).
 *
 * Requires in .env.local:
 *   TWELVE_DATA_API_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Run:
 *   npx tsx scripts/run-prediction-reconcile-and-leaderboard.ts
 */
import Module from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Allow importing 'server-only' modules outside Next.js (scripts only).
const originalLoad = (Module as unknown as { _load: typeof Module._load })._load
;(Module as unknown as { _load: typeof Module._load })._load = function (request, parent, isMain) {
  if (request === 'server-only') return {}
  // @ts-expect-error — patching Node internals for script use
  return originalLoad.call(this, request, parent, isMain)
}

function loadEnvLocal() {
  const path = join(process.cwd(), '.env.local')
  try {
    const raw = readFileSync(path, 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq <= 0) continue
      const key = trimmed.slice(0, eq).trim()
      let val = trimmed.slice(eq + 1).trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      if (!process.env[key]) process.env[key] = val
    }
  } catch {
    console.warn('Warning: could not read .env.local — relying on existing process.env')
  }
}

async function main() {
  loadEnvLocal()

  const { supabaseAdmin } = await import('../lib/supabase/server')
  const { reconcileDuePredictionRounds } = await import('../lib/prediction/reconciliation')
  const { buildLeaderboardData } = await import('../lib/league/leaderboard-aggregate')

  async function countSnapshot() {
    const nowIso = new Date().toISOString()
    const { count: dueUnresolved } = await supabaseAdmin
      .from('prediction_rounds')
      .select('id', { count: 'exact', head: true })
      .lt('resolves_at', nowIso)
      .is('actual_outcome', null)
    const { count: resolvedRounds } = await supabaseAdmin
      .from('prediction_rounds')
      .select('id', { count: 'exact', head: true })
      .not('resolved_at', 'is', null)
    const { count: gradedPreds } = await supabaseAdmin
      .from('model_predictions')
      .select('id', { count: 'exact', head: true })
      .not('is_correct', 'is', null)
    return { dueUnresolved: dueUnresolved ?? 0, resolvedRounds: resolvedRounds ?? 0, gradedPreds: gradedPreds ?? 0 }
  }

  console.log('=== Before reconcile ===')
  const before = await countSnapshot()
  console.log(JSON.stringify(before, null, 2))

  // List due rounds for visibility
  const nowIso = new Date().toISOString()
  const { data: dueList } = await supabaseAdmin
    .from('prediction_rounds')
    .select('id, instrument, category, resolves_at, item_type')
    .lt('resolves_at', nowIso)
    .is('actual_outcome', null)
    .order('resolves_at', { ascending: true })
  console.log(`\nDue unresolved rounds (${dueList?.length ?? 0}):`)
  for (const r of dueList ?? []) {
    console.log(`  ${r.id}  ${r.instrument}  ${r.category}  resolves ${r.resolves_at}  item_type=${r.item_type}`)
  }

  console.log('\n=== Running reconcileDuePredictionRounds() ===\n')
  const summary = await reconcileDuePredictionRounds(200)
  console.log(JSON.stringify(summary, null, 2))

  console.log('\n=== After reconcile ===')
  const after = await countSnapshot()
  console.log(JSON.stringify(after, null, 2))

  const roundsGraded = after.resolvedRounds - before.resolvedRounds
  const predsGraded = after.gradedPreds - before.gradedPreds
  console.log(`\nDelta: ${roundsGraded} round(s) newly resolved, ${predsGraded} prediction(s) newly graded.`)

  type GradedQueryRow = {
    model_id: string
    brand: string
    camp: string
    league_tier: string
    is_correct: boolean | null
    prediction_rounds: { category: string; item_type: string } | null
  }
  const { data, error } = await supabaseAdmin
    .from('model_predictions')
    .select('model_id, brand, camp, league_tier, is_correct, prediction_rounds!inner(category, item_type)')
    .not('is_correct', 'is', null)
    .eq('prediction_rounds.item_type', 'ranked')
  if (error) throw new Error(`leaderboard query failed: ${error.message}`)

  const rows = ((data ?? []) as unknown as GradedQueryRow[])
    .filter((row) => row.is_correct !== null && row.prediction_rounds !== null)
    .map((row) => ({
      model_id: row.model_id,
      brand: row.brand,
      camp: row.camp,
      league_tier: row.league_tier,
      category: row.prediction_rounds!.category,
      is_correct: row.is_correct!,
      round_id: 'unknown',
      predicted_direction: null as 'up' | 'down' | 'flat' | null,
    }))

  const leaderboard = buildLeaderboardData(rows)
  console.log(`\n=== Leaderboard after reconcile (totalConsidered=${leaderboard.totalConsidered}) ===\n`)
  console.log('--- Model view ---')
  printSlice(leaderboard.model.rows)
  console.log('\n--- Camp view ---')
  printSlice(leaderboard.camp.rows)
}

function printSlice(slice: { label: string; winRatePct: number | null; n: number; correct: number; resolved: number; provisional: boolean }[]) {
  if (slice.length === 0) {
    console.log('  (empty — no in-scope graded predictions yet)')
    return
  }
  for (const [i, row] of slice.entries()) {
    const pct = row.winRatePct !== null ? `${row.winRatePct}%` : 'n/a'
    const prov = row.provisional ? ' [provisional]' : ''
    console.log(`  ${i + 1}. ${row.label.padEnd(16)} ${pct.padStart(6)}  n=${row.n} (${row.correct}/${row.resolved})${prov}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
