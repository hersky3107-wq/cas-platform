/**
 * Live prism length-lock probe after hard enforcement.
 *
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/oracle-prism-length-probe.mts
 */
process.env.ORACLE_AI_MODE = 'live'

const { PRISM_COLORS } = await import('../lib/oracle/engines/prism')
const { callLayer1Model } = await import('../lib/oracle/ai/call')
const { createLayer1AiAdapter } = await import('../lib/oracle/ai/layer1-adapter')
const { LAYER1_REGISTRY } = await import('../lib/oracle/ai/registry')
const { LAYER1_NARRATIVE_MAX } = await import('../lib/oracle/ai/parse-layer1')
const { personalDataFrom, runComputations } = await import('../lib/oracle/runner/compute')
const { makeProfile } = await import('../lib/oracle/runner/__tests__/fakes')

const profile = makeProfile({ user_id: 'oracle-prism-length-probe' })
const sessionInputs = {
  prism: {
    impulse: PRISM_COLORS[0],
    need: PRISM_COLORS[1],
    identity: PRISM_COLORS[2],
    microCheck: [3, 4, 2, 3] as const,
  },
}
const computed = runComputations({
  profile,
  systems: ['prism'],
  seed: 'oracle-prism-length-probe',
  asOfDate: '2026-08-25',
  locale: 'ko',
  kind: 'personal',
  question: '올해 일의 방향을 어떻게 잡아야 하는가?',
  sessionInputs,
  personalData: personalDataFrom([profile]),
})
const payload = computed.systems[0]?.aiPayload
if (!payload) throw new Error('prism payload missing')

const calls: Array<Awaited<ReturnType<typeof callLayer1Model>>> = []
const tracked = async (input: Parameters<typeof callLayer1Model>[0]) => {
  const result = await callLayer1Model(input)
  calls.push(result)
  return result
}
const adapter = createLayer1AiAdapter({ call: tracked })
const result = await adapter.run(
  {
    kind: 'reading',
    sessionId: 'prism-length-probe',
    unit: 'prism',
    brand: 'Anthropic',
    locale: 'ko',
    seed: 'oracle-prism-length-probe',
    payload,
  },
  { timeoutMs: 240_000 },
)

const narrative = result.ok ? result.text : ''
const chars = [...narrative].length
const last = calls.at(-1)
console.log(
  JSON.stringify(
    {
      ok: result.ok,
      attempts: calls.length,
      brand: LAYER1_REGISTRY.prism.brand,
      maxCompletionTokens: LAYER1_REGISTRY.prism.maxCompletionTokens,
      narrativeMax: LAYER1_NARRATIVE_MAX,
      narrativeChars: chars,
      contentTokens: last?.contentTokens ?? null,
      finishReason: last?.finishReason ?? null,
      costUsd: calls.reduce((sum, call) => sum + (call.costUsd ?? 0), 0),
      narrativePreview: narrative.slice(0, 180),
    },
    null,
    2,
  ),
)
process.exit(result.ok && chars <= LAYER1_NARRATIVE_MAX ? 0 : 1)
