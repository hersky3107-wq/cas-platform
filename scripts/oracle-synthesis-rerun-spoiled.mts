/**
 * Clean re-run of DeepSeek + Anthropic synthesis only (spoiled in the prior bakeoff).
 * Reuses frozen inputs from docs/oracle-synthesis-bakeoff-inputs.json.
 *
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/oracle-synthesis-rerun-spoiled.mts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

process.env.ORACLE_AI_MODE = 'live'

const BRANDS = ['DeepSeek', 'Anthropic'] as const
const PANELS = ['single_saju_n3', 'integrated_n3'] as const
const LOCALE = 'ko'
const TIMEOUT_MS = 240_000
const INPUTS = join(process.cwd(), 'docs', 'oracle-synthesis-bakeoff-inputs.json')
const OUT = join(process.cwd(), 'docs', 'oracle-synthesis-rerun-spoiled.json')

const { callLayer1Model } = await import('../lib/oracle/ai/call')
const { createLayer1HttpBudget } = await import('../lib/oracle/ai/http-budget')
const { parseSynthesisJson } = await import('../lib/oracle/ai/parse-synthesis')
const { buildSynthesisSystemPrompt, buildSynthesisUserPrompt } = await import(
  '../lib/oracle/ai/prompts/synthesis'
)
const { layer1EntryForBrand } = await import('../lib/oracle/ai/registry')
const { SYNTHESIS_MAX_COMPLETION_TOKENS } = await import('../lib/oracle/ai/layer1-adapter')
const { rankSynthesisBrands, scoreSynthesisBrand } = await import(
  '../lib/oracle/ai/quality-synthesis-score'
)

type SynthesisBakeoffRun = {
  brand: string
  panel: 'single_saju_n3' | 'integrated_n3'
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

const frozen = JSON.parse(readFileSync(INPUTS, 'utf8')) as {
  single: { readings: Array<{ narrative: string }>; synthesisPayload: Record<string, unknown> }
  integrated: { readings: Array<{ narrative: string }>; synthesisPayload: Record<string, unknown> }
}

const panelPayload: Record<(typeof PANELS)[number], Record<string, unknown>> = {
  single_saju_n3: frozen.single.synthesisPayload,
  integrated_n3: frozen.integrated.synthesisPayload,
}
const panelNarratives: Record<(typeof PANELS)[number], string[]> = {
  single_saju_n3: frozen.single.readings.map((r) => r.narrative).filter(Boolean),
  integrated_n3: frozen.integrated.readings.map((r) => r.narrative).filter(Boolean),
}

const rows: SynthesisBakeoffRun[] = []

for (const panel of PANELS) {
  for (const brand of BRANDS) {
    for (const run of [1, 2] as const) {
      const base = layer1EntryForBrand(brand)
      if (!base) throw new Error(`missing brand ${brand}`)
      const entry = {
        ...base,
        maxCompletionTokens: Math.max(base.maxCompletionTokens, SYNTHESIS_MAX_COMPLETION_TOKENS),
      }
      const httpBudget = createLayer1HttpBudget(2)
      const started = Date.now()
      const raw = await callLayer1Model({
        entry,
        systemPrompt: buildSynthesisSystemPrompt(LOCALE),
        userPrompt: buildSynthesisUserPrompt(panelPayload[panel]),
        timeoutMs: TIMEOUT_MS,
        sessionId: randomUUID(),
        httpBudget,
      })
      const parsed = parseSynthesisJson(raw.text ?? '')
      const row: SynthesisBakeoffRun = {
        brand,
        panel,
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
      rows.push(row)
      console.log(
        `${panel} ${brand} run${run} parsed=${row.parsed} tokens=${row.contentTokens} usd=${row.costUsd} ms=${row.ms}`,
      )
      if (row.parsed) console.log(`  conclusion=${row.conclusion.slice(0, 120)}…`)
    }
  }
}

const scores = []
for (const panel of PANELS) {
  for (const brand of BRANDS) {
    scores.push(scoreSynthesisBrand(brand, panel, rows, panelNarratives[panel]))
  }
  console.log(`\n=== ${panel} rerank (spoiled brands only) ===`)
  for (const score of rankSynthesisBrands(scores.filter((s) => s.panel === panel))) {
    console.log(
      `${score.brand}: DQ=${score.disqualified} univ=${score.conclusionGeneric} ground=${score.groundingCount} plat=${(score.platitudeShare * 100).toFixed(0)}% gen=${(score.genericShare * 100).toFixed(0)}% usd=${score.costUsdTotal.toFixed(6)}`,
    )
  }
}

writeFileSync(OUT, JSON.stringify({ rows, scores }, null, 2))
console.log(`wrote ${OUT}`)
process.exit(0)
