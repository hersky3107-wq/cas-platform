/**
 * READ-ONLY check for the league LEADERBOARD + RECORD ROOM pass: runs the
 * same queries `lib/league/leaderboard.ts` / `lib/league/record-room.ts` do,
 * then hands the rows to the same pure aggregation functions those modules
 * call, and prints the result. Does NOT call the orchestrator, does NOT
 * create/mutate any row — pure DB reads. (Imports the pure aggregate
 * functions directly rather than the 'server-only' DB-wrapper modules, same
 * as `scripts/league-card-preview.ts` does for `buildCardData`.)
 *
 * Run:
 *   npx tsx scripts/league-leaderboard-preview.ts
 */
import { supabaseAdmin } from '../lib/supabase/server'
import { buildLeaderboardData, type GradedPredictionRow } from '../lib/league/leaderboard-aggregate'
import {
  buildRecordRoomPage,
  type RecordRoomPredictionRow,
  type RecordRoomRoundRow,
} from '../lib/league/record-room-aggregate'

type GradedQueryRow = {
  model_id: string
  brand: string
  camp: string
  league_tier: string
  is_correct: boolean | null
  prediction_rounds: { category: string; item_type: string } | null
}

async function loadLeaderboardRows(): Promise<GradedPredictionRow[]> {
  const { data, error } = await supabaseAdmin
    .from('model_predictions')
    .select('model_id, brand, camp, league_tier, is_correct, prediction_rounds!inner(category, item_type)')
    .not('is_correct', 'is', null)
    .neq('league_tier', 'scout')
    .eq('prediction_rounds.item_type', 'ranked')

  if (error) throw new Error(`leaderboard query failed: ${error.message}`)

  return ((data ?? []) as unknown as GradedQueryRow[])
    .filter((row) => row.is_correct !== null && row.prediction_rounds !== null)
    .map((row) => ({
      model_id: row.model_id,
      brand: row.brand,
      camp: row.camp,
      league_tier: row.league_tier,
      category: row.prediction_rounds!.category,
      is_correct: row.is_correct!,
    }))
}

async function main() {
  console.log('=== Leaderboard (GET /api/league/leaderboard equivalent) ===\n')
  const rows = await loadLeaderboardRows()
  const leaderboard = buildLeaderboardData(rows)
  console.log(`Total in-scope graded predictions considered: ${leaderboard.totalConsidered}\n`)

  console.log('--- Model view ---')
  printRows(leaderboard.model.rows)

  console.log('\n--- Camp view (US vs. China vs. Other) ---')
  printRows(leaderboard.camp.rows)

  console.log('\n--- Tier view ---')
  printRows(leaderboard.tier.rows)

  console.log('\n--- Category view ---')
  printRows(leaderboard.category.rows)

  console.log('\n=== Record room, page 1 (GET /api/league/record-room equivalent) ===\n')
  const { data: roundRows, error: roundsError, count } = await supabaseAdmin
    .from('prediction_rounds')
    .select('id, proposition_text, category, color_bucket, instrument, resolved_at, actual_outcome', { count: 'exact' })
    .not('resolved_at', 'is', null)
    .order('resolved_at', { ascending: false })
    .range(0, 9)
  if (roundsError) throw new Error(`record room rounds query failed: ${roundsError.message}`)

  const rounds = (roundRows ?? []) as RecordRoomRoundRow[]
  const roundIds = rounds.map((r) => r.id)
  let predictions: RecordRoomPredictionRow[] = []
  if (roundIds.length > 0) {
    const { data: predictionRows, error: predictionsError } = await supabaseAdmin
      .from('model_predictions')
      .select('round_id, model_id, brand, camp, league_tier, predicted_direction, is_correct')
      .in('round_id', roundIds)
    if (predictionsError) throw new Error(`record room predictions query failed: ${predictionsError.message}`)
    predictions = (predictionRows ?? []) as RecordRoomPredictionRow[]
  }

  const recordRoom = buildRecordRoomPage(rounds, predictions, 1, 10, count ?? 0)
  console.log(`totalRounds=${recordRoom.totalRounds} totalPages=${recordRoom.totalPages}\n`)
  for (const round of recordRoom.rounds) {
    console.log(`  [${round.resolved_at}] ${round.instrument} — "${round.proposition_text}"`)
    console.log(`    actual_outcome=${round.actual_outcome ?? 'n/a'}  graded=${round.gradedCount} correct=${round.correctCount}`)
    for (const m of round.models) {
      console.log(`      ${m.brand.padEnd(14)} direction=${m.direction ?? 'n/a'} is_correct=${m.is_correct}`)
    }
  }
  if (recordRoom.rounds.length === 0) console.log('  (no resolved rounds yet)')
}

function printRows(rows: ReturnType<typeof buildLeaderboardData>['model']['rows']) {
  if (rows.length === 0) {
    console.log('  (no resolved predictions yet — empty state)')
    return
  }
  for (const [i, row] of rows.entries()) {
    const pct = row.winRatePct !== null ? `${row.winRatePct}%` : 'n/a'
    const prov = row.provisional ? ' [provisional]' : ''
    console.log(`  ${i + 1}. ${row.label.padEnd(16)} ${pct.padStart(6)}  (${row.correct}/${row.resolved} = n${row.n})${prov}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
