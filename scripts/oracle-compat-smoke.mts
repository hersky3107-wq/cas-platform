/**
 * Live 통합 궁합 (kind='compat', scope='combined') smoke: ONE N=3 session on
 * the fake store. Person B is session-scoped (sessionInputs.partner) — a
 * synthetic person, like every fixture here. Prints every layer (12 pair
 * readings, seer ballots with the relationship direction, code tally,
 * synthesis) plus measured cost from model_cost_logs.
 *
 * npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/oracle-compat-smoke.mts
 */
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'

process.env.ORACLE_AI_MODE = 'live'

// Console codepages mangle Korean on Windows shells, so the report is ALSO
// written as UTF-8 to a file, straight from Node.
const REPORT_PATH = 'scripts/_compat-smoke-report.txt'
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

const USER = 'oracle-compat-smoke'
const UNIT_TIMEOUT_MS = 240_000

// Person A: the saved profile fixture. Person B: session-scoped, synthetic.
const profile = makeProfile({ user_id: USER })
const PARTNER = { birthDate: '1991-03-08', birthTime: '21:40', sex: 'M' as const, name: '박도윤' }

const store = createFakeStore({ profiles: [profile] })

// Cost logs join on a real UUID, so force one per inserted session.
const insert = store.insertSession.bind(store)
let nextSessionId = randomUUID()
store.insertSession = async (row) => {
  const created = await insert(row)
  const retained = store.sessions.find((session) => session.id === created.id)
  if (!retained) throw new Error('smoke session missing from fake store')
  retained.id = nextSessionId
  return { ...created, id: nextSessionId }
}

