/**
 * Backfill official KRX daily closes into public.league_krx_daily.
 *
 * Default is dry-run: prints planned dates, planned calls, and the total
 * planned request count. Dry-run makes NO network request.
 * Only --apply fetches, upserts, and prints row counts.
 *
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/league/krx-daily-backfill.ts
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/league/krx-daily-backfill.ts --apply
 */
import { ensureKrxDay } from '@/lib/league/korea-market-data'
import { lastCompletedKrxSession, lastNKrxSessionDates } from '@/lib/league/krx-calendar'

const SESSIONS = 90
const DELAY_MS = 350

const DAILY_CALLS = [
  { market: 'KOSPI', path: '/stk_bydd_trd' },
  { market: 'KOSDAQ', path: '/ksq_bydd_trd' },
] as const

export function parseKrxDailyBackfillArgs(argv: string[]): { apply: boolean } {
  let apply = false
  for (const arg of argv) {
    if (arg === '--apply') apply = true
    if (arg === '--dry-run') apply = false
  }
  return { apply }
}

export function planKrxDailyCalls(isoDate: string): { label: string }[] {
  return DAILY_CALLS.map((call) => ({ label: `${isoDate} ${call.market} ${call.path}` }))
}

export type KrxDailyBackfillIo = {
  now?: () => Date
  log?: (message: string) => void
  sleep?: (ms: number) => Promise<void>
  fetchDay?: (basDd: string) => Promise<unknown>
  ensureDay?: typeof ensureKrxDay
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function runKrxDailyBackfill(
  argv: string[] = process.argv.slice(2),
  io: KrxDailyBackfillIo = {},
): Promise<void> {
  const { apply } = parseKrxDailyBackfillArgs(argv)
  const dryRun = !apply
  const log = io.log ?? ((message: string) => console.log(message))
  const last = lastCompletedKrxSession((io.now ?? (() => new Date()))())
  if (!last.ok) {
    throw new Error(`cannot backfill: ${last.reason}`)
  }
  const dates = lastNKrxSessionDates(last.date, SESSIONS)
  log(
    `KRX daily backfill: ${dates[0]} → ${dates[dates.length - 1]} (${dates.length} sessions) ${dryRun ? 'dry-run' : 'APPLY'}`,
  )

  let plannedTotal = 0
  for (const date of dates) {
    const planned = planKrxDailyCalls(date)
    plannedTotal += planned.length
    log(`${date}  planned_calls=${planned.length}`)
    for (const call of planned) log(`  ${call.label}`)
  }

  if (dryRun) {
    log(`done  total_planned_requests=${plannedTotal}`)
    return
  }

  const ensureDay = io.ensureDay ?? ensureKrxDay
  const sleep = io.sleep ?? defaultSleep

  let ok = 0
  let holiday = 0
  let notPublished = 0
  let cached = 0
  let failed = 0

  for (const date of dates) {
    try {
      const result = await ensureDay(date)
      if (result === 'ok') ok += 1
      else if (result === 'cached') cached += 1
      else if (result === 'holiday') holiday += 1
      else notPublished += 1
      log(`${date}  ${result}`)
    } catch (err) {
      failed += 1
      log(`${date}  error: ${err instanceof Error ? err.message : String(err)}`)
    }
    await sleep(DELAY_MS)
  }

  log(
    `done  ok=${ok} cached=${cached} holiday=${holiday} not_published=${notPublished} failed=${failed}`,
  )
  if (failed > 0) process.exitCode = 1
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/league/krx-daily-backfill.ts')
if (isMain) {
  runKrxDailyBackfill().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
