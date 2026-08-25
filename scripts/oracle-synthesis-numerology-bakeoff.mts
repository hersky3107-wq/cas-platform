/**
 * Numerology single-panel synthesis bakeoff for self_ip synthesizer evidence.
 *
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/oracle-synthesis-numerology-bakeoff.mts
 */
process.env.ORACLE_AI_MODE = 'live'

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BRANDS = [
  'Google',
  'OpenAI',
  'Moonshot AI',
  'xAI',
  'Anthropic',
  'Z.ai',
  'NVIDIA',
  'DeepSeek',
] as const

const LOCALE = 'ko'
const QUESTION = '올해 일의 방향을 어떻게 잡아야 하는가?'
const OUT_MD = join(process.cwd(), 'docs', 'oracle-synthesis-numerology-bakeoff.md')
const OUT_JSON = join(process.cwd(), 'docs', 'oracle-synthesis-numerology-bakeoff.json')

const { PRISM_COLORS } = await import('../lib/oracle/engines/prism')
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
const { LAYER1_REGISTRY, layer1EntryForBrand } = await import('../lib/oracle/ai/registry')
const { resolveSingleSystemRoster } = await import('../lib/oracle/ai/family-roster')
const { SYNTHESIS_MAX_COMPLETION_TOKENS } = await import('../lib/oracle/ai/layer1-adapter')
const {
  rankSynthesisBrands,
  scoreSynthesisBrand,
} = await import('../lib/oracle/ai/quality-synthesis-score')
const { personalDataFrom, runComputations } = await import('../lib/oracle/runner/compute')
const { buildSynthesisPayload } = await import('../lib/oracle/runner/payload')
const { makeProfile } = await import('../lib/oracle/runner/__tests__/fakes')

const roster = resolveSingleSystemRoster('numerology', 3)
const readerBrands = roster.readers
console.log(`numerology N=3 readers: ${readerBrands.join(', ')}`)

const profile = makeProfile({
  birthDate: '1988-11-23',
  birthTime: '04:17:00',
  sex: 'F',
  tz: 'Asia/Seoul',
  nameLocal: '김민서',
  nameLatin: 'Minseo Kim',
})
const pii = personalDataFrom([profile])
const computed = runComputations({
  profile,
  systems: ['numerology'],
  seed: () => 'oracle-numerology-synth-bakeoff',
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
  personalData: pii,
})
const num = computed.systems.find((s) => s.system === 'numerology')
if (!num?.aiPayload) throw new Error('missing numerology payload')

type FrozenReading = {
  system: string
  brand: string
  narrative: string
  summary: Record<string, unknown>
}

const readings: FrozenReading[] = []
for (const brand of readerBrands) {
  const entry = {
    ...layer1EntryForBrand(brand)!,
    system: 'numerology' as keyof typeof LAYER1_REGISTRY,
  }
  const httpBudget = createLayer1HttpBudget(2)
  const raw = await callLayer1Model({
    entry,
    systemPrompt: buildLayer1SystemPrompt(LOCALE, 'numerology'),
    userPrompt: buildLayer1UserPrompt(num.aiPayload, LOCALE, 'numerology'),
    timeoutMs: 180_000,
    sessionId: `num-reader-${brand}`,
    httpBudget,
  })
  const parsed = parseLayer1Json(raw.text ?? '')
  if (!parsed) throw new Error(`reader ${brand} failed parse`)
  readings.push({
    system: 'numerology',
    brand,
    narrative: parsed.narrative,
    summary: {
      one_line: parsed.one_line,
      direction: parsed.direction,
      focus: parsed.focus,
      axis_emphasis: parsed.axis_emphasis,
    },
  })
  console.log(`reader ${brand} ok tokens=${raw.contentTokens}`)
}

const readingRows = readings.map((r, i) => ({
  id: `r${i}`,
  session_id: 'num-bakeoff',
  computation_id: `c${i}`,
  system: r.system,
  brand: r.brand,
  model: r.brand,
  narrative: r.narrative,
  summary: r.summary,
  status: 'done' as const,
  latency_ms: 0,
  tokens_in: 0,
  tokens_out: 0,
  created_at: new Date().toISOString(),
}))

