/**
 * Distribution simulation for the PRISM-5 engine.
 * Generates 100,000 synthetic users and writes docs/prism-distribution.md,
 * including a "Before / after" section against the recorded v1.1.0 run.
 *
 * Run: npx tsx scripts/simulate-prism.ts
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DOMAIN_NAMES, MBTI_TYPES, PRISM_COLORS, CYCLES } from '../lib/oracle/engines/prism/tables'
import { LOW_BAND_THRESHOLD, PRISM_ENGINE_VERSION } from '../lib/oracle/engines/prism/conventions'
import { domainStarRating, prism } from '../lib/oracle/engines/prism'
import type { DomainName } from '../lib/oracle/engines/prism/tables'
import type { DomainStar } from '../lib/oracle/engines/prism/conventions'

const N = 100_000
const AT_DATE = '2026-08-15'

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function mean(xs: number[]): number {
  return xs.reduce((sum, v) => sum + v, 0) / xs.length
}

function stddev(xs: number[]): number {
  const m = mean(xs)
  return Math.sqrt(xs.reduce((sum, v) => sum + (v - m) ** 2, 0) / (xs.length - 1))
}

function histogram(xs: number[], bucketSize = 10): number[] {
  // 10 buckets cover 0–100; bucket 9 also catches any value >= 100.
  const buckets = new Array(10).fill(0) as number[]
  for (const value of xs) {
    const idx = Math.min(9, Math.floor(value / bucketSize))
    buckets[idx]! += 1
  }
  return buckets
}

/** Bucket counts into the five domain-star spec bands: <30 / 30-44 / 45-59 / 60-79 / 80-100. */
function starBandCounts(xs: number[]): [number, number, number, number, number] {
  const counts: [number, number, number, number, number] = [0, 0, 0, 0, 0]
  for (const value of xs) {
    counts[domainStarRating(value) - 1] += 1
  }
  return counts
}

function pct(n: number, total = N): string {
  return `${((n / total) * 100).toFixed(2)}%`
}

function bar(count: number, total: number, width = 24): string {
  const filled = Math.round((count / total) * width)
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled))
}

const rng = mulberry32(0x50524953)
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!

const domains: Record<DomainName, number[]> = { work: [], money: [], love: [], social: [], energy: [] }
const domainStarCounts: Record<DomainName, [number, number, number, number, number]> = {
  work: [0, 0, 0, 0, 0],
  money: [0, 0, 0, 0, 0],
  love: [0, 0, 0, 0, 0],
  social: [0, 0, 0, 0, 0],
  energy: [0, 0, 0, 0, 0],
}
const domainPeakCounts: Record<DomainName, number> = { work: 0, money: 0, love: 0, social: 0, energy: 0 }
const shadow: number[] = []
const concordanceValues: number[] = []
const cycleCounts = new Array(12).fill(0) as number[]
const withinUserRanges: number[] = []
let atLeastOne5Star = 0
let atLeastOne2OrBelow = 0
const headlineStarPairs: Record<string, number> = {}

