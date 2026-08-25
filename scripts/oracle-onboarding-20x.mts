/**
 * Sequential 20× onboarding gate for every brand holding a reader or synth seat.
 * Readers first; integrated-only brands (Meta/MiniMax/Mistral/NAVER/OpenAI/Qwen)
 * run after unless --readers-only.
 *
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/oracle-onboarding-20x.mts
 *   npx tsx ... scripts/oracle-onboarding-20x.mts --readers-only
 *   npx tsx ... scripts/oracle-onboarding-20x.mts --integrated-only
 *   npx tsx ... scripts/oracle-onboarding-20x.mts --brands=DeepSeek,NVIDIA --workload=synthesis --out=docs/oracle-onboarding-20x-fix.json
 */
process.env.ORACLE_AI_MODE = 'live'

import { writeFileSync, appendFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const RUNS = 20
const LOCALE = 'ko'
const QUESTION = '올해 일의 방향을 어떻게 잡아야 하는가?'
const OUT_MD = join(process.cwd(), 'docs', 'oracle-onboarding-20x.md')
const OUT_JSON = join(process.cwd(), 'docs', 'oracle-onboarding-20x.json')
const OUT_LOG = join(process.cwd(), 'docs', 'oracle-onboarding-20x-run.log')

type Workload = 'reading' | 'synthesis'

const rawArgs = process.argv.slice(2)
const args = new Set(rawArgs)
const readersOnly = args.has('--readers-only')
const integratedOnly = args.has('--integrated-only')
const brandsFlag = rawArgs.find((a) => a.startsWith('--brands='))?.slice('--brands='.length)
const workloadFlag = rawArgs.find((a) => a.startsWith('--workload='))?.slice('--workload='.length) as
  | Workload
  | undefined
const outFlag = rawArgs.find((a) => a.startsWith('--out='))?.slice('--out='.length)

/** Brands on single-mode reader or synthesizer seats (family roster). */
const READER_SYNTH_BRANDS = [
  'Z.ai',
  'Moonshot AI',
  'xAI',
  'DeepSeek',
  'NVIDIA',
  'Google',
  'Anthropic',
] as const

/** LAYER1 dedicated brands that are not in the single-mode family pool. */
const INTEGRATED_ONLY_BRANDS = [
  'Meta',
  'MiniMax',
  'Mistral',
  'NAVER',
  'OpenAI',
  'Cohere',
] as const

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
const {
  ORACLE_FAMILY_ROSTERS,
  INTEGRATED_SYNTHESIZER_BRAND,
  resolveSingleSystemRoster,
} = await import('../lib/oracle/ai/family-roster')
const {
  SYNTHESIS_MAX_COMPLETION_TOKENS,
  SYNTHESIS_STRICT_RETRY_INSTRUCTION,
  LAYER1_STRICT_RETRY_INSTRUCTION,
} = await import('../lib/oracle/ai/layer1-adapter')
const { personalDataFrom, runComputations } = await import('../lib/oracle/runner/compute')
const { buildSynthesisPayload } = await import('../lib/oracle/runner/payload')
const { makeProfile } = await import('../lib/oracle/runner/__tests__/fakes')
const { readFileSync } = await import('node:fs')

function log(line: string) {
  console.log(line)
  appendFileSync(OUT_LOG, `${line}\n`)
}

writeFileSync(OUT_LOG, '')

type BrandPlan = { brand: string; workload: Workload; homeSystem: string }

function plansFor(brands: readonly string[]): BrandPlan[] {
  const synthBrands = new Set([
    ...Object.values(ORACLE_FAMILY_ROSTERS).map((f) => f.synthesizer),
    INTEGRATED_SYNTHESIZER_BRAND,
  ])
  return brands.map((brand) => {
    if (workloadFlag === 'synthesis' || (workloadFlag !== 'reading' && synthBrands.has(brand as never))) {
      const home =
        Object.values(LAYER1_REGISTRY).find((e) => e.brand === brand)?.system ??
        (brand === 'Z.ai' ? 'iching' : 'saju')
      return { brand, workload: 'synthesis' as const, homeSystem: home }
    }
    // Reader seat → home-system reading prompt.
    const home =
      Object.values(LAYER1_REGISTRY).find((e) => e.brand === brand)?.system ??
      resolveSingleSystemRoster('saju', 3).system
    return { brand, workload: 'reading' as const, homeSystem: home }
  })
}

const profile = makeProfile({
  birthDate: '1988-11-23',
  birthTime: '04:17:00',
  sex: 'F',
  tz: 'Asia/Seoul',
  nameLocal: '김민서',
  nameLatin: 'Minseo Kim',
})

const systems = [
  ...new Set([
    ...Object.values(LAYER1_REGISTRY).map((e) => e.system),
    'saju',
    'numerology',
    'prism',
  ]),
] as Array<keyof typeof LAYER1_REGISTRY>

const computed = runComputations({
  profile,
  systems,
  seed: () => 'oracle-onboarding-20x',
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

const bakeoffInputs = JSON.parse(
  readFileSync(join(process.cwd(), 'docs', 'oracle-synthesis-bakeoff-inputs.json'), 'utf8'),
)

type RunRow = {
  brand: string
  workload: Workload
  homeSystem: string
  run: number
  parsed: boolean
  finishReason: string | null
  contentTokens: number | null
  reasoningTokens: number | null
  textChars: number
  error: string | null
}

const results: RunRow[] = []

async function runBrand(plan: BrandPlan) {
  const entryBase = layer1EntryForBrand(plan.brand)
  if (!entryBase) throw new Error(`no registry entry for ${plan.brand}`)

  for (let run = 1; run <= RUNS; run += 1) {
    const entry =
      plan.workload === 'synthesis'
        ? {
            ...entryBase,
            system: plan.homeSystem as keyof typeof LAYER1_REGISTRY,
            maxCompletionTokens: Math.max(
              entryBase.maxCompletionTokens,
              SYNTHESIS_MAX_COMPLETION_TOKENS,
            ),
          }
        : {
            ...entryBase,
            system: plan.homeSystem as keyof typeof LAYER1_REGISTRY,
          }

    const systemPrompt =
      plan.workload === 'synthesis'
        ? buildSynthesisSystemPrompt(LOCALE)
        : buildLayer1SystemPrompt(LOCALE, plan.homeSystem)
    const userPrompt =
      plan.workload === 'synthesis'
        ? buildSynthesisUserPrompt(bakeoffInputs.single.synthesisPayload)
        : buildLayer1UserPrompt(
            computed.systems.find((s) => s.system === plan.homeSystem)?.aiPayload ?? {},
            LOCALE,
            plan.homeSystem,
          )

    const parse = (text: string | null) =>
      plan.workload === 'synthesis'
        ? parseSynthesisJson(text ?? '') != null
        : parseLayer1Json(text ?? '') != null

    let raw = await callLayer1Model({
      entry,
      systemPrompt,
      userPrompt,
      timeoutMs: 240_000,
      sessionId: `onboard-${plan.brand}-${run}`,
      httpBudget: createLayer1HttpBudget(2),
    })
    let parsed = parse(raw.text)
    // Same one strict retry the live adapter uses after a parse reject.
    if (!parsed) {
      raw = await callLayer1Model({
        entry,
        systemPrompt,
        userPrompt: `${userPrompt}${
          plan.workload === 'synthesis'
            ? SYNTHESIS_STRICT_RETRY_INSTRUCTION
            : LAYER1_STRICT_RETRY_INSTRUCTION
        }`,
        timeoutMs: 240_000,
        sessionId: `onboard-${plan.brand}-${run}-retry`,
        httpBudget: createLayer1HttpBudget(2),
        strictRetry: true,
      })
      parsed = parse(raw.text)
    }
    const row: RunRow = {
      brand: plan.brand,
      workload: plan.workload,
      homeSystem: plan.homeSystem,
      run,
      parsed,
      finishReason: raw.finishReason,
      contentTokens: raw.contentTokens,
      reasoningTokens: raw.reasoningTokens,
      textChars: (raw.text ?? '').length,
      error: raw.error ?? null,
    }
    results.push(row)
    log(
      `${plan.brand} ${plan.workload} ${run}/${RUNS} parsed=${parsed} finish=${raw.finishReason} tokens=${raw.contentTokens} reason=${raw.reasoningTokens}`,
    )
  }
}

const brandList = brandsFlag
  ? brandsFlag.split(',').map((b) => b.trim()).filter(Boolean)
  : integratedOnly
    ? INTEGRATED_ONLY_BRANDS
    : readersOnly
      ? READER_SYNTH_BRANDS
      : [...READER_SYNTH_BRANDS, ...INTEGRATED_ONLY_BRANDS]

const outMd = outFlag ? outFlag.replace(/\.json$/, '.md') : OUT_MD
const outJson = outFlag ?? OUT_JSON

const plans = plansFor(brandList)
log(
  `starting sequential 20× for ${plans.length} brands (readersOnly=${readersOnly} integratedOnly=${integratedOnly} workload=${workloadFlag ?? 'auto'})`,
)

for (const plan of plans) {
  await runBrand(plan)
}

const summary = [...new Set(results.map((r) => r.brand))].map((brand) => {
  const brandRows = results.filter((r) => r.brand === brand)
  const ok = brandRows.filter((r) => r.parsed).length
  return {
    brand,
    workload: brandRows[0]!.workload,
    homeSystem: brandRows[0]!.homeSystem,
    parsed: `${ok}/${brandRows.length}`,
    ok,
    total: brandRows.length,
    pass: ok >= 19,
  }
})

const lines = [
  '# Oracle onboarding 20× (sequential)',
  '',
  `- Gate: ≥19/20 parse success`,
  `- Mode: ${readersOnly ? 'readers/synths only' : integratedOnly ? 'integrated-only' : 'all'}`,
  '',
  '| brand | workload | home | parsed | pass |',
  '| --- | --- | --- | ---: | --- |',
]
for (const row of summary) {
  lines.push(
    `| ${row.brand} | ${row.workload} | ${row.homeSystem} | ${row.parsed} | ${row.pass ? 'yes' : 'NO'} |`,
  )
}
lines.push('')
const failed = summary.filter((s) => !s.pass)
lines.push('## Below 19/20')
lines.push('')
if (failed.length === 0) lines.push('- (none)')
else for (const f of failed) lines.push(`- **${f.brand}**: ${f.parsed}`)
lines.push('')

writeFileSync(outMd, lines.join('\n'))
writeFileSync(outJson, JSON.stringify({ summary, results }, null, 2))
log(`wrote ${outMd}`)
log(`FAILED brands: ${failed.map((f) => `${f.brand} ${f.parsed}`).join(', ') || '(none)'}`)
