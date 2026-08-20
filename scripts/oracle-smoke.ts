/**
 * One live ORACLE session through layer 1 (real providers) and layer 2 (stub).
 *
 * Does NOT run from tests. Spends real tokens. I will run this once:
 *
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/oracle-smoke.ts
 *
 * Prints per system: brand, latency, tokens, whether the JSON parsed.
 * Model strings are not printed.
 */
process.env.ORACLE_AI_MODE = 'live'

const { PRISM_COLORS } = await import('../lib/oracle/engines/prism')
const { createOracleAiAdapter, oracleAiAdvanceOptions } = await import('../lib/oracle/ai/create-adapter')
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

async function main() {
  const profile = makeProfile({ user_id: USER })
  const store = createFakeStore({ profiles: [profile] })
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

  const ai = createOracleAiAdapter({
    stub: { minDelayMs: 0, maxDelayMs: 0, sleep: async () => {} },
  })
  const extra = oracleAiAdvanceOptions()

  console.log(`session ${created.session.id}  prompt=${created.session.prompt_version}  mode=live`)
  console.log('system'.padEnd(12), 'brand'.padEnd(14), 'ms'.padStart(6), 'in'.padStart(6), 'out'.padStart(6), 'parsed')

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
    const brand = row?.brand ?? LAYER1_REGISTRY[system as keyof typeof LAYER1_REGISTRY].brand
    const parsed = row?.status === 'done' ? 'yes' : 'no'
    const ms = row?.latency_ms ?? 0
    const tokensIn = row?.tokens_in ?? 0
    const tokensOut = row?.tokens_out ?? 0
    console.log(
      system.padEnd(12),
      brand.padEnd(14),
      String(ms).padStart(6),
      String(tokensIn).padStart(6),
      String(tokensOut).padStart(6),
      parsed,
    )
  }

  console.log(`status=${session.status}  readings=${store.readings.length}  verdicts=${store.verdicts.length}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
