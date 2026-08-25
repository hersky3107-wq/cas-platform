/**
 * Real-DB single-system saju N=3 smoke.
 * Writes through createSupabaseRunnerStore so oracle_job_sessions /
 * oracle_readings / oracle_consensus and brand uniqueness are exercised live.
 * Leaves rows in place for inspection.
 *
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/oracle-real-db-smoke.mts
 */
process.env.ORACLE_AI_MODE = 'live'

const { randomUUID } = await import('node:crypto')
const { PRISM_COLORS } = await import('../lib/oracle/engines/prism')
const { createOracleAiAdapter, oracleAiAdvanceOptions } = await import(
  '../lib/oracle/ai/create-adapter'
)
const { advanceOracleSession } = await import('../lib/oracle/runner/advance')
const { createOracleSession } = await import('../lib/oracle/runner/create')
const { createSupabaseRunnerStore } = await import('../lib/oracle/runner/store')
const { createFakeCredits, createScheduler } = await import(
  '../lib/oracle/runner/__tests__/fakes'
)
const { supabaseAdmin } = await import('../lib/supabase/server')

const OWNER_USER = '2a6a2ac4-3ee7-436f-869f-baaf31eab769' // existing auth.users row
const DIAGNOSTIC_TIMEOUT_MS = 240_000

// Cancel any active job for this user so create does not reuse it.
const store = createSupabaseRunnerStore()
const active = await store.findActiveSession(OWNER_USER)
if (active) {
  await store.updateSession(active.id, {
    status: 'failed',
    next_action: null,
    completed_at: new Date().toISOString(),
    lease_until: null,
  })
  console.log(`closed prior active session ${active.id}`)
}

const profileId = randomUUID()
const { error: profileError } = await supabaseAdmin.from('oracle_profiles').insert({
  id: profileId,
  user_id: OWNER_USER,
  label: `real-db-smoke-${randomUUID().slice(0, 8)}`,
  is_self: false,
  birth_date: '1988-11-23',
  birth_time: '04:17:00',
  birth_time_source: 'exact',
  sex: 'F',
  birth_place: 'Busan',
  lat: 35.1796,
  lng: 129.0756,
  tz: 'Asia/Seoul',
  name_local: '김민서',
  name_latin: 'Minseo Kim',
})
if (profileError) throw new Error(`profile insert failed: ${profileError.message}`)

const credits = createFakeCredits(10_000)
const created = await createOracleSession(
  OWNER_USER,
  {
    kind: 'personal',
    subjectProfileId: profileId,
    scope: 'single',
    systems: ['saju'],
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
  { store, credits, seed: () => 'oracle-real-db-smoke-saju-n3' },
)
if (!created.ok) throw new Error(`create failed: ${created.message}`)

const sessionId = created.session.id
console.log(`created session=${sessionId} user=${OWNER_USER} profile=${profileId}`)

const ai = createOracleAiAdapter({
  stub: { minDelayMs: 0, maxDelayMs: 0, sleep: async () => {} },
})
const extra = { ...oracleAiAdvanceOptions(), unitTimeoutMs: DIAGNOSTIC_TIMEOUT_MS }

for (let i = 0; i < 30; i += 1) {
  const scheduler = createScheduler()
  await advanceOracleSession(sessionId, {
    store,
    credits,
    ai,
    schedule: scheduler.schedule,
    ...extra,
  })
  await scheduler.drain()
  const current = await store.getSession(sessionId)
  if (!current) throw new Error('session disappeared')
  console.log(`advance ${i + 1}: status=${current.status} next=${current.next_action}`)
  if (['done', 'partial', 'failed'].includes(current.status)) break
}

const session = await store.getSession(sessionId)
const readings = await store.listReadings(sessionId)
const consensus = await store.getConsensus(sessionId)
const { data: costRows, error: costErr } = await supabaseAdmin
  .from('model_cost_logs')
  .select('ai_name, cost_usd, input_tokens, output_tokens, response_time_ms')
  .eq('oracle_session_id', sessionId)

const totalCost = (costRows ?? []).reduce(
  (sum, row) => sum + (typeof row.cost_usd === 'number' ? row.cost_usd : Number(row.cost_usd) || 0),
  0,
)

const synthesis =
  consensus?.domain_stats &&
  typeof consensus.domain_stats === 'object' &&
  consensus.domain_stats !== null &&
  'synthesis' in consensus.domain_stats
    ? (consensus.domain_stats as { synthesis?: unknown }).synthesis
    : null

console.log(
  JSON.stringify(
    {
      sessionId,
      status: session?.status,
      scope: session?.scope,
      systems: session?.systems,
      readerRoster: session?.reader_roster,
      readingsCount: readings.length,
      readingBrands: readings.map((r) => ({ system: r.system, brand: r.brand, status: r.status })),
      distinctBrands: [...new Set(readings.map((r) => r.brand))],
      synthesisPresent: synthesis != null,
      synthesis,
      costLogRows: costRows?.length ?? 0,
      costError: costErr?.message ?? null,
      totalCostUsd: totalCost,
    },
    null,
    2,
  ),
)

if (readings.length !== 3) throw new Error(`expected 3 readings, got ${readings.length}`)
if (new Set(readings.map((r) => r.brand)).size !== 3) {
  throw new Error('expected 3 distinct brands')
}
if (!synthesis) throw new Error('synthesis missing from oracle_consensus.domain_stats')
process.exit(0)
