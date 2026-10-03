/**
 * Backfill KRX investor flows / short / foreign ownership for the last 20 sessions.
 *
 * Default is dry-run: prints planned dates, planned calls, and the total
 * planned request count. Dry-run makes NO network request and does not login.
 * Only --apply logs in, fetches, upserts, and prints row counts.
 *
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/league/krx-flows-backfill.ts
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/league/krx-flows-backfill.ts --apply
 */
import {
  ensureKrxFlowsDay,
  planKrxFlowsCalls,
} from '@/lib/league/korea-flows-data'
import { getKrxSession, type KrxSession } from '@/lib/league/krx-session'
import { lastCompletedKrxSession, lastNKrxSessionDates } from '@/lib/league/krx-calendar'

const SESSIONS = 20

export function parseKrxFlowsBackfillArgs(argv: string[]): { apply: boolean } {
  let apply = false
  for (const arg of argv) {
    if (arg === '--apply') apply = true
    if (arg === '--dry-run') apply = false
  }
  return { apply }
}

export type KrxFlowsBackfillIo = {
  now?: () => Date
  log?: (message: string) => void
  getSession?: () => KrxSession
  ensureDay?: typeof ensureKrxFlowsDay
}

export async function runKrxFlowsBackfill(
  argv: string[] = process.argv.slice(2),
  io: KrxFlowsBackfillIo = {},
): Promise<void> {
  const { apply } = parseKrxFlowsBackfillArgs(argv)
  const dryRun = !apply
  const log = io.log ?? ((message: string) => console.log(message))
  const last = lastCompletedKrxSession((io.now ?? (() => new Date()))())
  if (!last.ok) {
    throw new Error(`cannot backfill: ${last.reason}`)
  }
  const dates = lastNKrxSessionDates(last.date, SESSIONS)
  log(
    `KRX flows backfill: ${dates[0]} → ${dates[dates.length - 1]} (${dates.length} sessions) ${dryRun ? 'dry-run' : 'APPLY'}`,
  )

  let plannedTotal = 0
  for (const date of dates) {
    const planned = planKrxFlowsCalls(date)
    plannedTotal += planned.length
    log(`${date}  planned_calls=${planned.length}`)
    for (const call of planned) log(`  ${call.label}`)
  }

  if (dryRun) {
    log(`done  total_planned_requests=${plannedTotal}`)
    return
  }

  const session = (io.getSession ?? getKrxSession)()
  const ensureDay = io.ensureDay ?? ensureKrxFlowsDay

  let ok = 0
  let holiday = 0
  let notPublished = 0
  let cached = 0
  let failed = 0

  for (const date of dates) {
    try {
      const result = await ensureDay(date, { session })
      if (!result.ok) {
        failed += 1
        log(`${date}  ${result.reason}`)
        if (result.reason === 'password_change_required') {
          log('stopped: password change required')
          break
        }
        continue
      }
      if (result.status === 'ok') ok += 1
      else if (result.status === 'cached') cached += 1
      else if (result.status === 'holiday') holiday += 1
      else notPublished += 1
      log(`${date}  ${result.status}  t2=${result.t2Date}`)
    } catch (err) {
      failed += 1
      log(`${date}  error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  log(
    `done  ok=${ok} cached=${cached} holiday=${holiday} not_published=${notPublished} failed=${failed} total_requests=${session.getRequestCount()}`,
  )
  if (failed > 0) process.exitCode = 1
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/league/krx-flows-backfill.ts')
if (isMain) {
  runKrxFlowsBackfill().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
