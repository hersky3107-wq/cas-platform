/**
 * Throwaway live probe: why does reading:name (NAVER HCX-007) fail?
 * Runs the name unit through the real layer-1 adapter and prints every raw
 * response plus the parse/band diagnosis.
 *
 * npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/oracle-name-probe.mts
 */
process.env.ORACLE_AI_MODE = 'live'

const { callLayer1Model } = await import('../lib/oracle/ai/call')
const { createLayer1AiAdapter } = await import('../lib/oracle/ai/layer1-adapter')
const { parseLayer1Json, layer1NarrativeBandViolation } = await import('../lib/oracle/ai/parse-layer1')
const { runComputations, personalDataFrom } = await import('../lib/oracle/runner/compute')
const { makeProfile } = await import('../lib/oracle/runner/__tests__/fakes')

const profile = makeProfile({ user_id: 'name-probe' })
const computed = runComputations({
  profile,
  systems: ['name'],
  seed: 'name-probe-seed',
  asOfDate: '2026-09-05',
  locale: 'ko',
  kind: 'personal',
  question: '올해 일의 방향을 어떻게 잡아야 하는가?',
  sessionInputs: {},
  personalData: personalDataFrom([profile]),
})
const entry = computed.systems[0]!
if (!entry.aiPayload) throw new Error(`name computation has no aiPayload: ${JSON.stringify(entry.calculation)}`)
console.log('payload keys:', Object.keys(entry.aiPayload).join(', '))

// Probe the FIXED config: HCX-007 with a real thinking effort (the dispatcher
// used to pin thinking 'none', which caps HCX prose at ~250 chars).
const { LAYER1_REGISTRY } = await import('../lib/oracle/ai/registry')
const nameEntry = LAYER1_REGISTRY.name as { caller: Record<string, unknown> }
nameEntry.caller = {
  ...nameEntry.caller,
  extraRequestParams: { thinking: { effort: 'low' } },
}

type CallInput = Parameters<typeof callLayer1Model>[0]
const tracked: Array<Awaited<ReturnType<typeof callLayer1Model>>> = []
const adapter = createLayer1AiAdapter({
  call: async (input: CallInput) => {
    const result = await callLayer1Model(input)
    tracked.push(result)
    return result
  },
})

const result = await adapter.run(
  {
    kind: 'reading',
    unit: 'name',
    brand: null,
    sessionId: '00000000-0000-4000-8000-00000000aaaa',
    locale: 'ko',
    payload: entry.aiPayload,
  },
  { timeoutMs: 240_000 },
)

for (const [index, raw] of tracked.entries()) {
  console.log(`\n--- attempt ${index + 1} ---`)
  console.log('error:', raw.error ?? '(none)', '| emptyContent:', raw.emptyContent, '| finish:', raw.finishReason)
  console.log('tokensOut:', raw.tokensOut, '| contentTokens:', raw.contentTokens)
  const text = raw.text ?? ''
  console.log('text length:', text.length)
  console.log('text head:', JSON.stringify(text.slice(0, 400)))
  const parsed = parseLayer1Json(text)
  console.log('parse ok:', parsed !== null, '| band violation:', JSON.stringify(layer1NarrativeBandViolation(text)))
  if (parsed) console.log('narrative chars:', [...parsed.narrative].length)
}

console.log('\n=== adapter result ===')
if (result.ok) {
  console.log('OK — narrative chars:', [...result.text].length)
  console.log(result.text)
} else {
  console.log('FAILED:', result.status, result.message)
}
process.exit(0)
