/**
 * Synthesis-role mechanical bakeoff.
 * Freezes reader narratives once (saju N=3 + integrated 12), then runs every
 * usable brand as synthesizer twice per panel.
 *
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/oracle-synthesis-bakeoff.mts
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

process.env.ORACLE_AI_MODE = 'live'

const BAKEOFF_BRANDS = [
  'Moonshot AI',
  'DeepSeek',
  'Z.ai',
  'OpenAI',
  'Google',
  'xAI',
  'NVIDIA',
  'Anthropic',
] as const

const LOCALE = 'ko'
const QUESTION = '올해 일의 방향을 어떻게 잡아야 하는가?'
const TIMEOUT_MS = 240_000
const OUT_MD = join(process.cwd(), 'docs', 'oracle-synthesis-bakeoff.md')
const OUT_JSON = join(process.cwd(), 'docs', 'oracle-synthesis-bakeoff-rows.json')
const OUT_INPUTS = join(process.cwd(), 'docs', 'oracle-synthesis-bakeoff-inputs.json')

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
const { ORACLE_FAMILY_ROSTERS, resolveSingleSystemRoster } = await import(
  '../lib/oracle/ai/family-roster'
)
const {
  rankSynthesisBrands,
  scoreSynthesisBrand,
} = await import('../lib/oracle/ai/quality-synthesis-score')
const { personalDataFrom, runComputations } = await import('../lib/oracle/runner/compute')
const { buildSynthesisPayload } = await import('../lib/oracle/runner/payload')
const { makeProfile } = await import('../lib/oracle/runner/__tests__/fakes')
const { readingScopeForSession } = await import('../lib/oracle/runner/conventions')

type SynthesisPanelId = 'single_saju_n3' | 'integrated_n3'
type OracleFamilyId = keyof typeof ORACLE_FAMILY_ROSTERS
type SynthesisBakeoffRun = {
  brand: string
  panel: SynthesisPanelId
  run: number
  agreements: string[]
  divergences: string[]
  conclusion: string
  confidence_note: string | null
  contentTokens: number | null
  ms: number
  costUsd: number | null
  parsed: boolean
}

type FrozenReading = {
  system: string
  brand: string
  narrative: string
  summary: Record<string, unknown>
}

type FrozenPanel = {
  id: SynthesisPanelId
  systems: string[]
  question: string
  consensus: unknown
  readings: FrozenReading[]
  synthesisPayload: Record<string, unknown>
}

function entryForBrand(brand: string) {
  const entry = layer1EntryForBrand(brand)
  if (!entry) throw new Error(`no registry entry for brand ${brand}`)
  return entry
}

async function runReader(system: string, brand: string, payload: Record<string, unknown>) {
  // Prefer the brand's live caller, but keep the system payload/prompts for the seat.
  const entry = {
    ...entryForBrand(brand),
    system: system as keyof typeof LAYER1_REGISTRY,
  }
  const httpBudget = createLayer1HttpBudget(2)
  const raw = await callLayer1Model({
    entry,
    systemPrompt: buildLayer1SystemPrompt(LOCALE, system),
    userPrompt: buildLayer1UserPrompt(payload, LOCALE, system),
    timeoutMs: TIMEOUT_MS,
    sessionId: randomUUID(),
    httpBudget,
  })
  const parsed = parseLayer1Json(raw.text ?? '')
  return {
    system,
    brand,
    narrative: parsed?.narrative ?? '',
    summary: parsed
      ? {
          one_line: parsed.one_line,
          direction: parsed.direction,
          focus: parsed.focus,
          axis_emphasis: parsed.axis_emphasis,
        }
      : { error: raw.error ?? 'parse failed' },
    contentTokens: raw.contentTokens,
    costUsd: raw.costUsd,
    parsed: parsed != null,
  }
}

async function freezePanels(): Promise<{ single: FrozenPanel; integrated: FrozenPanel }> {
  const profile = makeProfile({ user_id: 'oracle-synthesis-bakeoff' })
  const sessionInputs = {
    prism: {
      impulse: PRISM_COLORS[0],
      need: PRISM_COLORS[1],
      identity: PRISM_COLORS[2],
      microCheck: [3, 4, 2, 3] as const,
    },
  }
  const pii = personalDataFrom([profile])

  const singleSystems = ['saju'] as const
  const singleComputed = runComputations({
    profile,
    systems: [...singleSystems],
    seed: 'oracle-smoke-single-saju-N3',
    asOfDate: '2026-08-25',
    locale: LOCALE,
    kind: 'personal',
    question: QUESTION,
    sessionInputs,
    personalData: pii,
  })
  const singleRoster = resolveSingleSystemRoster('saju', 3)
  const singleReadings: FrozenReading[] = []
  for (const brand of singleRoster.readers) {
    const computation = singleComputed.systems.find((row) => row.system === 'saju')
    if (!computation?.aiPayload) throw new Error('saju payload missing')
    const row = await runReader('saju', brand, computation.aiPayload)
    console.log(`freeze single reader ${brand} parsed=${row.parsed} tokens=${row.contentTokens}`)
    singleReadings.push({
      system: 'saju',
      brand: row.brand,
      narrative: row.narrative,
      summary: row.summary,
    })
  }

  const allSystems = Object.keys(LAYER1_REGISTRY)
  const integratedComputed = runComputations({
    profile,
    systems: allSystems,
    seed: 'oracle-smoke-integrated-N3',
    asOfDate: '2026-08-25',
    locale: LOCALE,
    kind: 'personal',
    question: QUESTION,
    sessionInputs,
    personalData: pii,
  })
  const integratedReadings: FrozenReading[] = []
  for (const computation of integratedComputed.systems) {
    if (!computation.aiPayload) {
      console.log(`freeze integrated skip ${computation.system} (no payload)`)
      continue
    }
    const brand = LAYER1_REGISTRY[computation.system as keyof typeof LAYER1_REGISTRY].brand
    const row = await runReader(computation.system, brand, computation.aiPayload)
    console.log(
      `freeze integrated ${computation.system}/${brand} parsed=${row.parsed} tokens=${row.contentTokens}`,
    )
    integratedReadings.push({
      system: computation.system,
      brand: row.brand,
      narrative: row.narrative,
      summary: row.summary,
    })
  }

  const readingRows = (rows: FrozenReading[]) =>
    rows.map((row, index) => ({
      id: `reading-${index}`,
      session_id: 'frozen',
      computation_id: `computation-${index}`,
      system: row.system,
      brand: row.brand,
      model: 'frozen',
      narrative: row.narrative,
      summary: row.summary,
      status: 'done' as const,
      latency_ms: 0,
      tokens_in: 0,
      tokens_out: 0,
    }))

  const single: FrozenPanel = {
    id: 'single_saju_n3',
    systems: ['saju'],
    question: QUESTION,
    consensus: singleComputed.consensus,
    readings: singleReadings,
    synthesisPayload: buildSynthesisPayload(
      readingRows(singleReadings),
      singleComputed.consensus,
      pii,
    ),
  }
  const integrated: FrozenPanel = {
    id: 'integrated_n3',
    systems: allSystems,
    question: QUESTION,
    consensus: integratedComputed.consensus,
    readings: integratedReadings,
    synthesisPayload: buildSynthesisPayload(
      readingRows(integratedReadings),
      integratedComputed.consensus,
      pii,
    ),
  }

  // Touch readingScope so the import stays live for future payload shape checks.
  void readingScopeForSession('personal')

  writeFileSync(
    OUT_INPUTS,
    JSON.stringify(
      {
        question: QUESTION,
        single: {
          systems: single.systems,
          readings: single.readings,
          consensus: single.consensus,
          synthesisPayload: single.synthesisPayload,
        },
        integrated: {
          systems: integrated.systems,
          readings: integrated.readings,
          consensus: integrated.consensus,
          synthesisPayload: integrated.synthesisPayload,
        },
      },
      null,
      2,
    ),
  )
  return { single, integrated }
}

async function runSynthesis(
  brand: string,
  panel: FrozenPanel,
  run: number,
): Promise<SynthesisBakeoffRun> {
  const base = entryForBrand(brand)
  // Synthesis must not inherit prism's lowered 700 ceiling when brand=Anthropic.
  const entry = {
    ...base,
    maxCompletionTokens: Math.max(base.maxCompletionTokens, 1200),
  }
  const httpBudget = createLayer1HttpBudget(2)
  const started = Date.now()
  const raw = await callLayer1Model({
    entry,
    systemPrompt: buildSynthesisSystemPrompt(LOCALE),
    userPrompt: buildSynthesisUserPrompt(panel.synthesisPayload),
    timeoutMs: TIMEOUT_MS,
    sessionId: randomUUID(),
    httpBudget,
  })
  const parsed = parseSynthesisJson(raw.text ?? '')
  return {
    brand,
    panel: panel.id,
    run,
    agreements: parsed?.agreements ?? [],
    divergences: parsed?.divergences ?? [],
    conclusion: parsed?.conclusion ?? '',
    confidence_note: parsed?.confidence_note ?? null,
    contentTokens: raw.contentTokens,
    ms: Date.now() - started,
    costUsd: raw.costUsd,
    parsed: parsed != null,
  }
}

function familyForCurrentAssignment(brand: string): OracleFamilyId[] {
  return (Object.keys(ORACLE_FAMILY_ROSTERS) as OracleFamilyId[]).filter(
    (id) => ORACLE_FAMILY_ROSTERS[id].synthesizer === brand,
  )
}

const { single, integrated } = await freezePanels()
const panels = [single, integrated]
const rows: SynthesisBakeoffRun[] = []

for (const panel of panels) {
  for (const brand of BAKEOFF_BRANDS) {
    for (const run of [1, 2] as const) {
      const row = await runSynthesis(brand, panel, run)
      rows.push(row)
      console.log(
        `${panel.id} ${brand} run${run} parsed=${row.parsed} tokens=${row.contentTokens} usd=${row.costUsd} ms=${row.ms}`,
      )
    }
  }
}

const lines: string[] = [
  '# Oracle synthesis-role bakeoff',
  '',
  `- Question: ${QUESTION}`,
  `- Brands: ${BAKEOFF_BRANDS.join(', ')}`,
  `- Panels: single saju N=3 (${single.readings.length} readings), integrated N=3 (${integrated.readings.length} readings)`,
  `- Current family assignments: east_asian=OpenAI, draw_based=DeepSeek, western_chart=Google, self_ip=xAI; integrated=OpenAI`,
  '',
]

for (const panel of panels) {
  const narratives = panel.readings.map((r) => r.narrative).filter(Boolean)
  const scores = BAKEOFF_BRANDS.map((brand) =>
    scoreSynthesisBrand(brand, panel.id, rows, narratives),
  )
  const ranked = rankSynthesisBrands(scores)
  lines.push(`## Panel: ${panel.id}`, '')
  lines.push(
    `| rank | brand | ground | platitude% | generic% | univ.conclusion | len | cost_usd | seat |`,
  )
  lines.push(`| ---: | --- | ---: | ---: | ---: | --- | --- | ---: | --- |`)
  ranked.forEach((score, index) => {
    lines.push(
      `| ${index + 1} | ${score.brand} | ${score.groundingCount} | ${(score.platitudeShare * 100).toFixed(0)} | ${(score.genericShare * 100).toFixed(0)} | ${score.conclusionGeneric ? 'yes' : 'no'} | ${score.lengthChars[0]}/${score.lengthChars[1]} | ${score.costUsdTotal.toFixed(6)} | ${score.disqualified ? 'DQ' : 'ok'} |`,
    )
  })
  lines.push('')
  lines.push('### Survive check vs current assignment', '')
  for (const family of Object.keys(ORACLE_FAMILY_ROSTERS) as OracleFamilyId[]) {
    const assigned = ORACLE_FAMILY_ROSTERS[family].synthesizer
    const rank = ranked.findIndex((s) => s.brand === assigned) + 1
    const score = ranked.find((s) => s.brand === assigned)!
    const survives = !score.disqualified && rank <= 4
    lines.push(
      `- ${family}: assigned **${assigned}** rank=${rank} DQ=${score.disqualified} survives=${survives}`,
    )
  }
  lines.push('')
}

lines.push('## Raw conclusions', '')
for (const row of rows) {
  lines.push(
    `### ${row.panel} / ${row.brand} / run ${row.run}`,
    '',
    `- parsed=${row.parsed} tokens=${row.contentTokens} usd=${row.costUsd} ms=${row.ms}`,
    `- agreements: ${JSON.stringify(row.agreements)}`,
    `- divergences: ${JSON.stringify(row.divergences)}`,
    `- conclusion: ${row.conclusion}`,
    `- confidence_note: ${row.confidence_note}`,
    '',
  )
}

writeFileSync(OUT_MD, lines.join('\n'))
writeFileSync(OUT_JSON, JSON.stringify({ rows, single, integrated }, null, 2))
console.log(`wrote ${OUT_MD}`)
console.log(`wrote ${OUT_JSON}`)
console.log(`wrote ${OUT_INPUTS}`)
for (const brand of BAKEOFF_BRANDS) {
  const families = familyForCurrentAssignment(brand)
  if (families.length) console.log(`assignment ${brand} → ${families.join(',')}`)
}
process.exit(0)
