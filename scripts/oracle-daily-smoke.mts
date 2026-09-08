/**
 * Live 오늘의 운세 (kind='daily') smoke: ONE session on the fake store,
 * one Z.ai weave, automatic tarot/rune draw. Prints the narrative, visuals,
 * and measured cost from model_cost_logs.
 *
 * npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/oracle-daily-smoke.mts
 */
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'

process.env.ORACLE_AI_MODE = 'live'

const REPORT_PATH = 'scripts/_daily-smoke-report.txt'
const report: string[] = []
function out(line = '') {
  report.push(line)
  console.log(line)
}

const { createOracleAiAdapter, oracleAiAdvanceOptions } = await import('../lib/oracle/ai/create-adapter')
const { callLayer1Model } = await import('../lib/oracle/ai/call')
const { createLayer1AiAdapter } = await import('../lib/oracle/ai/layer1-adapter')
const { advanceOracleSession } = await import('../lib/oracle/runner/advance')
const { createOracleSession } = await import('../lib/oracle/runner/create')
const {
  createFakeCredits,
  createFakeStore,
  createScheduler,
  makeProfile,
} = await import('../lib/oracle/runner/__tests__/fakes')
const { supabaseAdmin } = await import('../lib/supabase/server')

type CallResult = Awaited<ReturnType<typeof callLayer1Model>>

const USER = 'oracle-daily-smoke'
const UNIT_TIMEOUT_MS = 240_000

const profile = makeProfile({ user_id: USER })
const store = createFakeStore({ profiles: [profile] })

const insert = store.insertSession.bind(store)
let nextSessionId = randomUUID()
store.insertSession = async (row) => {
  const created = await insert(row)
  const retained = store.sessions.find((session) => session.id === created.id)
  if (!retained) throw new Error('smoke session missing from fake store')
  retained.id = nextSessionId
  return { ...created, id: nextSessionId }
}

const calls: Array<{ kind: 'reading' | 'synthesis' | 'verdict'; brand: string; result: CallResult }> = []
const trackedCall: typeof callLayer1Model = async (input) => {
  const result = await callLayer1Model(input)
  calls.push({
    kind: input.systemPrompt.includes('synthesis layer')
      ? 'synthesis'
      : input.systemPrompt.includes('seer on a panel')
        ? 'verdict'
        : 'reading',
    brand: input.entry.brand,
    result,
  })
  return result
}
const ai = createOracleAiAdapter({
  stub: { minDelayMs: 0, maxDelayMs: 0, sleep: async () => {} },
  layer1: createLayer1AiAdapter({ call: trackedCall }),
})

const created = await createOracleSession(
  USER,
  {
    kind: 'daily',
    subjectProfileId: profile.id,
    scope: 'combined',
    systems: [],
    question: null,
    sessionInputs: null,
    readerCount: 1,
    locale: 'ko',
  },
  { store, credits: createFakeCredits(10_000) },
)
if (!created.ok) throw new Error(`daily create failed: ${created.message}`)
const sessionId = created.session.id
out(`credits_charged=${created.session.credits_charged} seed=${created.session.seed}`)
out(`systems=${created.session.systems.join(',')}`)
out(`roster=${created.session.reader_roster.join(',')}`)
out(`asOfDate=${String(created.session.session_inputs?.asOfDate ?? '')}`)
out(`assumptions=${JSON.stringify(created.assumptions ?? {})}`)

const saju = created.computations.find((row) => row.system === 'saju')
const tarot = created.computations.find((row) => row.system === 'tarot')
const runes = created.computations.find((row) => row.system === 'runes')
out(`saju_iljin=${JSON.stringify((saju?.calculation as { iljin?: unknown } | null)?.iljin ?? null)}`)
out(`tarot=${JSON.stringify((tarot?.calculation as { draw?: unknown } | null)?.draw ?? null)}`)
out(`runes=${JSON.stringify((runes?.calculation as { draw?: unknown } | null)?.draw ?? null)}`)

const startedAt = Date.now()
const extra = { ...oracleAiAdvanceOptions(), unitTimeoutMs: UNIT_TIMEOUT_MS }
for (let i = 0; i < 12; i += 1) {
  const scheduler = createScheduler()
  await advanceOracleSession(sessionId, {
    store,
    credits: createFakeCredits(10_000),
    ai,
    schedule: scheduler.schedule,
    ...extra,
  })
  await scheduler.drain()
  const current = await store.getSession(sessionId)
  if (!current) throw new Error('daily session disappeared')
  if (['done', 'partial', 'failed'].includes(current.status)) break
}
const wallMs = Date.now() - startedAt

const session = (await store.getSession(sessionId))!
const readings = store.readings.filter((row) => row.session_id === sessionId)
out(`\n=== daily session=${sessionId} status=${session.status} wall_ms=${wallMs} ===`)
out(`readings=${readings.length} verdicts=${store.verdicts.length} cache=${store.dailyCaches.length}`)
out(`ai_calls=${calls.length} kinds=${calls.map((c) => c.kind).join(',')}`)

for (const row of readings) {
  const chars = row.narrative ? [...row.narrative].length : 0
  out(`\n[${row.system} / ${row.brand}] status=${row.status} latency_ms=${row.latency_ms} chars=${chars}`)
  out(row.narrative ?? '(결번)')
  out(`summary=${JSON.stringify(row.summary)}`)
}

const { data, error } = await supabaseAdmin
  .from('model_cost_logs')
  .select('ai_name, input_tokens, output_tokens, cost_usd')
  .eq('oracle_session_id', sessionId)
if (error) throw new Error(`daily cost query failed: ${error.message}`)
const rows = data ?? []
const total = rows.reduce(
  (sum, row) => sum + (typeof row.cost_usd === 'number' ? row.cost_usd : Number(row.cost_usd) || 0),
  0,
)
out(`\n--- model_cost_logs (session=${sessionId}) ---`)
for (const row of rows) {
  out(`${row.ai_name}\tin=${row.input_tokens}\tout=${row.output_tokens}\tcost_usd=${row.cost_usd}`)
}
out(`TOTAL rows=${rows.length} cost_usd=${total.toFixed(6)}`)
out(
  `\nSMOKE_RESULT_JSON=${JSON.stringify({
    sessionId,
    status: session.status,
    totalCostUsd: total,
    rows: rows.length,
    wallMs,
    chars: readings[0]?.narrative ? [...readings[0].narrative].length : 0,
  })}`,
)

writeFileSync(REPORT_PATH, report.join('\n'), 'utf8')
out(`\nwrote ${REPORT_PATH}`)
