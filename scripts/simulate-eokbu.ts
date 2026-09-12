/**
 * Distribution of 억부 판정불가 / 신강 / 중화 / 신약 on synthetic 사주 charts.
 *
 * Generates 20,000 subjects with the same date/time/tz pattern as
 * scripts/simulate-consensus.ts, runs fourPillars + eokbu, and writes
 * docs/oracle-eokbu-distribution.md.
 *
 * Run: npx tsx scripts/simulate-eokbu.ts
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { eokbu, fourPillars } from '../lib/oracle/engines/calendar'
import { EOKBU_JONGGYEOK, EOKBU_THRESHOLD } from '../lib/oracle/engines/calendar/eokbu'
import type { EokbuStrength } from '../lib/oracle/engines/calendar/types'

const N_SUBJECTS = 20_000
const TIMEZONES = ['Asia/Seoul', 'Asia/Tokyo', 'America/New_York'] as const

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

function daysInMonth(y: number, m: number): number {
  const days = [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return days[m - 1]!
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

type Bucket = EokbuStrength | 'inapplicable' | 'error'

const counts: Record<Bucket, number> = {
  weak: 0,
  balanced: 0,
  strong: 0,
  inapplicable: 0,
  error: 0,
}
let hourUnknown = 0
let hourUnknownInapplicable = 0
const dominantWhenInapplicable: Record<string, number> = {}

const rng = mulberry32(0x454f4b42)

for (let i = 0; i < N_SUBJECTS; i++) {
  const year = 1950 + Math.floor(rng() * 61)
  const month = 1 + Math.floor(rng() * 12)
  const day = 1 + Math.floor(rng() * daysInMonth(year, month))
  const date = `${year}-${pad(month)}-${pad(day)}`
  const unknownTime = rng() < 0.1
  const time = unknownTime ? null : `${pad(Math.floor(rng() * 24))}:${pad(Math.floor(rng() * 60))}`
  const tz = TIMEZONES[Math.floor(rng() * TIMEZONES.length)]!
  try {
    const pillars = fourPillars({ date, time, timezone: tz })
    const result = eokbu(pillars)
    if (result.hourUnknown) hourUnknown += 1
    if (result.inapplicable) {
      counts.inapplicable += 1
      if (result.hourUnknown) hourUnknownInapplicable += 1
      const key = result.inapplicable.element
      dominantWhenInapplicable[key] = (dominantWhenInapplicable[key] ?? 0) + 1
    } else if (result.strength) {
      counts[result.strength] += 1
    } else {
      counts.error += 1
    }
  } catch {
    counts.error += 1
  }
}

function pct(n: number, total = N_SUBJECTS): string {
  return `${((n / total) * 100).toFixed(2)}%`
}

const inapplicableRate = counts.inapplicable / N_SUBJECTS
const cutoffNote =
  inapplicableRate >= 0.2
    ? `판정불가 is ${pct(counts.inapplicable)} — high. Revisit the 종격 cutoff (ceil(chars×5/8) AND lead ≥ 2).`
    : inapplicableRate >= 0.1
      ? `판정불가 is ${pct(counts.inapplicable)} — watch the cutoff if live sessions cluster here.`
      : `판정불가 is ${pct(counts.inapplicable)} — within a rare-종격 band; cutoff can stay.`

const report = [
  '# 억부 용신 distribution',
  '',
  `N = ${N_SUBJECTS.toLocaleString()} synthetic subjects (1950–2010, 10% unknown birth time, seed 0x454f4b42).`,
  `Threshold: 신약 ≤ ${EOKBU_THRESHOLD.weakMax} · 중화 ${EOKBU_THRESHOLD.weakMax + 1}–${EOKBU_THRESHOLD.strongMin - 1} · 신강 ≥ ${EOKBU_THRESHOLD.strongMin}.`,
  `종격 판정불가: one 오행 ≥ ceil(chars × ${EOKBU_JONGGYEOK.numerator}/${EOKBU_JONGGYEOK.denominator}) and lead ≥ ${EOKBU_JONGGYEOK.minLead}.`,
  '',
  'Cutoff comparison on this same sample (before picking 5/8):',
  '- half + gap ≥ 2 (old): 24.69% 판정불가, of which 43.60% 토',
  '- 5/8 + gap ≥ 2 (chosen): 6.31%',
  '- half + gap ≥ 3: 7.69%',
  '- 토-aware only (토 uses 5/8 and gap ≥ 3; others keep half + gap 2): 16.91%',
  '',
  '| bucket | count | share |',
  '| --- | ---: | ---: |',
  `| 신약 | ${counts.weak} | ${pct(counts.weak)} |`,
  `| 중화 | ${counts.balanced} | ${pct(counts.balanced)} |`,
  `| 신강 | ${counts.strong} | ${pct(counts.strong)} |`,
  `| 판정불가 | ${counts.inapplicable} | ${pct(counts.inapplicable)} |`,
  `| error | ${counts.error} | ${pct(counts.error)} |`,
  '',
  `Unknown birth time: ${hourUnknown} (${pct(hourUnknown)}). Of those, 판정불가 ${hourUnknownInapplicable} (${pct(hourUnknownInapplicable, hourUnknown || 1)} of unknown-time charts).`,
  '',
  'Dominant element when 판정불가:',
  ...Object.entries(dominantWhenInapplicable)
    .sort((a, b) => b[1] - a[1])
    .map(([element, n]) => `- ${element}: ${n} (${pct(n, counts.inapplicable || 1)})`),
  '',
  cutoffNote,
  '',
].join('\n')

const outPath = resolve('docs/oracle-eokbu-distribution.md')
writeFileSync(outPath, report, 'utf8')
process.stdout.write(report)
process.stdout.write(`\nwrote ${outPath}\n`)
