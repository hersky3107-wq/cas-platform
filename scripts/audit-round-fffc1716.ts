/**
 * Read-only audit of round fffc1716-cd3d-45f2-883f-1242a373febc.
 * Prints anchor_price, anchor_price_at, anchor_session_date,
 * resolution_price, resolution_session_date, resolves_at.
 *
 * Run: npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/audit-round-fffc1716.ts
 */
import { supabaseAdmin } from '../lib/supabase/server'

const ROUND_ID = 'fffc1716-cd3d-45f2-883f-1242a373febc'

async function main() {
  const { data: round, error } = await supabaseAdmin
    .from('prediction_rounds')
    .select(
      'id, instrument, proposition_text, resolves_at, anchor_price, anchor_price_at, anchor_session_date, resolution_price, resolution_session_date, actual_outcome, resolved_at',
    )
    .eq('id', ROUND_ID)
    .maybeSingle()

  if (error) throw new Error(`select failed: ${error.message}`)
  if (!round) {
    console.log(`round ${ROUND_ID} not found`)
    return
  }

  console.log('round:', round.id)
  console.log('  instrument:', round.instrument)
  console.log('  proposition_text:', round.proposition_text)
  console.log('  anchor_price:', round.anchor_price)
  console.log('  anchor_price_at:', round.anchor_price_at)
  console.log('  anchor_session_date:', round.anchor_session_date)
  console.log('  resolution_price:', round.resolution_price)
  console.log('  resolution_session_date:', round.resolution_session_date)
  console.log('  resolves_at:', round.resolves_at)
  console.log('  actual_outcome:', round.actual_outcome)
  console.log('  resolved_at:', round.resolved_at)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