const t0 = Date.now()
for (let i = 0; i < N; i++) {
  const year = 1950 + Math.floor(rng() * 61)
  const month = 1 + Math.floor(rng() * 12)
  const day = 1 + Math.floor(rng() * 28)
  const chosen = new Set<string>()
  while (chosen.size < 3) chosen.add(pick(PRISM_COLORS))
  const [impulse, need, identity] = [...chosen] as [
    (typeof PRISM_COLORS)[number],
    (typeof PRISM_COLORS)[number],
    (typeof PRISM_COLORS)[number],
  ]

  const result = prism({
    birthDate: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    mbti: pick(MBTI_TYPES),
    colors: { impulse, need, identity },
    microCheck: [
      1 + Math.floor(rng() * 5),
      1 + Math.floor(rng() * 5),
      1 + Math.floor(rng() * 5),
      1 + Math.floor(rng() * 5),
    ],
    atDate: AT_DATE,
  })

  const scores = Object.values(result.domainScores)
  const minScore = Math.min(...scores)
  const maxScore = Math.max(...scores)
  const range = maxScore - minScore
  withinUserRanges.push(range)

  if (scores.some((score) => domainStarRating(score) === 5)) atLeastOne5Star += 1
  if (scores.some((score) => domainStarRating(score) <= 2)) atLeastOne2OrBelow += 1

  const headlineStar = result.domainStars[result.headlineDomain].star
  const pairKey = `${result.headlineDomain}:${headlineStar}`
  headlineStarPairs[pairKey] = (headlineStarPairs[pairKey] ?? 0) + 1

  for (const domain of DOMAIN_NAMES) {
    domains[domain].push(result.domainScores[domain])
    const star: DomainStar = result.domainStars[domain].star
    domainStarCounts[domain][star - 1] += 1
    if (result.domainStars[domain].peak) domainPeakCounts[domain] += 1
  }
  shadow.push(result.shadowPressure)
  concordanceValues.push(result.concordance)
  cycleCounts[result.annualCycle.id]! += 1
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
const expectedCycle = N / 12
const cycleShares = cycleCounts.map((c) => c / N)
const cycleMin = Math.min(...cycleShares)
const cycleMax = Math.max(...cycleShares)
const cycleUniform = cycleMin >= 0.065 && cycleMax <= 0.1

const rangeBuckets = histogram(withinUserRanges, 5)
const rangeMean = mean(withinUserRanges)
const rangeSd = stddev(withinUserRanges)
const flatReading = (withinUserRanges.filter((r) => r < 15).length / N) * 100
const headlineStarPairEntries = Object.entries(headlineStarPairs).sort((a, b) => b[1] - a[1])
const mostCommonHeadlinePair = headlineStarPairEntries[0] ?? ['none', 0]

function histBlock(title: string, xs: number[], opts?: { lowBand?: boolean }): string {
  const buckets = histogram(xs)
  const lines = buckets.map((count, i) => {
    const lo = i * 10
    const hi = i === 9 ? 100 : i * 10 + 9
    return `| ${String(lo).padStart(3)}–${String(hi).padStart(3)} | ${String(count).padStart(6)} | ${pct(count).padStart(7)} | ${bar(count, N)} |`
  })
  const extras = [`- mean: **${mean(xs).toFixed(2)}**`, `- standard deviation: **${stddev(xs).toFixed(2)}**`]
  if (opts?.lowBand) {
    extras.push(
      `- 저조/주의 (score < ${LOW_BAND_THRESHOLD}): **${pct(xs.filter((v) => v < LOW_BAND_THRESHOLD).length)}**`,
    )
  }
  return ['### ' + title, '', '| Bucket | Count | Share | |', '| --- | ---: | ---: | --- |', ...lines, '', ...extras, ''].join(
    '\n',
  )
}

function starBlock(title: string, counts: [number, number, number, number, number], peakCount?: number): string {
  const lines = [1, 2, 3, 4, 5].map((star, i) => {
    const count = counts[i]!
    return `| ${star}★ | ${String(count).padStart(6)} | ${pct(count).padStart(7)} | ${bar(count, N)} |`
  })
  const extras = peakCount !== undefined ? [`- PEAK (≥90): **${pct(peakCount)}**`, ''] : ['']
  return [`### ${title}`, '', '| Stars | Count | Share | |', '| --- | ---: | ---: | --- |', ...lines, '', ...extras].join(
    '\n',
  )
}

// --- Recorded v1.1.0 run (pre-v1.2.0 constants) ---
const BEFORE = {
  domains: {
    work: { mean: 62.29, sd: 10.37, low45: 3.18 },
    money: { mean: 60.23, sd: 8.88, low45: 1.25 },
    love: { mean: 58.66, sd: 10.58, low45: 7.76 },
    social: { mean: 60.42, sd: 10.18, low45: 3.14 },
    energy: { mean: 59.58, sd: 11.21, low45: 9.79 },
  } as Record<DomainName, { mean: number; sd: number; low45: number }>,
  shadow: {
    mean: 43.61,
    sd: 16.7,
    above50: 35.47,
    above70: 6.19,
    bandShares: [22.4, 31.04, 29.43, 15.71, 1.42] as [number, number, number, number, number],
  },
  concordance: { mean: 63.01, sd: 24.21 },
  // Within-user spread was not recorded in the v1.1.0 report; mark as N/A.
  withinUserSpread: { mean: null as number | null, sd: null as number | null, flatReading: null as number | null },
}

const afterDomainStats = Object.fromEntries(
  DOMAIN_NAMES.map((domain) => [
    domain,
    {
      mean: mean(domains[domain]),
      sd: stddev(domains[domain]),
      low45: (domains[domain].filter((v) => v < LOW_BAND_THRESHOLD).length / N) * 100,
    },
  ]),
) as Record<DomainName, { mean: number; sd: number; low45: number }>

const afterShadowBands = starBandCounts(shadow).map((c) => (c / N) * 100) as [number, number, number, number, number]
const afterShadowMean = mean(shadow)
const afterShadowSd = stddev(shadow)
const afterConcordanceMean = mean(concordanceValues)
const afterConcordanceSd = stddev(concordanceValues)
const shadowAbove50 = (shadow.filter((v) => v > 50).length / N) * 100
const shadowAbove70 = (shadow.filter((v) => v > 70).length / N) * 100
const bandLabels = ['<30 (1★)', '30–44 (2★)', '45–59 (3★)', '60–79 (4★)', '80–100 (5★)']

function beforeAfterDomainTable(): string[] {
  const rows = DOMAIN_NAMES.map((domain) => {
    const b = BEFORE.domains[domain]
    const a = afterDomainStats[domain]
    return `| ${domain} | ${b.mean.toFixed(2)} → **${a.mean.toFixed(2)}** | ${b.sd.toFixed(2)} → **${a.sd.toFixed(2)}** | ${b.low45.toFixed(2)}% → **${a.low45.toFixed(2)}%** |`
  })
  return ['| Domain | Mean (before → after) | SD (before → after) | <45% (before → after) |', '| --- | --- | --- | --- |', ...rows]
}

function beforeAfterShadowBandTable(): string[] {
  return [
    '| Band | Before | After |',
    '| --- | ---: | ---: |',
    ...bandLabels.map(
      (label, i) => `| ${label} | ${BEFORE.shadow.bandShares[i]!.toFixed(2)}% | ${afterShadowBands[i]!.toFixed(2)}% |`,
    ),
  ]
}

function rangeBlock(): string[] {
  const lines = rangeBuckets.map((count, i) => {
    const lo = i * 5
    const hi = i * 5 + 4
    return `| ${String(lo).padStart(3)}–${String(hi).padStart(3)} | ${String(count).padStart(6)} | ${pct(count).padStart(7)} | ${bar(count, N)} |`
  })
  return [
    '## Within-user spread',
    '',
    'For each simulated user: `range = max(domain score) - min(domain score)`.',
    '',
    '| Range | Count | Share | |',
    '| --- | ---: | ---: | --- |',
    ...lines,
    '',
    `- mean: **${rangeMean.toFixed(2)}**`,
    `- standard deviation: **${rangeSd.toFixed(2)}**`,
    `- "flat reading" (range < 15): **${flatReading.toFixed(2)}%** (target < 15%)`,
    `- at least one 5★: **${pct(atLeastOne5Star)}** (target 25–35%)`,
    `- at least one 2★ or below: **${pct(atLeastOne2OrBelow)}** (target 25–35%)`,
    `- most common (headlineDomain, star) pair: **${mostCommonHeadlinePair[0]}** (${pct(mostCommonHeadlinePair[1])})`,
    '',
  ]
}

const lines: string[] = [
  '# PRISM-5 distribution',
  '',
  `Synthetic N = ${N.toLocaleString()} users. Birth dates uniform over 1950-01-01…2010-12-28 (day clamped to 1–28).`,
  `MBTI, three distinct colors, and microCheck drawn uniformly. \`atDate\` fixed at **${AT_DATE}** (Asia/Seoul noon).`,
  '',
  `Engine version: **${PRISM_ENGINE_VERSION}**. Elapsed: ${elapsed}s.`,
  '',
  '## Before / after (v1.1.0 → v1.2.0 tuning pass)',
  '',
  '### Per-domain mean / SD / <45%',
  '',
  ...beforeAfterDomainTable(),
  '',
  '### shadowPressure across the five spec bands',
  '',
  ...beforeAfterShadowBandTable(),
  '',
  `- % of users with shadowPressure > 50: ${BEFORE.shadow.above50.toFixed(2)}% → **${shadowAbove50.toFixed(2)}%** (target 10–25%)`,
  `- % of users with shadowPressure > 70: ${BEFORE.shadow.above70.toFixed(2)}% → **${shadowAbove70.toFixed(2)}%** (target: small but nonzero)`,
  `- shadowPressure mean: ${BEFORE.shadow.mean.toFixed(2)} → **${afterShadowMean.toFixed(2)}**`,
  `- shadowPressure SD: ${BEFORE.shadow.sd.toFixed(2)} → **${afterShadowSd.toFixed(2)}**`,
  '',
  '### concordance mean / SD',
  '',
  `- mean: ${BEFORE.concordance.mean.toFixed(2)} → **${afterConcordanceMean.toFixed(2)}**`,
  `- SD: ${BEFORE.concordance.sd.toFixed(2)} → **${afterConcordanceSd.toFixed(2)}**`,
  '',
  '### Star distribution',
  '',
  'v1.1.0 introduced per-domain stars; v1.2.0 (with stretched cycle bases) increases the spread so',
  '1★ and 5★ per-domain outcomes are more common across the user base. There is no overall averaged star —',
  'only `headlineDomain`. Per-domain star distributions are in `## Domain scores`.',
  '',
  '### Within-user spread (new in v1.2.0)',
  '',
  'This metric was not recorded in the v1.1.0 report.',
  '',
  `- mean range (v1.2.0): **${rangeMean.toFixed(2)}** (target 25–35)`,
  `- flat reading (range < 15): **${flatReading.toFixed(2)}%** (target < 15%)`,
  `- at least one 5★: **${pct(atLeastOne5Star)}** (target 25–35%)`,
  `- at least one 2★ or below: **${pct(atLeastOne2OrBelow)}** (target 25–35%)`,
  '',
  ...rangeBlock(),
  '## Domain scores',
  '',
  ...DOMAIN_NAMES.flatMap((domain) => [
    ...histBlock(domain, domains[domain], { lowBand: true }).split('\n'),
    ...starBlock(`${domain} — stars`, domainStarCounts[domain], domainPeakCounts[domain]).split('\n'),
    '',
  ]),
  '## shadowPressure and concordance',
  '',
  histBlock('shadowPressure', shadow),
  histBlock('concordance', concordanceValues),
  '## Annual Cycle frequency',
  '',
  'Annual cycle = `ageYears % 12`, rolling on the birthday. Expected share if uniform: **8.33%**.',
  '',
  '| Cycle | Name | Count | Share | |',
  '| --- | --- | ---: | ---: | --- |',
  ...CYCLES.map((cycle, i) => {
    const count = cycleCounts[i]!
    return `| ${cycle.id} | ${cycle.name} | ${count} | ${pct(count)} | ${bar(count, N)} |`
  }),
  '',
  `- min share: **${(cycleMin * 100).toFixed(2)}%**`,
  `- max share: **${(cycleMax * 100).toFixed(2)}%**`,
  `- expected count: **${expectedCycle.toFixed(1)}**`,
  cycleUniform
    ? '- **Uniformity: OK** — every cycle landed inside 6.5–10%.'
    : '- **Uniformity: FLAG** — at least one cycle is outside 6.5–10%. Not tuned; this is the raw birthday-age modulo.',
  '',
  '## Notes',
  '',
  '- Impulse / Need colors do not enter `coreMatrix`; they still move conflict, shadow, mind-body, and color-state domain deltas.',
  '- `currentConflict` is rescaled against the exact empirical min/max RMS distance over all 276 color pairs (`COLOR_CONFLICT_BOUNDS`).',
  '- `concordance` is Pearson correlation (shape similarity) between the identity projection and coreMatrix, not absolute distance.',
  '- v1.2.0 FIX 4: Cycle base scores uniformly stretched with `clamp(60 + (old - 60) * 1.45, 20, 95)` to give each cycle a distinct signature.',
  '- v1.2.0 FIX 5: Money color-state modifiers scaled by 1.4 before the ±13 clamp to widen its narrow SD.',
  '- v1.2.0 FIX 6: New within-user spread metrics (`range`, flat reading, 5★/2★ reach, most common headline pair).',
  '- MBTI cycle affinity is an intentional override of the original "MBTI must not move scores" rule.',
  '- No further constants were changed after this run — numbers are reported as-is per the tuning brief.',
  '',
]

const outPath = resolve(process.cwd(), 'docs/prism-distribution.md')
writeFileSync(outPath, lines.join('\n'), 'utf8')
console.log(`wrote ${outPath}`)
console.log(`cycles uniform=${cycleUniform} min=${(cycleMin * 100).toFixed(2)}% max=${(cycleMax * 100).toFixed(2)}%`)
console.log(`shadowPressure >50: ${shadowAbove50.toFixed(2)}%, >70: ${shadowAbove70.toFixed(2)}%`)
console.log(
  `within-user range mean=${rangeMean.toFixed(2)} sd=${rangeSd.toFixed(2)} flat=${flatReading.toFixed(2)}% ` +
    `5star=${pct(atLeastOne5Star)} 2orBelow=${pct(atLeastOne2OrBelow)} ` +
    `mostCommonHeadline=${mostCommonHeadlinePair[0]}`,
)
