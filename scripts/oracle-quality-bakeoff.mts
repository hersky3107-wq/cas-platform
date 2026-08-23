/**
 * Oracle layer-1 quality bakeoff v3: four unmeasured/validation systems.
 * Brands: skip MiniMax, Mistral, Meta, NAVER (reader exclusions). Include Google for evidence.
 *
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/oracle-quality-bakeoff.mts
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { BakeoffRunRow, BrandScore } from '../lib/oracle/ai/quality-bakeoff-score'

process.env.ORACLE_AI_MODE = 'live'

/** Reader-candidate brands only — skipped MiniMax / Mistral / Meta / NAVER per roster exclusions. */
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

const SKIPPED_BRANDS = ['MiniMax', 'Mistral', 'Meta', 'NAVER'] as const

const SYSTEMS = ['ziwei', 'runes', 'astro', 'numerology'] as const
const LOCALE = 'ko'
const QUESTION = '올해 일의 방향을 어떻게 잡아야 하는가?'
const AS_OF_DATE = '2026-08-23'
const TIMEOUT_MS = 240_000
const OUT_PATH = join(process.cwd(), 'docs', 'oracle-quality-bakeoff-families.md')
const ROWS_JSON_PATH = join(process.cwd(), 'docs', 'oracle-quality-bakeoff-families-rows.json')

const { callLayer1Model } = await import('../lib/oracle/ai/call')
const { parseLayer1Json } = await import('../lib/oracle/ai/parse-layer1')
const { buildLayer1SystemPrompt, buildLayer1UserPrompt, LAYER1_PROMPT_VERSION } = await import(
  '../lib/oracle/ai/prompts/layer1'
)
const { LAYER1_REGISTRY } = await import('../lib/oracle/ai/registry')
const { createLayer1HttpBudget } = await import('../lib/oracle/ai/http-budget')
const { phaseHasTie, rankBrands, scoreBrand } = await import('../lib/oracle/ai/quality-bakeoff-score')
const { personalDataFrom, runComputations } = await import('../lib/oracle/runner/compute')
const { makeProfile } = await import('../lib/oracle/runner/__tests__/fakes')

function entryForBrand(brand: string) {
  const entry = Object.values(LAYER1_REGISTRY).find((row) => row.brand === brand)
  if (!entry) throw new Error(`no registry entry for brand ${brand}`)
  return entry
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function fmtUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return value.toFixed(6)
}

function formatTie(score: BrandScore): string {
  if (score.tieHandled == null) return 'n/a'
  return score.tieHandled ? 'reported' : 'missed'
}

function appendSystemSection(opts: {
  lines: string[]
  system: string
  sessionId: string
  payload: Record<string, unknown>
  rows: BakeoffRunRow[]
  scores: BrandScore[]
  ranked: BrandScore[]
  profile: { birth_date: string; birth_time: string | null; tz: string | null; sex: string | null }
}): void {
  const { lines, system, sessionId, payload, rows, scores, ranked, profile } = opts
  const tied = phaseHasTie(payload)
  const systemSpend = rows.reduce((s, r) => s + (r.costUsd ?? 0), 0)

  lines.push(`# Bakeoff — ${system}`, '')
  lines.push(`- **Prompt:** \`${LAYER1_PROMPT_VERSION}\``)
  lines.push(`- **Phase tie:** ${tied ? 'yes' : 'no'}`)
  lines.push(`- **Session:** \`${sessionId}\``)
  lines.push(`- **Profile:** ${profile.birth_date} ${profile.birth_time} (${profile.tz})`)
  lines.push(`- **System spend:** $${systemSpend.toFixed(6)}`)
  lines.push(`- **Skipped brands:** ${SKIPPED_BRANDS.join(', ')}`)
  lines.push('')
  lines.push('## Ranking', '')
  lines.push(
    '| rank | brand | fab | leak | grounding | generic % | tie | length | dir/focus | cost_usd | seat |',
  )
  lines.push('| ---: | --- | ---: | ---: | ---: | ---: | --- | --- | --- | ---: | --- |')
  ranked.forEach((score, index) => {
    lines.push(
      `| ${index + 1} | ${score.brand} | ${score.fabrications.length} | ${score.machineCodeLeaks.length} | ${score.groundingCount} | ${(score.genericShare * 100).toFixed(0)} | ${formatTie(score)} | ${score.lengthChars[0]}/${score.lengthChars[1]} | ${score.directionConsistent ? 'yes' : 'no'}/${score.focusConsistent ? 'yes' : 'no'} | ${score.costUsdTotal.toFixed(6)} | ${score.disqualified ? 'DQ' : 'ok'} |`,
    )
  })

  lines.push('', '## Per-brand scores', '')
  for (const score of scores) {
    lines.push(`### ${score.brand}`)
    lines.push(
      `- grounding=${score.groundingCount}; fab=${score.fabrications.join('; ') || 'none'}; leak=${score.machineCodeLeaks.join('; ') || 'none'}; generic=${(score.genericShare * 100).toFixed(0)}%; tie=${formatTie(score)}; len=${score.lengthChars[0]}/${score.lengthChars[1]}; cost=$${score.costUsdTotal.toFixed(6)}`,
    )
    lines.push('')
  }

  lines.push('## Raw outputs', '')
  lines.push(
    '| brand | run | narrative | one_line | direction | focus | content | ms | cost_usd |',
  )
  lines.push('| --- | ---: | --- | --- | --- | --- | ---: | ---: | ---: |')
  for (const row of rows) {
    lines.push(
      `| ${row.brand} | ${row.run} | ${escapeCell(row.narrative)} | ${escapeCell(row.one_line)} | ${row.direction ?? '—'} | ${row.focus ?? '—'} | ${row.contentTokens ?? '—'} | ${row.ms} | ${fmtUsd(row.costUsd)} |`,
    )
  }
  lines.push('', '## Payload', '', '```json', JSON.stringify(payload, null, 2), '```', '', '---', '')
}

