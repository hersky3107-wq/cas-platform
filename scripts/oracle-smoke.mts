/**
 * One live ORACLE session through layer 1 (real providers) and layer 2 (stub).
 *
 * Does NOT run from tests. Spends real tokens. I will run this once:
 *
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/oracle-smoke.mts
 *
 * Prints per system: brand, latency, tokens, whether the JSON parsed.
 * Model strings are not printed.
 */
import { randomUUID } from 'node:crypto'

process.env.ORACLE_AI_MODE = 'live'

const { PRISM_COLORS } = await import('../lib/oracle/engines/prism')
const { createOracleAiAdapter, oracleAiAdvanceOptions } = await import('../lib/oracle/ai/create-adapter')
const { callLayer1Model } = await import('../lib/oracle/ai/call')
const { createLayer1AiAdapter } = await import('../lib/oracle/ai/layer1-adapter')
const { LAYER1_REGISTRY } = await import('../lib/oracle/ai/registry')
const { advanceOracleSession } = await import('../lib/oracle/runner/advance')
const { createOracleSession } = await import('../lib/oracle/runner/create')
const {
  createFakeCredits,
  createFakeStore,
  createScheduler,
  makeProfile,
} = await import('../lib/oracle/runner/__tests__/fakes')

const USER = 'oracle-smoke-user'
const PRODUCT_LIVE_TIMEOUT_MS = 80_000
// Let provider calls finish so this diagnostic can distinguish a slow model
// from an HTTP/provider rejection. Product behavior remains at 80 seconds.
const DIAGNOSTIC_TIMEOUT_MS = 240_000

type CallResult = Awaited<ReturnType<typeof callLayer1Model>>

function truncate(value: string | null | undefined, max = 300): string {
  if (!value) return '(none)'
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length > max ? `${compact.slice(0, max)}…` : compact
}

async function main() {
  const profile = makeProfile({ user_id: USER })
  const store = createFakeStore({ profiles: [profile] })
  const smokeSessionId = randomUUID()
  const originalInsertSession = store.insertSession.bind(store)
  store.insertSession = async (row) => {
    const inserted = await originalInsertSession(row)
    const stored = store.sessions.find((session) => session.id === inserted.id)
    if (!stored) throw new Error('smoke session was not retained by the fake store')
    stored.id = smokeSessionId
    return { ...inserted, id: smokeSessionId }
  }
  const credits = createFakeCredits(10_000)
  const created = await createOracleSession(
    USER,
    {
      kind: 'personal',
      subjectProfileId: profile.id,
      scope: 'single',
      systems: [],
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
    { store, credits, seed: () => 'oracle-smoke-seed' },
  )
  if (!created.ok) {
    throw new Error(`create failed: ${created.message}`)
  }

  const callsBySystem = new Map<string, CallResult[]>()
  const trackedCall: typeof callLayer1Model = async (input) => {
    const result = await callLayer1Model(input)
    const calls = callsBySystem.get(input.entry.system) ?? []
    calls.push(result)
    callsBySystem.set(input.entry.system, calls)
    return result
  }
  const layer1 = createLayer1AiAdapter({ call: trackedCall })
  const ai = createOracleAiAdapter({
    stub: { minDelayMs: 0, maxDelayMs: 0, sleep: async () => {} },
    layer1,
  })
  const extra = { ...oracleAiAdvanceOptions(), unitTimeoutMs: DIAGNOSTIC_TIMEOUT_MS }

  console.log(
    `session ${created.session.id}  prompt=${created.session.prompt_version}  mode=live ` +
      `diagnosticTimeout=${DIAGNOSTIC_TIMEOUT_MS}ms productTimeout=${PRODUCT_LIVE_TIMEOUT_MS}ms`,
  )
  console.log(
    'system'.padEnd(12),
    'brand'.padEnd(14),
    'ms'.padStart(7),
    'in'.padStart(6),
    'out'.padStart(6),
    'reason'.padStart(7),
    'content'.padStart(7),
    'parsed',
    'would80sTimeout',
  )

  for (let i = 0; i < 20; i += 1) {
    const scheduler = createScheduler()
    const outcome = await advanceOracleSession(created.session.id, {
      store,
      credits,
      ai,
      schedule: scheduler.schedule,
      ...extra,
    })
    await scheduler.drain()
    const current = await store.getSession(created.session.id)
    if (!current) throw new Error('session disappeared')
    if (!outcome.claimed && (current.status === 'done' || current.status === 'partial' || current.status === 'failed')) {
      break
    }
    if (current.status === 'done' || current.status === 'partial' || current.status === 'failed') break
  }

  const session = await store.getSession(created.session.id)
  if (!session) throw new Error('session disappeared')

  const bySystem = new Map(store.readings.map((row) => [row.system, row]))
  for (const system of Object.keys(LAYER1_REGISTRY)) {
    const row = bySystem.get(system)
    const entry = LAYER1_REGISTRY[system as keyof typeof LAYER1_REGISTRY]
    // Runner-generated deadline failures use brand=unknown. The registry is
    // authoritative, so diagnostics always identify the provider involved.
    const brand = row?.brand && row.brand !== 'unknown' ? row.brand : entry.brand
    const parsed = row?.status === 'done' ? 'yes' : 'no'
    const ms = row?.latency_ms ?? 0
    const tokensIn = row?.tokens_in ?? 0
    const tokensOut = row?.tokens_out ?? 0
    const attempts = callsBySystem.get(system) ?? []
    const call = attempts.at(-1)
    const reasoningTokens = call?.reasoningTokens ?? 0
    const contentTokens = call?.contentTokens ?? (tokensOut ? Math.max(0, tokensOut - reasoningTokens) : 0)
    const wouldTimeout = ms >= PRODUCT_LIVE_TIMEOUT_MS ? 'yes' : 'no'
    console.log(
      system.padEnd(12),
      brand.padEnd(14),
      String(ms).padStart(7),
      String(tokensIn).padStart(6),
      String(tokensOut).padStart(6),
      String(reasoningTokens).padStart(7),
      String(contentTokens).padStart(7),
      parsed,
      wouldTimeout,
    )

    if (row?.status !== 'done') {
      const rowError =
        row?.summary && typeof row.summary.error === 'string'
          ? row.summary.error
          : 'reading failed without a stored error'
      const deadlineFired = row?.status === 'timeout'
      console.log(`  failure.source=${deadlineFired ? 'oracle-deadline' : 'provider'}`)
      console.log(
        `  failure.class=${deadlineFired ? 'OracleUnitDeadlineError' : (call?.diagnostics?.errorClass ?? 'ProviderError')}`,
      )
      console.log(`  failure.httpStatus=${call?.diagnostics?.httpStatus ?? '(none)'}`)
      console.log(`  failure.provider=${call?.diagnostics?.provider ?? entry.brand}`)
      const responseBody = deadlineFired
        ? (call?.diagnostics?.responseBody ?? '(none; provider had not errored when our deadline fired)')
        : (call?.diagnostics?.responseBody ?? rowError)
      console.log(`  failure.body=${truncate(responseBody)}`)
    }

    if (system === 'ziwei' && call) {
      console.log(
        `  qwen.reasoningTokens=${call.reasoningTokens ?? '(not reported)'} ` +
          `contentTokens=${call.contentTokens ?? '(not reported)'} ` +
          `actualCostUsd=${call.costUsd ?? '(not reported)'}`,
      )
    }
  }

  console.log(`status=${session.status}  readings=${store.readings.length}  verdicts=${store.verdicts.length}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
