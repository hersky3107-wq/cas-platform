/**
 * Post-wipe verification: confirm the leaderboard + record room read paths
 * behave gracefully against the now-empty DB (zero rounds), and that the
 * card read path fails with a clean "not found" rather than a crash.
 *
 * Run:
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/verify-empty-league-state.ts
 */
import { fetchLeaderboardData } from '../lib/league/leaderboard'
import { fetchRecordRoomPage } from '../lib/league/record-room'
import { fetchCardData, CardNotFoundError } from '../lib/league/card'

async function main() {
  console.log('=== Leaderboard (unfiltered, admin view) ===')
  const lb = await fetchLeaderboardData()
  console.log(`  totalConsidered: ${lb.totalConsidered}`)
  console.log(`  model.rows: ${lb.model.rows.length}  camp.rows: ${lb.camp.rows.length}  tier.rows: ${lb.tier.rows.length}  category.rows: ${lb.category.rows.length}`)

  console.log('\n=== Record room (unfiltered, admin view) ===')
  const rr = await fetchRecordRoomPage(1, 20)
  console.log(`  totalRounds: ${rr.totalRounds}  totalPages: ${rr.totalPages}  rounds: ${rr.rounds.length}`)

  console.log('\n=== Card (instrument=AAPL, no rounds exist) ===')
  try {
    await fetchCardData({ instrument: 'AAPL' })
    console.log('  UNEXPECTED: resolved a card when none should exist')
  } catch (e) {
    if (e instanceof CardNotFoundError) {
      console.log(`  OK: CardNotFoundError as expected -> "${e.message}"`)
    } else {
      console.log(`  UNEXPECTED error type: ${e instanceof Error ? e.message : String(e)}`)
      throw e
    }
  }

  console.log('\nAll three read paths handled the empty ledger without crashing.')
}

main().catch((e) => {
  console.error('VERIFICATION FAILED:', e)
  process.exit(1)
})