const synthesisPayload = buildSynthesisPayload(readingRows, computed.consensus, pii)

type Row = {
  brand: string
  run: number
  agreements: string[]
  divergences: string[]
  conclusion: string
  confidence_note: string | null
  contentTokens: number | null
  ms: number
  costUsd: number | null
  parsed: boolean
  finishReason: string | null
  reasoningTokens: number | null
}

const rows: Row[] = []
for (const brand of BRANDS) {
  // Synth must not be a reader in the same session — skip the N=3 readers.
  if (readerBrands.includes(brand as (typeof readerBrands)[number])) {
    console.log(`skip ${brand} (reader on numerology N=3)`)
    continue
  }
  for (const run of [1, 2] as const) {
    const base = layer1EntryForBrand(brand)
    if (!base) throw new Error(`no entry for ${brand}`)
    const entry = {
      ...base,
      maxCompletionTokens: Math.max(base.maxCompletionTokens, SYNTHESIS_MAX_COMPLETION_TOKENS),
    }
    const started = Date.now()
    const raw = await callLayer1Model({
      entry,
      systemPrompt: buildSynthesisSystemPrompt(LOCALE),
      userPrompt: buildSynthesisUserPrompt(synthesisPayload),
      timeoutMs: 240_000,
      sessionId: `num-synth-${brand}-${run}`,
      httpBudget: createLayer1HttpBudget(2),
    })
    const parsed = parseSynthesisJson(raw.text ?? '')
    const row: Row = {
      brand,
      run,
      agreements: parsed?.agreements ?? [],
      divergences: parsed?.divergences ?? [],
      conclusion: parsed?.conclusion ?? '',
      confidence_note: parsed?.confidence_note ?? null,
      contentTokens: raw.contentTokens,
      ms: Date.now() - started,
      costUsd: raw.costUsd,
      parsed: parsed != null,
      finishReason: raw.finishReason,
      reasoningTokens: raw.reasoningTokens,
    }
    rows.push(row)
    console.log(
      `${brand} run${run} parsed=${row.parsed} finish=${row.finishReason} tokens=${row.contentTokens} reason=${row.reasoningTokens}`,
    )
  }
}

const narratives = readings.map((r) => r.narrative)
const panelId = 'single_numerology_n3'
const scores = [...new Set(rows.map((r) => r.brand))].map((brand) =>
  scoreSynthesisBrand(brand, panelId, rows.map((r) => ({ ...r, panel: panelId })), narratives),
)
const ranked = rankSynthesisBrands(scores)

const lines = [
  '# Numerology single-panel synthesis bakeoff (self_ip evidence)',
  '',
  `- Question: ${QUESTION}`,
  `- Readers (frozen): ${readerBrands.join(', ')}`,
  `- Candidate synthesizers: ${[...new Set(rows.map((r) => r.brand))].join(', ')}`,
  '',
  '| rank | brand | ground | platitude% | generic% | univ.conclusion | len | cost_usd | seat |',
  '| ---: | --- | ---: | ---: | ---: | --- | --- | ---: | --- |',
]
ranked.forEach((score, index) => {
  lines.push(
    `| ${index + 1} | ${score.brand} | ${score.groundingCount} | ${(score.platitudeShare * 100).toFixed(0)} | ${(score.genericShare * 100).toFixed(0)} | ${score.conclusionGeneric ? 'yes' : 'no'} | ${score.lengthChars[0]}/${score.lengthChars[1]} | ${score.costUsdTotal.toFixed(6)} | ${score.disqualified ? 'DQ' : 'ok'} |`,
  )
})
lines.push('')

writeFileSync(OUT_MD, lines.join('\n'))
writeFileSync(
  OUT_JSON,
  JSON.stringify({ readerBrands, readings, rows, ranked }, null, 2),
)
console.log(`wrote ${OUT_MD}`)
console.log('TOP non-DQ:', ranked.filter((s) => !s.disqualified).slice(0, 3))
