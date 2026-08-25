/**
 * Anthropic thinking probe: one prism reading vs one synthesis call.
 * Dumps raw usage + content block types + finish/stop reason.
 *
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/oracle-anthropic-thinking-probe.mts
 */
process.env.ORACLE_AI_MODE = 'live'

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'

const OUT = join(process.cwd(), 'docs', 'oracle-anthropic-thinking-probe.json')

const { LAYER1_REGISTRY } = await import('../lib/oracle/ai/registry')
const { callLayer1Model } = await import('../lib/oracle/ai/call')
const { createLayer1HttpBudget } = await import('../lib/oracle/ai/http-budget')
const { parseLayer1Json } = await import('../lib/oracle/ai/parse-layer1')
const { parseSynthesisJson } = await import('../lib/oracle/ai/parse-synthesis')
const { buildLayer1SystemPrompt, buildLayer1UserPrompt } = await import(
  '../lib/oracle/ai/prompts/layer1'
)
const { buildSynthesisSystemPrompt, buildSynthesisUserPrompt } = await import(
  '../lib/oracle/ai/prompts/synthesis'
)
const { personalDataFrom, runComputations } = await import('../lib/oracle/runner/compute')
const { buildSynthesisPayload } = await import('../lib/oracle/runner/payload')
const { makeProfile } = await import('../lib/oracle/runner/__tests__/fakes')
const { PRISM_COLORS } = await import('../lib/oracle/engines/prism')
const { SYNTHESIS_MAX_COMPLETION_TOKENS } = await import('../lib/oracle/ai/layer1-adapter')

const LOCALE = 'ko'
const QUESTION = '올해 일의 방향을 어떻게 잡아야 하는가?'
const inputs = JSON.parse(
  readFileSync(join(process.cwd(), 'docs', 'oracle-synthesis-bakeoff-inputs.json'), 'utf8'),
)

type Arm = 'default' | 'thinking_disabled'

async function rawAnthropic(opts: {
  label: string
  systemPrompt: string
  userPrompt: string
  maxTokens: number
  thinking?: 'disabled' | 'enabled' | null
}) {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing')
  const body: Record<string, unknown> = {
    model: 'claude-sonnet-5',
    max_tokens: opts.maxTokens,
    system: opts.systemPrompt,
    messages: [{ role: 'user', content: opts.userPrompt }],
  }
  if (opts.thinking === 'disabled') body.thinking = { type: 'disabled' }
  if (opts.thinking === 'enabled') {
    body.thinking = { type: 'enabled', budget_tokens: Math.min(8000, opts.maxTokens - 256) }
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const json = (await res.json()) as Record<string, unknown>
  const content = Array.isArray(json.content) ? json.content : []
  const text = content
    .filter((b: any) => b?.type === 'text')
    .map((b: any) => b.text)
    .filter(Boolean)
    .join('\n')
  const thinkingBlocks = content.filter(
    (b: any) => b?.type === 'thinking' || b?.type === 'redacted_thinking',
  )
  return {
    label: opts.label,
    httpStatus: res.status,
    stop_reason: json.stop_reason ?? null,
    usage: json.usage ?? null,
    contentBlockTypes: content.map((b: any) => b?.type ?? 'unknown'),
    thinkingBlockCount: thinkingBlocks.length,
    textChars: text.length,
    textPreview: text.slice(0, 200),
    parsedReading: parseLayer1Json(text) != null,
    parsedSynthesis: parseSynthesisJson(text) != null,
  }
}

const profile = makeProfile({
  birthDate: '1988-11-23',
  birthTime: '04:17:00',
  sex: 'F',
  tz: 'Asia/Seoul',
})
const computed = runComputations({
  profile,
  systems: ['prism', 'saju'],
  seed: () => 'anthropic-thinking-probe',
  asOfDate: '2026-08-25',
  locale: LOCALE,
  kind: 'personal',
  question: QUESTION,
  sessionInputs: {
    prism: {
      impulse: PRISM_COLORS[0],
      need: PRISM_COLORS[1],
      identity: PRISM_COLORS[2],
      microCheck: [3, 4, 2, 3],
    },
  },
  personalData: personalDataFrom([profile]),
})
const prism = computed.systems.find((s) => s.system === 'prism')
if (!prism?.aiPayload) throw new Error('missing prism payload')

const readingSystem = buildLayer1SystemPrompt(LOCALE, 'prism')
const readingUser = buildLayer1UserPrompt(prism.aiPayload, LOCALE, 'prism')
const synthSystem = buildSynthesisSystemPrompt(LOCALE)
const synthUser = buildSynthesisUserPrompt(inputs.single.synthesisPayload)

const rows = []
for (const arm of [
  { name: 'reading_default', kind: 'reading' as const, thinking: null as null },
  { name: 'reading_thinking_disabled', kind: 'reading' as const, thinking: 'disabled' as const },
  { name: 'synthesis_default', kind: 'synthesis' as const, thinking: null as null },
  {
    name: 'synthesis_thinking_disabled',
    kind: 'synthesis' as const,
    thinking: 'disabled' as const,
  },
]) {
  const row = await rawAnthropic({
    label: arm.name,
    systemPrompt: arm.kind === 'reading' ? readingSystem : synthSystem,
    userPrompt: arm.kind === 'reading' ? readingUser : synthUser,
    maxTokens: arm.kind === 'reading' ? 700 : SYNTHESIS_MAX_COMPLETION_TOKENS,
    thinking: arm.thinking,
  })
  console.log(JSON.stringify(row, null, 2))
  rows.push(row)
}

// Also exercise the live oracle path (registry now has anthropicThinking:disabled).
const entry = {
  ...LAYER1_REGISTRY.prism,
  maxCompletionTokens: SYNTHESIS_MAX_COMPLETION_TOKENS,
}
const live = await callLayer1Model({
  entry,
  systemPrompt: synthSystem,
  userPrompt: synthUser,
  timeoutMs: 180_000,
  sessionId: 'anthropic-thinking-probe',
  httpBudget: createLayer1HttpBudget(2),
})
const liveRow = {
  label: 'oracle_path_synthesis_registry',
  finishReason: live.finishReason,
  reasoningTokens: live.reasoningTokens,
  contentTokens: live.contentTokens,
  tokensOut: live.tokensOut,
  textChars: (live.text ?? '').length,
  emptyContent: live.emptyContent,
  parsed: parseSynthesisJson(live.text ?? '') != null,
  error: live.error ?? null,
}
console.log(JSON.stringify(liveRow, null, 2))
rows.push(liveRow)

writeFileSync(OUT, JSON.stringify({ rows }, null, 2))
console.log(`wrote ${OUT}`)