async function runCompat(label: string, readerCount: 3 | 5 | 7) {
  nextSessionId = randomUUID()
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
      kind: 'compat',
      subjectProfileId: profile.id,
      scope: 'combined',
      systems: [],
      question: null,
      sessionInputs: {
        partner: PARTNER,
        // Relationship draw rituals: 본인·상대·두 사람 사이·걸림돌·흐름.
        tarot: { spread: 5, pickedPositions: [14, 3, 71, 8, 22] },
        runes: { spread: 3, pickedPositions: [7, 19, 2] },
        iching: { lines: [7, 8, 9, 6, 7, 8] },
      },
      readerCount,
      locale: 'ko',
    },
    { store, credits: createFakeCredits(10_000), seed: () => `oracle-compat-smoke-${label}` },
  )
  if (!created.ok) throw new Error(`${label} create failed: ${created.message}`)
  const sessionId = created.session.id
  out(`assumptions=${JSON.stringify(created.assumptions ?? {})} credits_charged=${created.session.credits_charged}`)

  const startedAt = Date.now()
  const extra = { ...oracleAiAdvanceOptions(), unitTimeoutMs: UNIT_TIMEOUT_MS }
  for (let i = 0; i < 40; i += 1) {
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
    if (!current) throw new Error(`${label} session disappeared`)
    if (['done', 'partial', 'failed'].includes(current.status)) break
  }
  const wallMs = Date.now() - startedAt

  const session = (await store.getSession(sessionId))!
  const readings = store.readings.filter((row) => row.session_id === sessionId)
  const verdicts = store.verdicts.filter((row) => row.session_id === sessionId)
  const consensus = store.consensus.find((row) => row.session_id === sessionId) ?? null

  out(`\n=== ${label} session=${sessionId} status=${session.status} wall_ms=${wallMs} ===`)
  const sampleReading = store.computations.find((row) => row.session_id === sessionId)
  out(`readingInput=${String(sampleReading?.ai_payload?.readingInput ?? 'missing')}`)

  out('\nunit\tbrand\tstatus\treasoning\tcontent\tfinish\tms')
  for (const row of readings) {
    const last = calls.filter((c) => c.kind === 'reading' && c.brand === row.brand).at(-1)?.result
    out(
      `reading:${row.system}\t${row.brand}\t${row.status}\t${last?.reasoningTokens ?? '-'}\t${last?.contentTokens ?? '-'}\t${last?.finishReason ?? '-'}\t${row.latency_ms}`,
    )
    if (row.status !== 'done' && last) {
      out(
        `  ↳ error=${last.error ?? '-'} class=${last.diagnostics?.errorClass ?? '-'} http=${last.diagnostics?.httpStatus ?? '-'} body=${(last.diagnostics?.responseBody ?? '').slice(0, 300)}`,
      )
    }
  }
  for (const row of verdicts) {
    const last = calls.filter((c) => c.kind === 'verdict' && c.brand === row.brand).at(-1)?.result
    out(
      `seer:${row.reader_slug}\t${row.brand}\t${row.status}\t${last?.reasoningTokens ?? '-'}\t${last?.contentTokens ?? '-'}\t${last?.finishReason ?? '-'}\t${row.latency_ms}`,
    )
  }
  const synthesisLast = calls.filter((c) => c.kind === 'synthesis').at(-1)?.result
  out(
    `synthesis\t${synthesisLast?.brand ?? '?'}\t${consensus?.domain_stats?.synthesis ? 'done' : 'missing'}\t${synthesisLast?.reasoningTokens ?? '-'}\t${synthesisLast?.contentTokens ?? '-'}\t${synthesisLast?.finishReason ?? '-'}\t${synthesisLast?.latencyMs ?? '-'}`,
  )

  out(`\n--- ${label} seer ballots (direction = 다가서라/이대로/거리를 두라) ---`)
  for (const row of verdicts) {
    out(`\n[${row.reader_slug} / ${row.brand}] status=${row.status}`)
    out(`verdict_line: ${row.verdict_line ?? '(none)'}`)
    out(`ballot: ${JSON.stringify(row.ballot)}`)
    if (row.dissent) out(`minority_opinion: ${row.dissent}`)
  }
  out(`\nballot_tally=${JSON.stringify(consensus?.ballot_tally ?? null)}`)
  out(`synthesis=${JSON.stringify(consensus?.domain_stats?.synthesis ?? null)}`)

  out(`\n--- ${label} pair readings (12 systems) ---`)
  for (const row of readings) {
    const chars = row.narrative ? [...row.narrative].length : 0
    out(`\n[${row.system} / ${row.brand}] status=${row.status} latency_ms=${row.latency_ms} chars=${chars}`)
    out(row.narrative ?? '(결번)')
  }

  const { data, error } = await supabaseAdmin
    .from('model_cost_logs')
    .select('ai_name, input_tokens, output_tokens, cost_usd')
    .eq('oracle_session_id', sessionId)
  if (error) throw new Error(`${label} cost query failed: ${error.message}`)
  const rows = data ?? []
  const total = rows.reduce(
    (sum, row) => sum + (typeof row.cost_usd === 'number' ? row.cost_usd : Number(row.cost_usd) || 0),
    0,
  )
  const byBrand = new Map<string, { calls: number; cost: number }>()
  for (const row of rows) {
    const key = String(row.ai_name)
    const entry = byBrand.get(key) ?? { calls: 0, cost: 0 }
    entry.calls += 1
    entry.cost += typeof row.cost_usd === 'number' ? row.cost_usd : Number(row.cost_usd) || 0
    byBrand.set(key, entry)
  }
  out(`\n--- ${label} model_cost_logs (session=${sessionId}) ---`)
  for (const [brand, entry] of [...byBrand.entries()].sort((a, b) => b[1].cost - a[1].cost)) {
    out(`${brand}\tcalls=${entry.calls}\tcost_usd=${entry.cost.toFixed(6)}`)
  }
  out(`TOTAL rows=${rows.length} cost_usd=${total.toFixed(6)}`)

  return { sessionId, status: session.status, totalCostUsd: total, unitRows: rows.length, wallMs }
}

const run = await runCompat('compat-combined-N3', 3)
out(
  `\nSMOKE_RESULT_JSON=${JSON.stringify({
    sessionId: run.sessionId,
    status: run.status,
    totalCostUsd: run.totalCostUsd,
    rows: run.unitRows,
    wallMs: run.wallMs,
  })}`,
)
writeFileSync(REPORT_PATH, report.join('\n'), 'utf8')
console.log(`report written to ${REPORT_PATH}`)
process.exit(0)
