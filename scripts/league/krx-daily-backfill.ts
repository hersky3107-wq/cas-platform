/**
 * Backfill official KRX daily closes into public.league_krx_daily.
 *
 * Default is dry-run (fetch + print row counts, no writes).
 * Only --apply upserts.
 *
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/league/krx-daily-backfill.ts
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/league/krx-daily-backfill.ts --apply
 */
import { emptyKrxFetchOutcome, ensureKrxDay, fetchKrxDay, toCompactBasDd } from '@/lib/league/korea-market-data'
import { lastCompletedKrxSession, lastNKrxSessionDates } from '@/lib/league/krx-calendar'

const SESSIONS = 90
const DELAY_MS = 350

function parseArgs(argv: string[]): { apply: boolean } {
  let apply = false
  for (const arg of argv) {
    if (arg === '--apply') apply = true
    if (arg === '--dry-run') apply = false
  }
  return { apply }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main(): Promise<void> {
  const { apply } = parseArgs(process.argv.slice(2))
  const dryRun = !apply
  const last = lastCompletedKrxSession(new Date())
  if (!last.ok) {
    throw new Error(`cannot backfill: ${last.reason}`)
  }
  const dates = lastNKrxSessionDates(last.date, SESSIONS)
  console.log(
    `KRX daily backfill: ${dates[0]} → ${dates[dates.length - 1]} (${dates.length} sessions) ${dryRun ? 'dry-run' : 'APPLY'}`,
  )

  let ok = 0
  let holiday = 0
  let notPublished = 0
  let cached = 0
  let failed = 0

  for (const date of dates) {
    try {
      if (dryRun) {
        const rows = await fetchKrxDay(toCompactBasDd(date))
        if (rows.length === 0) {
          const outcome = emptyKrxFetchOutcome(date)
          if (outcome === 'holiday') holiday += 1
          else notPublished += 1
          console.log(`${date}  rows=0  ${outcome}`)
        } else {
          ok += 1
          const kospi = rows.filter((r) => r.market === 'KOSPI').length
          const kosdaq = rows.filter((r) => r.market === 'KOSDAQ').length
          console.log(`${date}  rows=${rows.length}  KOSPI=${kospi}  KOSDAQ=${kosdaq}`)
        }
      } else {
        const result = await ensureKrxDay(date)
        if (result === 'ok') ok += 1
        else if (result === 'cached') cached += 1
        else if (result === 'holiday') holiday += 1
        else notPublished += 1
        console.log(`${date}  ${result}`)
      }
    } catch (err) {
      failed += 1
      console.log(`${date}  error: ${err instanceof Error ? err.message : String(err)}`)
    }
    await sleep(DELAY_MS)
  }

  console.log(
    `done  ok=${ok} cached=${cached} holiday=${holiday} not_published=${notPublished} failed=${failed}`,
  )
  if (failed > 0) process.exitCode = 1
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/league/krx-daily-backfill.ts')
if (isMain) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
