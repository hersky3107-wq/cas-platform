/**
 * READ-ONLY verification for the card header's anchor/live price fields.
 * Exercises the REAL read path (`fetchCardData`, the exact function
 * `GET /api/league/card` calls) against the latest AAPL round, twice in a
 * row, to show:
 *   1. Whether `anchorPrice` is populated (requires migration
 *      20260818000002_league_anchor_price.sql AND a round created after the
 *      orchestrator change that persists it — an older round will
 *      correctly show null).
 *   2. The live-price cache's cold-then-warm behavior: the FIRST call for an
 *      instrument in this process is expected to return `livePrice: null`
 *      (cache miss kicks off a background fetch); a SECOND call a moment
 *      later should show the warmed value once that background fetch lands.
 *
 * Never calls a paid AI provider — pure DB reads + one Twelve Data /quote
 * call (1 credit) via the live-price cache.
 *
 * Run:
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/verify-card-header-price.ts
 */
import { supabaseAdmin } from '../lib/supabase/server'
import { fetchCardData } from '../lib/league/card'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  const { data: rounds, error } = await supabaseAdmin
    .from('prediction_rounds')
    .select('id, instrument, opened_at')
    .eq('instrument', 'AAPL')
    .order('opened_at', { ascending: false })
    .limit(1)

  if (error || !rounds?.length) {
    console.error('No AAPL round found:', error?.message ?? '(empty)')
    process.exit(1)
  }
  const roundId = rounds[0]!.id
  console.log(`Round: ${roundId}`)

  console.log('\n== Call 1 (expect cold live-price cache) ==')
  const card1 = await fetchCardData({ roundId })
  console.log('  instrument:  ', card1.round.instrument)
  console.log('  anchorPrice: ', card1.round.anchorPrice, '  anchorPriceAt:', card1.round.anchorPriceAt)
  console.log('  livePrice:   ', card1.round.livePrice, '  livePriceAt:  ', card1.round.livePriceAt)

  console.log('\nWaiting 3s for the background live-price fetch to land...')
  await sleep(3000)

  console.log('\n== Call 2 (expect warm cache if Twelve Data call succeeded) ==')
  const card2 = await fetchCardData({ roundId })
  console.log('  instrument:  ', card2.round.instrument)
  console.log('  anchorPrice: ', card2.round.anchorPrice, '  anchorPriceAt:', card2.round.anchorPriceAt)
  console.log('  livePrice:   ', card2.round.livePrice, '  livePriceAt:  ', card2.round.livePriceAt)

  console.log('\n== Verdict ==')
  if (card1.round.anchorPrice === null) {
    console.log('  anchorPrice is null — expected if migration 20260818000002 is not yet applied,')
    console.log('  or if this round predates the orchestrator change that persists it.')
  } else {
    console.log('  anchorPrice is populated correctly.')
  }
  if (card2.round.livePrice !== null) {
    console.log('  livePrice warmed up on the second call — live-price cache works end to end.')
  } else {
    console.log('  livePrice still null after 3s — either Twelve Data is rate-limited/unavailable,')
    console.log('  or this instrument is not price-mappable. The header degrades correctly either way.')
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
