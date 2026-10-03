/**
 * Backfill KRX investor flows / short / foreign ownership for the last 20 sessions.
 *
 * Default is dry-run (prints planned calls and row counts, no writes).
 * Only --apply upserts.
 *
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/league/krx-flows-backfill.ts
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/league/krx-flows-backfill.ts --apply
 */
import {
  ensureKrxFlowsDay,
  fetchKrxFlowsDay,
  planKrxFlowsCalls,
} from '@/lib/league/korea-flows-data'
import { getKrxSession } from '@/lib/league/krx-session'
import { lastCompletedKrxSession, lastNKrxSessionDates } from '@/lib/league/krx-calendar'

const SESSIONS = 20

function parseArgs(argv: string[]): { apply: boolean } {
  let apply = false
  for (const arg of argv) {
    if (arg === '--apply') apply = true
    if (arg === '--dry-run') apply = false
  }
  return { apply }
}

async function main(): Promise<void> {
  const { apply } = parseArgs(process.argv.slice(2))
  const dryRun = !apply
  const last = lastCompletedKrxSession(new Date())
  if (!last.ok) {
    throw new Error(`cannot backfill: ${last.reason}`)
  }
  const dates = lastNKrxSessionDates(last.date, SESSIONS)
  const session = getKrxSession()
  console.log(
    `KRX flows backfill: ${dates[0]} → ${dates[dates.length - 1]} (${dates.length} sessions) ${dryRun ? 'dry-run' : 'APPLY'}`,
  )

  let ok = 0
  let holiday = 0
  let notPublished = 0
  let cached = 0
  let failed = 0

  for (const date of dates) {
    const planned = planKrxFlowsCalls(date)
    console.log(`${date}  planned_calls=${planned.length}`)
    for (const call of planned) console.log(`  ${call.label}`)
    try {
      if (dryRun) {
        const fetched = await fetchKrxFlowsDay(date, session)
        if (!fetched.ok) {
          failed += 1
          console.log(`${date}  ${fetched.reason}`)
          if (fetched.reason === 'password_change_required') {
            console.log('stopped: password change required')
            break
          }
          continue
        }
        const { flows, shorts, foreign, balance, t2Date } = fetched.bundle
        if (flows.length === 0 && shorts.length === 0 && foreign.length === 0) {
          notPublished += 1
          console.log(`${date}  rows=0  not_published  t2=${t2Date}`)
        } else {
          ok += 1
          console.log(
            `${date}  flows=${flows.length} short=${shorts.length} foreign=${foreign.length} t2_balance=${balance.length} t2=${t2Date}`,
          )
        }
      } else {
        const result = await ensureKrxFlowsDay(date, { session })
        if (!result.ok) {
          failed += 1
          console.log(`${date}  ${result.reason}`)
          if (result.reason === 'password_change_required') {
            console.log('stopped: password change required')
            break
          }
          continue
        }
        if (result.status === 'ok') ok += 1
        else if (result.status === 'cached') cached += 1
        else if (result.status === 'holiday') holiday += 1
        else notPublished += 1
        console.log(`${date}  ${result.status}  t2=${result.t2Date}`)
      }
    } catch (err) {
      failed += 1
      console.log(`${date}  error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  console.log(
    `done  ok=${ok} cached=${cached} holiday=${holiday} not_published=${notPublished} failed=${failed} total_requests=${session.getRequestCount()}`,
  )
  if (failed > 0) process.exitCode = 1
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/league/krx-flows-backfill.ts')
if (isMain) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