async function runSystem(opts: {
  system: (typeof SYSTEMS)[number]
  profile: ReturnType<typeof makeProfile>
  personalData: ReturnType<typeof personalDataFrom>
}) {
  const { system, profile, personalData } = opts
  const computed = runComputations({
    profile,
    systems: [system],
    kind: 'personal',
    locale: LOCALE,
    question: QUESTION,
    asOfDate: AS_OF_DATE,
    seed: 'oracle-quality-bakeoff-v3-families',
    sessionInputs: {},
    personalData,
  })
  const row = computed.systems.find((entry) => entry.system === system)
  if (!row?.aiPayload) throw new Error(`${system} ai_payload missing`)
  const payload = { ...row.aiPayload }
  const systemPrompt = buildLayer1SystemPrompt(LOCALE, system)
  const userPrompt = buildLayer1UserPrompt(payload, LOCALE, system)
  const sessionId = randomUUID()
  console.log(`\n=== ${system} session=${sessionId} ===`)

  const rows: BakeoffRunRow[] = []
  for (const brand of BAKEOFF_BRANDS) {
    const entry = entryForBrand(brand)
    for (const run of [1, 2] as const) {
      console.log(`calling ${system} brand=${brand} run=${run}`)
      const httpBudget = createLayer1HttpBudget(2)
      const started = Date.now()
      try {
        const result = await callLayer1Model({
          entry,
          systemPrompt,
          userPrompt,
          timeoutMs: TIMEOUT_MS,
          sessionId,
          httpBudget,
        })
        const parsed = result.text ? parseLayer1Json(result.text) : null
        rows.push({
          brand,
          run,
          narrative: parsed?.narrative ?? result.text ?? '(empty)',
          one_line: parsed?.one_line ?? '',
          direction: parsed?.direction ?? null,
          focus: parsed?.focus ?? null,
          axis_emphasis: parsed?.axis_emphasis ?? [],
          contentTokens: result.contentTokens,
          ms: result.latencyMs,
          costUsd: result.costUsd,
          parsed: parsed != null,
        })
        console.log(
          `  parsed=${parsed != null} content=${result.contentTokens ?? '—'} thoughts=${result.reasoningTokens ?? '—'} finish=${result.finishReason ?? '—'} usd=${fmtUsd(result.costUsd)}`,
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        rows.push({
          brand,
          run,
          narrative: `(error: ${message})`,
          one_line: '',
          direction: null,
          focus: null,
          axis_emphasis: [],
          contentTokens: null,
          ms: Date.now() - started,
          costUsd: null,
          parsed: false,
        })
      }
    }
  }

  const scores = BAKEOFF_BRANDS.map((brand) => scoreBrand(brand, rows, payload))
  return {
    system,
    sessionId,
    payload,
    rows,
    scores,
    ranked: rankBrands(scores),
  }
}

async function main() {
  const profile = makeProfile({ user_id: 'oracle-quality-bakeoff-families' })
  const personalData = personalDataFrom([profile])
  const results = []
  for (const system of SYSTEMS) {
    results.push(await runSystem({ system, profile, personalData }))
  }

  const totalSpend = results.reduce(
    (sum, r) => sum + r.rows.reduce((s, row) => s + (row.costUsd ?? 0), 0),
    0,
  )

  const lines: string[] = [
    '# Oracle family bakeoff (ziwei / runes / astro / numerology)',
    '',
    `- Prompt: \`${LAYER1_PROMPT_VERSION}\``,
    `- Brands included: ${BAKEOFF_BRANDS.join(', ')}`,
    `- Brands skipped: ${SKIPPED_BRANDS.join(', ')}`,
    `- **Total spend (whole pass):** $${totalSpend.toFixed(6)}`,
    '',
    '---',
    '',
  ]
  for (const result of results) {
    appendSystemSection({ lines, ...result, profile })
  }

  writeFileSync(OUT_PATH, lines.join('\n'), 'utf8')
  writeFileSync(ROWS_JSON_PATH, JSON.stringify({ totalSpend, results }, null, 2), 'utf8')
  console.log(`\nWrote ${OUT_PATH} totalSpend=$${totalSpend.toFixed(6)}`)
  for (const result of results) {
    console.log(`\n${result.system}:`)
    for (const [i, s] of result.ranked.entries()) {
      console.log(
        `  ${i + 1}. ${s.brand} fab=${s.fabrications.length} leak=${s.machineCodeLeaks.length} g=${s.groundingCount} dq=${s.disqualified}`,
      )
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
