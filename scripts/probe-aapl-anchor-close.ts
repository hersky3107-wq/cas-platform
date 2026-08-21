/**
 * READ-ONLY probe: the actual AAPL daily closes around the first ranked round's
 * window, straight from Twelve Data `time_series`. Used to verify the anchor
 * backfill value instead of trusting a number that came from UI copy.
 *
 * Run: npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/probe-aapl-anchor-close.ts
 */
import { fetchDailyCloses } from '../lib/league/market-data'

async function main() {
  const series = await fetchDailyCloses('AAPL', '2026-08-14', '2026-08-20')
  if (!series.ok) {
    console.error(`time_series failed: ${series.error}`)
    process.exitCode = 1
    return
  }
  console.log('AAPL daily closes (oldest -> newest):')
  for (const bar of series.bars) console.log(`  ${bar.sessionDate}  ${bar.close}`)

  const anchor = series.bars.find((b) => b.sessionDate === '2026-08-17')
  const resolution = series.bars.find((b) => b.sessionDate === '2026-08-18')
  console.log(`\nAug 17 close (anchor candidate): ${anchor ? anchor.close : 'NOT FOUND'}`)
  console.log(`Aug 18 close (resolution): ${resolution ? resolution.close : 'NOT FOUND'}`)
  if (anchor) console.log(`matches UI-copy 305.59? ${anchor.close === 305.59 ? 'YES' : `NO (real ${anchor.close})`}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
})
