/**
 * Live INTEGRATED (combined) smoke: one N=3 session and one N=9 session on
 * the same fake store + user, so the N=9 WITNESS seer sees the N=3 session
 * as its previous record. Prints every layer (12 readings, seer ballots,
 * code tally, synthesis) plus measured cost per session from model_cost_logs.
 *
 * npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/oracle-combined-smoke.mts
 */
import { randomUUID } from 'node:crypto'

process.env.ORACLE_AI_MODE = 'live'

const { PRISM_COLORS } = await import('../lib/oracle/engines/prism')
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

const USER = 'oracle-combined-smoke'
const UNIT_TIMEOUT_MS = 240_000
const QUESTION = '올해 일의 방향을 어떻게 잡아야 하는가?'

const profile = makeProfile({ user_id: USER })
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

async function runCombined(label: string, readerCount: 3 | 5 | 9) {
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
      kind: 'personal',
      subjectProfileId: profile.id,
      scope: 'combined',
      systems: [],
      question: QUESTION,
      sessionInputs: {
        prism: {
          impulse: PRISM_COLORS[0],
          need: PRISM_COLORS[1],
          identity: PRISM_COLORS[2],
          microCheck: [3, 4, 2, 3],
        },
        tarot: { spread: 5, pickedPositions: [14, 3, 71, 8, 22] },
        // New rituals: hand-picked stones from the 24-stone cloth and a
        // user-cast 육효 (six three-coin throws, bottom-up).
        runes: { spread: 3, pickedPositions: [7, 19, 2] },
        iching: { lines: [7, 8, 9, 6, 7, 8] },
      },
      readerCount,
      locale: 'ko',
    },
    { store, credits: createFakeCredits(10_000), seed: () => `oracle-combined-smoke-${label}` },
  )
  if (!created.ok) throw new Error(`${label} create failed: ${created.message}`)
  const sessionId = created.session.id

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

  console.log(`\n=== ${label} session=${sessionId} status=${session.status} wall_ms=${wallMs} ===`)
  const sampleReading = store.computations.find((row) => row.session_id === sessionId)
  console.log(`readingInput=${String(sampleReading?.ai_payload?.readingInput ?? 'missing')}`)

  console.log('\nunit\tbrand\tstatus\treasoning\tcontent\tfinish\tms')
  for (const row of readings) {
    const last = calls.filter((c) => c.kind === 'reading' && c.brand === row.brand).at(-1)?.result
    console.log(
      `reading:${row.system}\t${row.brand}\t${row.status}\t${last?.reasoningTokens ?? '-'}\t${last?.contentTokens ?? '-'}\t${last?.finishReason ?? '-'}\t${row.latency_ms}`,
    )
  }
  for (const row of verdicts) {
    const last = calls.filter((c) => c.kind === 'verdict' && c.brand === row.brand).at(-1)?.result
    console.log(
      `seer:${row.reader_slug}\t${row.brand}\t${row.status}\t${last?.reasoningTokens ?? '-'}\t${last?.contentTokens ?? '-'}\t${last?.finishReason ?? '-'}\t${row.latency_ms}`,
    )
  }
  const synthesisLast = calls.filter((c) => c.kind === 'synthesis').at(-1)?.result
  console.log(
    `synthesis\t${synthesisLast?.brand ?? '?'}\t${consensus?.domain_stats?.synthesis ? 'done' : 'missing'}\t${synthesisLast?.reasoningTokens ?? '-'}\t${synthesisLast?.contentTokens ?? '-'}\t${synthesisLast?.finishReason ?? '-'}\t${synthesisLast?.latencyMs ?? '-'}`,
  )

  console.log(`\n--- ${label} seer ballots ---`)
  for (const row of verdicts) {
    console.log(`\n[${row.reader_slug} / ${row.brand}] status=${row.status}`)
    console.log(`verdict_line: ${row.verdict_line ?? '(none)'}`)
    console.log(`ballot: ${JSON.stringify(row.ballot)}`)
    if (row.dissent) console.log(`minority_opinion: ${row.dissent}`)
  }
  console.log(`\nballot_tally=${JSON.stringify(consensus?.ballot_tally ?? null)}`)
  console.log(`synthesis=${JSON.stringify(consensus?.domain_stats?.synthesis ?? null)}`)

  console.log(`\n--- ${label} reader narratives (12 systems) ---`)
  for (const row of readings) {
    const chars = row.narrative ? [...row.narrative].length : 0
    console.log(`\n[${row.system} / ${row.brand}] status=${row.status} latency_ms=${row.latency_ms} chars=${chars}`)
    console.log(row.narrative ?? '(결번)')
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
  console.log(`\n--- ${label} model_cost_logs (session=${sessionId}) ---`)
  for (const [brand, entry] of [...byBrand.entries()].sort((a, b) => b[1].cost - a[1].cost)) {
    console.log(`${brand}\tcalls=${entry.calls}\tcost_usd=${entry.cost.toFixed(6)}`)
  }
  console.log(`TOTAL rows=${rows.length} cost_usd=${total.toFixed(6)}`)

  return { sessionId, status: session.status, totalCostUsd: total, unitRows: rows.length, wallMs }
}

// SMOKE_RUNS=n3 (or n5/n9, comma-separated; n3 may repeat as n3a,n3b for
// unanimity sampling — default n3,n9) selects which sessions to run.
const wanted = (process.env.SMOKE_RUNS ?? 'n3,n9').split(',').map((token) => token.trim())
const results: Record<string, Awaited<ReturnType<typeof runCombined>>> = {}
for (const token of wanted) {
  if (token.startsWith('n3')) results[token] = await runCombined(`combined-N3:${token}`, 3)
  else if (token.startsWith('n5')) results[token] = await runCombined(`combined-N5:${token}`, 5)
  else if (token.startsWith('n9')) results[token] = await runCombined(`combined-N9:${token}`, 9)
}

console.log(
  `\nSMOKE_RESULT_JSON=${JSON.stringify(
    Object.fromEntries(
      Object.entries(results).map(([key, run]) => [
        key,
        { sessionId: run.sessionId, status: run.status, totalCostUsd: run.totalCostUsd, rows: run.unitRows, wallMs: run.wallMs },
      ]),
    ),
  )}`,
)
process.exit(0)
