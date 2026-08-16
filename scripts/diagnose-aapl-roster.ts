/**
 * PART 1 DIAGNOSIS: for the most recent AAPL round, compare the full 41-model
 * roster against the persisted `model_predictions` rows, and classify every
 * missing model as (a) never-called / not-in-roster, (b) errored, or (c)
 * abstained — based on what rows exist and what status/direction they carry.
 *
 * READ-ONLY. No provider calls, no writes.
 *
 * Run:
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/diagnose-aapl-roster.ts
 */
import { supabaseAdmin } from '../lib/supabase/server'
import { LEAGUE_ROSTER, type LeagueRosterEntry } from '../lib/league/roster'

type PredictionRow = {
  model_id: string
  brand: string
  league_tier: string
  predicted_direction: string | null
  predicted_value: number | null
  reasoning_snippet: string | null
  cost_usd: number | null
}

async function main() {
  // Most recent AAPL ranked round.
  const { data: round, error: roundErr } = await supabaseAdmin
    .from('prediction_rounds')
    .select('id, instrument, opened_at, resolved_at, item_type')
    .eq('instrument', 'AAPL')
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (roundErr || !round) {
    console.error('No AAPL round found:', roundErr?.message)
    process.exit(1)
  }
  console.log(`Round: ${round.id}  instrument=${round.instrument}  opened=${round.opened_at}  resolved=${round.resolved_at ?? 'no'}  type=${round.item_type}`)

  const { data: rows, error: rowsErr } = await supabaseAdmin
    .from('model_predictions')
    .select('model_id, brand, league_tier, predicted_direction, predicted_value, reasoning_snippet, cost_usd')
    .eq('round_id', round.id)
  if (rowsErr) {
    console.error('Predictions query failed:', rowsErr.message)
    process.exit(1)
  }

  const byModelId = new Map<string, PredictionRow>()
  for (const r of (rows ?? []) as PredictionRow[]) byModelId.set(r.model_id, r)

  console.log(`\nRoster size: ${LEAGUE_ROSTER.length}  |  DB rows for this round: ${byModelId.size}`)

  const tierOrder = ['premier', 'challenger', 'world', 'scout'] as const
  const rosterByTier = new Map<string, LeagueRosterEntry[]>()
  for (const entry of LEAGUE_ROSTER) {
    const list = rosterByTier.get(entry.tier) ?? []
    list.push(entry)
    rosterByTier.set(entry.tier, list)
  }

  let answered = 0
  let abstained = 0
  let errored = 0
  let missing = 0

  for (const tier of tierOrder) {
    const entries = rosterByTier.get(tier) ?? []
    console.log(`\n=== ${tier.toUpperCase()} (${entries.length} in roster) ===`)
    for (const entry of entries) {
      const row = byModelId.get(entry.id)
      if (!row) {
        missing += 1
        console.log(`  MISSING   ${entry.id.padEnd(28)} brand=${entry.brand.padEnd(16)} camp=${entry.camp}  (no row in model_predictions)`)
        continue
      }
      const status = (row.status ?? '').toLowerCase()
      if (row.predicted_direction) {
        answered += 1
        console.log(`  ANSWERED  ${entry.id.padEnd(28)} ${row.predicted_direction.toUpperCase().padEnd(5)} conf=${row.predicted_value ?? '?'}%  cost=$${row.cost_usd ?? '?'}`)
      } else {
        // No direction and no status column in the DB — an errored/timed-out
        // model and an explicit abstain both persist as direction=null. The
        // reasoning_snippet distinguishes them: a real abstain carries the
        // model's "I can't say" text; a pure error/timeout leaves it null.
        if (row.reasoning_snippet) {
          abstained += 1
          console.log(`  ABSTAINED ${entry.id.padEnd(28)} direction=null  snippet="${row.reasoning_snippet.slice(0, 60)}…"`)
        } else {
          errored += 1
          console.log(`  ERRORED   ${entry.id.padEnd(28)} direction=null, no snippet (call failed or timed out)`)
        }
      }
    }
  }

  // DB rows with no roster entry (shouldn't happen, but worth flagging).
  const orphanRows = [...byModelId.keys()].filter((id) => !LEAGUE_ROSTER.some((e) => e.id === id))
  if (orphanRows.length) {
    console.log(`\n!!! DB rows with NO roster entry: ${orphanRows.join(', ')}`)
  }

  console.log('\n=== SUMMARY ===')
  console.log(`  answered : ${answered}`)
  console.log(`  abstained: ${abstained}`)
  console.log(`  errored  : ${errored}`)
  console.log(`  missing  : ${missing}  (roster=${LEAGUE_ROSTER.length}, in DB=${byModelId.size})`)
  console.log(`  total    : ${answered + abstained + errored + missing}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
