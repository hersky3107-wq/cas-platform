/**
 * Live smoke for SINGLE-SYSTEM saju N=3 and integrated (12 systems) N=3.
 * Uses the real live adapters/cost logger with the in-memory runner store, so
 * the unapplied oracle_readings uniqueness migration is never written around.
 *
 * npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/oracle-single-system-smoke.mts
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
type Scope = 'single' | 'combined'

const USER = 'oracle-single-system-smoke'
const DIAGNOSTIC_TIMEOUT_MS = 240_000

async function runSmoke(label: string, scope: Scope, systems: string[]) {
  const profile = makeProfile({ user_id: USER })
  const store = createFakeStore({ profiles: [profile] })
  const sessionId = randomUUID()
  const insert = store.insertSession.bind(store)
  store.insertSession = async (row) => {
    const created = await insert(row)
    const retained = store.sessions.find((session) => session.id === created.id)
    if (!retained) throw new Error('smoke session missing from fake store')
    retained.id = sessionId
    return { ...created, id: sessionId }
  }

  const created = await createOracleSession(
    USER,
    {
      kind: 'personal',
      subjectProfileId: profile.id,
      scope,
      systems,
      question: '올해 일의 방향을 어떻게 잡아야 하는가?',
      sessionInputs: {
        prism: {
          impulse: PRISM_COLORS[0],
          need: PRISM_COLORS[1],
          identity: PRISM_COLORS[2],
          microCheck: [3, 4, 2, 3],
        },
      },
      readerCount: 3,
      locale: 'ko',
    },
    {
      store,
      credits: createFakeCredits(10_000),
      seed: () => `oracle-smoke-${label}`,
    },
  )
  if (!created.ok) throw new Error(`${label} create failed: ${created.message}`)

  const calls: Array<{ kind: 'reading' | 'synthesis'; brand: string; result: CallResult }> = []
  const trackedCall: typeof callLayer1Model = async (input) => {
    const result = await callLayer1Model(input)
    calls.push({
      kind: input.systemPrompt.includes('synthesis layer') ? 'synthesis' : 'reading',
      brand: input.entry.brand,
      result,
    })
    return result
  }
  const ai = createOracleAiAdapter({
    stub: { minDelayMs: 0, maxDelayMs: 0, sleep: async () => {} },
    layer1: createLayer1AiAdapter({ call: trackedCall }),
  })
  const extra = { ...oracleAiAdvanceOptions(), unitTimeoutMs: DIAGNOSTIC_TIMEOUT_MS }

  for (let i = 0; i < 30; i += 1) {
    const scheduler = createScheduler()
    await advanceOracleSession(created.session.id, {
      store,
      credits: createFakeCredits(10_000),
      ai,
      schedule: scheduler.schedule,
      ...extra,
    })
    await scheduler.drain()
    const current = await store.getSession(created.session.id)
    if (!current) throw new Error(`${label} session disappeared`)
    if (['done', 'partial', 'failed'].includes(current.status)) break
  }

  const session = await store.getSession(created.session.id)
  if (!session) throw new Error(`${label} session disappeared`)
  console.log(`\n=== ${label} session=${session.id} status=${session.status} ===`)
  console.log('unit\tbrand\tcontent_tokens\tparsed\tfinish_reason\tms\tcost_usd')
  for (const row of store.readings) {
    const attempts = calls.filter((call) => call.kind === 'reading' && call.brand === row.brand)
    const last = attempts.at(-1)?.result
    const cost = attempts.reduce((sum, call) => sum + (call.result.costUsd ?? 0), 0)
    console.log(
      `${row.system}\t${row.brand}\t${last?.contentTokens ?? row.tokens_out ?? 0}\t` +
        `${row.status === 'done'}\t${last?.finishReason ?? 'null'}\t${row.latency_ms}\t${cost}`,
    )
  }
  const synthesisCalls = calls.filter((call) => call.kind === 'synthesis')
  const synthesisLast = synthesisCalls.at(-1)?.result
  const synthesisCost = synthesisCalls.reduce((sum, call) => sum + (call.result.costUsd ?? 0), 0)
  const synthesis = store.consensus[0]?.domain_stats?.synthesis ?? null
  console.log(
    `synthesis\t${synthesisLast?.brand ?? 'unknown'}\t${synthesisLast?.contentTokens ?? 0}\t` +
      `${synthesis !== null}\t${synthesisLast?.finishReason ?? 'null'}\t` +
      `${synthesisCalls.reduce((sum, call) => sum + call.result.latencyMs, 0)}\t${synthesisCost}`,
  )
  console.log(`synthesis_json=${JSON.stringify(synthesis)}`)

  const { data, error } = await supabaseAdmin
    .from('model_cost_logs')
    .select('ai_name, input_tokens, output_tokens, cost_usd, response_time_ms, oracle_session_id')
    .eq('oracle_session_id', session.id)
  if (error) throw new Error(`${label} cost query failed: ${error.message}`)
  const total = (data ?? []).reduce(
    (sum, row) => sum + (typeof row.cost_usd === 'number' ? row.cost_usd : Number(row.cost_usd) || 0),
    0,
  )
  console.log(`model_cost_logs session=${session.id} rows=${data?.length ?? 0} total_cost_usd=${total}`)
  return { sessionId: session.id, status: session.status, synthesis, totalCostUsd: total }
}

const single = await runSmoke('single-saju-N3', 'single', ['saju'])
const integrated = await runSmoke('integrated-N3', 'combined', [])
console.log(`\nSMOKE_RESULT_JSON=${JSON.stringify({ single, integrated })}`)
process.exit(0)
