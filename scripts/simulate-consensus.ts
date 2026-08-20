/**
 * Distribution simulation for the axis projection layer (`lib/oracle/axes`).
 *
 * Generates 20,000 synthetic subjects, runs all 12 projectors + `computeConsensus`
 * on each, and writes docs/oracle-consensus-distribution.md — a report on the
 * phase-verdict leader-share distribution, the element-deficiency vector, trait
 * contestedness, and per-space participation. Run TWICE (locale 'ko' / 'en')
 * because the `name` projector only participates for 'ko'.
 *
 * TRAIT_CONTESTED_SPREAD is applied at 11 (see conventions.ts).
 *
 * Run: npx tsx scripts/simulate-consensus.ts
 * (Deliberately named *.ts, not *.test.ts — vitest's `include` is
 * `**\/*.test.ts`, so this never runs as part of `npm test`. It is slow.)
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  computeConsensus,
  computeCoreTally,
  ELEMENT_AXES,
  PHASE_AXES,
  PHASE_CONSENSUS_MIN,
  PHASE_CORE_SYSTEMS,
  PHASE_ERA_CORE_SYSTEMS,
  PHASE_LEAN_MIN,
  projectAstro,
  projectIching,
  projectMaya,
  projectName,
  projectNineStar,
  projectNumerology,
  projectPrism,
  projectRune,
  projectSaju,
  projectSukuyou,
  projectTarot,
  projectZiwei,
  SYSTEM_IDS,
  TRAIT_AXES,
  TRAIT_CONTESTED_SPREAD,
  type AxisConsensus,
  type AxisVote,
  type ElementAxis,
  type PhaseAxis,
  type PhaseVector,
  type ReadingScope,
  type SystemId,
  type TraitAxis,
} from '../lib/oracle/axes'
import { MBTI_TYPES, PRISM_COLORS } from '../lib/oracle/engines/prism'
import type { MbtiType, PrismColor } from '../lib/oracle/engines/prism'

// ─── config ──────────────────────────────────────────────────────────────

const N_SUBJECTS = 20_000
const AT_DATE = '2026-08-20'
const TAROT_SPREAD = 3 as const
const RUNE_COUNT = 3
const READING_SCOPES = ['life', 'today', 'question'] as const satisfies readonly ReadingScope[]

/** Hypothetical band for simulation reporting only — not part of public consensus output. */
type PhaseVerdict = 'consensus' | 'lean' | 'split'

function hypotheticalPhaseVerdict(leaderShare: number): PhaseVerdict {
  if (leaderShare >= PHASE_CONSENSUS_MIN) return 'consensus'
  if (leaderShare >= PHASE_LEAN_MIN) return 'lean'
  return 'split'
}

const TIMEZONES = ['Asia/Seoul', 'Asia/Tokyo', 'America/New_York'] as const
type Timezone = (typeof TIMEZONES)[number]
const TZ_COORDS: Record<Timezone, { lat: number; lng: number }> = {
  'Asia/Seoul': { lat: 37.5665, lng: 126.978 },
  'Asia/Tokyo': { lat: 35.6762, lng: 139.6503 },
  'America/New_York': { lat: 40.7128, lng: -74.006 },
}

const KOREAN_SURNAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '오', '한', '신', '서', '권', '황', '안', '송', '전', '홍'] as const
const KOREAN_GIVEN_SYLLABLES = ['민', '서', '준', '지', '현', '유', '우', '하', '은', '도', '수', '진', '성', '아', '영', '호', '태', '재', '원', '경', '인', '승', '혜', '미', '규', '훈', '빈', '솔', '나', '라'] as const
const ENGLISH_FIRST_NAMES = ['James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Linda', 'William', 'Elizabeth', 'David', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica', 'Thomas', 'Sarah', 'Charles', 'Karen'] as const
const ENGLISH_LAST_NAMES = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee'] as const

// ─── seeded RNG (no Math.random) ───────────────────────────────────────────

type Rng = { next: () => number; nextInt: (max: number) => number; nextBool: () => boolean }

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeRng(seed: number): Rng {
  const next = mulberry32(seed)
  return { next, nextInt: (max) => Math.floor(next() * max), nextBool: () => next() < 0.5 }
}

function pick<T>(rng: Rng, xs: readonly T[]): T {
  return xs[rng.nextInt(xs.length)]!
}

/** Partial Fisher–Yates: `count` distinct values from `1..max`, unordered. */
function distinctPositions(rng: Rng, max: number, count: number): number[] {
  const pool = Array.from({ length: max }, (_, i) => i + 1)
  for (let i = 0; i < count; i++) {
    const j = i + rng.nextInt(max - i)
    const tmp = pool[i]!
    pool[i] = pool[j]!
    pool[j] = tmp
  }
  return pool.slice(0, count)
}

function pickDistinctColors(rng: Rng): { impulse: PrismColor; need: PrismColor; identity: PrismColor } {
  const idx = distinctPositions(rng, PRISM_COLORS.length, 3)
  return {
    impulse: PRISM_COLORS[idx[0]! - 1]!,
    need: PRISM_COLORS[idx[1]! - 1]!,
    identity: PRISM_COLORS[idx[2]! - 1]!,
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

// ─── subject generation ─────────────────────────────────────────────────

type Sex = 'male' | 'female'

type Subject = {
  date: string
  time: string | null
  unknownBirthTime: boolean
  tz: Timezone
  sex: Sex
  mbti: MbtiType
  colors: { impulse: PrismColor; need: PrismColor; identity: PrismColor }
  microCheck: [number, number, number, number]
  hasLatinName: boolean
  latinName: string
  koreanSurname: string
  koreanGivenName: string
  englishFirst: string
  englishLast: string
  tarotSeed: string
  tarotPositions: number[]
  runeSeed: string
  ichingSeed: string
}

function generateSubject(rng: Rng, runId: string, index: number): Subject {
  const year = 1950 + rng.nextInt(61)
  const month = 1 + rng.nextInt(12)
  const day = 1 + rng.nextInt(daysInMonth(year, month))
  const date = `${year}-${pad(month)}-${pad(day)}`

  const unknownBirthTime = rng.next() < 0.1
  const time = unknownBirthTime ? null : `${pad(rng.nextInt(24))}:${pad(rng.nextInt(60))}`

  return {
    date,
    time,
    unknownBirthTime,
    tz: pick(rng, TIMEZONES),
    sex: rng.nextBool() ? 'male' : 'female',
    mbti: pick(rng, MBTI_TYPES),
    colors: pickDistinctColors(rng),
    microCheck: [1 + rng.nextInt(5), 1 + rng.nextInt(5), 1 + rng.nextInt(5), 1 + rng.nextInt(5)],
    hasLatinName: rng.next() < 0.7,
    latinName: `${pick(rng, ENGLISH_FIRST_NAMES)} ${pick(rng, ENGLISH_LAST_NAMES)}`,
    koreanSurname: pick(rng, KOREAN_SURNAMES),
    koreanGivenName: pick(rng, KOREAN_GIVEN_SYLLABLES) + pick(rng, KOREAN_GIVEN_SYLLABLES),
    englishFirst: pick(rng, ENGLISH_FIRST_NAMES),
    englishLast: pick(rng, ENGLISH_LAST_NAMES),
    tarotSeed: `${runId}-tarot-${index}`,
    tarotPositions: distinctPositions(rng, 78, TAROT_SPREAD),
    runeSeed: `${runId}-rune-${index}`,
    ichingSeed: `${runId}-iching-${index}`,
  }
}

function buildVotes(subject: Subject, locale: 'ko' | 'en'): AxisVote[] {
  const { lat, lng } = TZ_COORDS[subject.tz]
  const timeKnown = !subject.unknownBirthTime
  const nameInput =
    locale === 'ko'
      ? { surname: subject.koreanSurname, givenName: subject.koreanGivenName, locale: 'ko' as const }
      : { surname: subject.englishLast, givenName: subject.englishFirst, locale: 'en' as const }

  return [
    projectSaju({ date: subject.date, time: subject.time, timezone: subject.tz, sex: subject.sex, asOfDate: AT_DATE }),
    projectAstro({
      date: subject.date,
      time: subject.time,
      tz: subject.tz,
      lat,
      lng,
      timeKnown,
      asOf: { date: AT_DATE, time: '12:00', tz: subject.tz },
    }),
    projectPrism({
      birthDate: subject.date,
      mbti: subject.mbti,
      colors: subject.colors,
      microCheck: subject.microCheck,
      atDate: AT_DATE,
    }),
    projectZiwei({ birthDate: subject.date, birthTime: subject.time, tz: subject.tz, sex: subject.sex, atDate: AT_DATE }),
    projectNineStar({ date: subject.date, time: subject.time, timezone: subject.tz, atDate: AT_DATE }),
    projectSukuyou({ birthDate: subject.date, birthTime: subject.time, tz: subject.tz, atDate: AT_DATE }),
    projectMaya({ birthDate: subject.date, atDate: AT_DATE }),
    projectTarot({ seed: subject.tarotSeed, spread: TAROT_SPREAD, pickedPositions: subject.tarotPositions }),
    projectRune({ seed: subject.runeSeed, count: RUNE_COUNT }),
    projectIching({ seed: subject.ichingSeed }),
    projectNumerology({ birthDate: subject.date, latinName: subject.hasLatinName ? subject.latinName : null, atDate: AT_DATE }),
    projectName(nameInput),
  ]
}

// ─── stats plumbing ──────────────────────────────────────────────────────

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((sum, v) => sum + v, 0) / xs.length
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.round(p * (sortedAsc.length - 1))))
  return sortedAsc[idx]!
}

function pct(n: number, total: number): string {
  return total === 0 ? '0.00%' : `${((n / total) * 100).toFixed(2)}%`
}

function bar(count: number, total: number, width = 24): string {
  const filled = total === 0 ? 0 : Math.round((count / total) * width)
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled))
}

function bucket5(value: number): number {
  return Math.min(95, Math.max(0, Math.floor(value / 5) * 5))
}

type CohortAccumulator = {
  n: number
  participating: { traits: number; elements: number; phase: number }
  contestedSum: number
  leaderShareSum: number
}

function emptyCohort(): CohortAccumulator {
  return { n: 0, participating: { traits: 0, elements: 0, phase: 0 }, contestedSum: 0, leaderShareSum: 0 }
}

/** Recorded from the pre-timescale run (softenPhase fix, equal phase weights). */
const BEFORE_SOFTEN = {
  verdict: { consensus: 0.18, lean: 22.99, split: 76.83 },
  meanLeaderShareLife: 41.7,
  woodAggregate: 16.4,
} as const

type PhaseScopeStats = {
  leaderShareHistogram: number[]
  verdictCounts: Record<PhaseVerdict, number>
  polarizedCount: number
  subjectsWithOpposition: number
  oppositionPairCounts: Map<string, number>
  leaderAxisCounts: Record<PhaseAxis, number>
  leaderShareSum: number
}

function emptyPhaseScopeStats(): PhaseScopeStats {
  return {
    leaderShareHistogram: new Array(20).fill(0),
    verdictCounts: { consensus: 0, lean: 0, split: 0 },
    polarizedCount: 0,
    subjectsWithOpposition: 0,
    oppositionPairCounts: new Map(),
    leaderAxisCounts: { advance: 0, hold: 0, release: 0 },
    leaderShareSum: 0,
  }
}

function emptyPhaseByScope(): Record<ReadingScope, PhaseScopeStats> {
  return { life: emptyPhaseScopeStats(), today: emptyPhaseScopeStats(), question: emptyPhaseScopeStats() }
}

type SubsetPhaseStats = {
  n: number
  nWithTwoPlus: number
  leaderShareHistogram: number[]
  leaderShareSum: number
  verdictCounts: Record<PhaseVerdict, number>
  leaderAxisCounts: Record<PhaseAxis, number>
  unanimityCount: number
  fiftyFiftyVoterCount: number
  participatingSum: number
}

function emptySubsetPhaseStats(): SubsetPhaseStats {
  return {
    n: 0,
    nWithTwoPlus: 0,
    leaderShareHistogram: new Array(20).fill(0),
    leaderShareSum: 0,
    verdictCounts: { consensus: 0, lean: 0, split: 0 },
    leaderAxisCounts: { advance: 0, hold: 0, release: 0 },
    unanimityCount: 0,
    fiftyFiftyVoterCount: 0,
    participatingSum: 0,
  }
}

function dominantPhase(vector: { advance: number; hold: number; release: number }): PhaseAxis {
  return PHASE_AXES.reduce((best, axis) => (vector[axis] > vector[best] ? axis : best), PHASE_AXES[0])
}

function recordSubsetPhase(
  stats: SubsetPhaseStats,
  votes: AxisVote[],
  tally: PhaseVector,
  systems: readonly SystemId[],
): void {
  const leader = dominantPhase(tally)
  const leaderShare = tally[leader]
  stats.n += 1
  stats.leaderShareHistogram[bucket5(leaderShare) / 5]! += 1
  stats.leaderShareSum += leaderShare
  stats.verdictCounts[hypotheticalPhaseVerdict(leaderShare)] += 1
  stats.leaderAxisCounts[leader] += 1

  const allowed = new Set<SystemId>(systems)
  const participatingVotes = votes.filter((vote) => allowed.has(vote.system) && vote.phase)
  stats.participatingSum += participatingVotes.length
  if (participatingVotes.length < 2) return
  stats.nWithTwoPlus += 1

  const counts: Record<PhaseAxis, number> = { advance: 0, hold: 0, release: 0 }
  for (const vote of participatingVotes) {
    counts[dominantPhase(vote.phase!)] += 1
  }
  const present = PHASE_AXES.filter((axis) => counts[axis] > 0)
  if (present.length === 1) stats.unanimityCount += 1
  if (present.length === 2 && counts[present[0]!] === counts[present[1]!]) stats.fiftyFiftyVoterCount += 1
}

type ElementSupplyRow = { sum: Record<ElementAxis, number>; weightSum: number }

type RunStats = {
  locale: 'ko' | 'en'
  n: number

  phaseByScope: Record<ReadingScope, PhaseScopeStats>
  corePhase: SubsetPhaseStats
  eraPhase: SubsetPhaseStats

  elementTopDeficiencyCounts: Record<ElementAxis, number>
  elementDeficiencySum: Record<ElementAxis, number>
  aggregateElementTotalSum: Record<ElementAxis, number>
  elementSupply: Record<SystemId, ElementSupplyRow>
  flatDeficiencyCount: number

  contestedCountHistogram: number[]
  axisContestedCounts: Record<TraitAxis, number>
  spreadSamples: number[]

  participatingSum: { traits: number; elements: number; phase: number }
  unreadableCounts: Map<string, number>

  cohortKnown: CohortAccumulator
  cohortUnknown: CohortAccumulator
  unknownBirthTimeCount: number
}

function emptyElementSupply(): Record<SystemId, ElementSupplyRow> {
  const out = {} as Record<SystemId, ElementSupplyRow>
  for (const id of SYSTEM_IDS) {
    out[id] = { sum: { wood: 0, fire: 0, earth: 0, metal: 0, water: 0 }, weightSum: 0 }
  }
  return out
}

function emptyRunStats(locale: 'ko' | 'en'): RunStats {
  return {
    locale,
    n: 0,
    phaseByScope: emptyPhaseByScope(),
    corePhase: emptySubsetPhaseStats(),
    eraPhase: emptySubsetPhaseStats(),
    elementTopDeficiencyCounts: { wood: 0, fire: 0, earth: 0, metal: 0, water: 0 },
    elementDeficiencySum: { wood: 0, fire: 0, earth: 0, metal: 0, water: 0 },
    aggregateElementTotalSum: { wood: 0, fire: 0, earth: 0, metal: 0, water: 0 },
    elementSupply: emptyElementSupply(),
    flatDeficiencyCount: 0,
    contestedCountHistogram: new Array(7).fill(0),
    axisContestedCounts: { drive: 0, stability: 0, relation: 0, control: 0, exploration: 0, reflection: 0 },
    spreadSamples: [],
    participatingSum: { traits: 0, elements: 0, phase: 0 },
    unreadableCounts: new Map(),
    cohortKnown: emptyCohort(),
    cohortUnknown: emptyCohort(),
    unknownBirthTimeCount: 0,
  }
}

/** Also appends into the cross-locale accumulators used for the threshold proposal. */
function recordPhaseScope(
  scopeStats: PhaseScopeStats,
  consensus: AxisConsensus,
  combinedLeaderShare: number[],
): void {
  const leaderShare = consensus.phase.leaderShare
  scopeStats.leaderShareHistogram[bucket5(leaderShare) / 5]! += 1
  scopeStats.verdictCounts[hypotheticalPhaseVerdict(leaderShare)] += 1
  scopeStats.leaderAxisCounts[consensus.phase.leader] += 1
  scopeStats.leaderShareSum += leaderShare
  combinedLeaderShare.push(leaderShare)
  if (consensus.phase.polarized) scopeStats.polarizedCount += 1
  if (consensus.phase.oppositions.length > 0) scopeStats.subjectsWithOpposition += 1
  for (const opp of consensus.phase.oppositions) {
    const key = [opp.a, opp.b].sort().join('|')
    scopeStats.oppositionPairCounts.set(key, (scopeStats.oppositionPairCounts.get(key) ?? 0) + 1)
  }
}

function recordSubject(
  stats: RunStats,
  subject: Subject,
  votes: AxisVote[],
  consensusByScope: Record<ReadingScope, AxisConsensus>,
  combinedByScope: Record<ReadingScope, { leaderShare: number[]; spreadSamples: number[] }>,
): void {
  stats.n += 1

  for (const scope of READING_SCOPES) {
    recordPhaseScope(stats.phaseByScope[scope], consensusByScope[scope], combinedByScope[scope].leaderShare)
  }

  const consensus = consensusByScope.life
  recordSubsetPhase(stats.corePhase, votes, consensus.phase.coreTally, PHASE_CORE_SYSTEMS)
  recordSubsetPhase(stats.eraPhase, votes, computeCoreTally(votes, PHASE_ERA_CORE_SYSTEMS), PHASE_ERA_CORE_SYSTEMS)

  let topAxis: ElementAxis = ELEMENT_AXES[0]
  let topValue = -1
  for (const axis of ELEMENT_AXES) {
    const deficiency = consensus.elements.deficiency[axis]
    stats.elementDeficiencySum[axis] += deficiency
    if (deficiency > topValue) {
      topValue = deficiency
      topAxis = axis
    }
  }
  stats.elementTopDeficiencyCounts[topAxis] += 1
  if (topValue < 5) stats.flatDeficiencyCount += 1
  for (const axis of ELEMENT_AXES) {
    stats.aggregateElementTotalSum[axis] += consensus.elements.total[axis]
  }
  for (const vote of votes) {
    if (!vote.elements) continue
    const weight = vote.confidence.elements?.weight ?? 0
    if (weight <= 0) continue
    const row = stats.elementSupply[vote.system]
    row.weightSum += weight
    for (const axis of ELEMENT_AXES) row.sum[axis] += vote.elements[axis] * weight
  }

  // Traits
  const contestedCount = consensus.traits.contested.length
  stats.contestedCountHistogram[contestedCount]! += 1
  for (const axis of consensus.traits.contested) stats.axisContestedCounts[axis] += 1
  for (const axis of TRAIT_AXES) {
    stats.spreadSamples.push(consensus.traits.spread[axis])
    combinedByScope.life.spreadSamples.push(consensus.traits.spread[axis])
  }

  // Participation
  stats.participatingSum.traits += consensus.traits.participating.length
  stats.participatingSum.elements += consensus.elements.participating.length
  stats.participatingSum.phase += consensus.phase.participating.length
  for (const vote of votes) {
    for (const entry of vote.unreadable) {
      const key = `${vote.system}|${entry.space}|${entry.code}`
      stats.unreadableCounts.set(key, (stats.unreadableCounts.get(key) ?? 0) + 1)
    }
  }

  // Unknown-birth-time cohort
  const cohort = subject.unknownBirthTime ? stats.cohortUnknown : stats.cohortKnown
  cohort.n += 1
  cohort.participating.traits += consensus.traits.participating.length
  cohort.participating.elements += consensus.elements.participating.length
  cohort.participating.phase += consensus.phase.participating.length
  cohort.contestedSum += contestedCount
  cohort.leaderShareSum += consensus.phase.tally[consensus.phase.leader]
  if (subject.unknownBirthTime) stats.unknownBirthTimeCount += 1
}

// ─── run one locale ──────────────────────────────────────────────────────

function runLocale(
  locale: 'ko' | 'en',
  seed: number,
  combinedByScope: Record<ReadingScope, { leaderShare: number[]; spreadSamples: number[] }>,
): RunStats {
  const rng = makeRng(seed)
  const stats = emptyRunStats(locale)
  for (let i = 0; i < N_SUBJECTS; i++) {
    const subject = generateSubject(rng, locale, i)
    const votes = buildVotes(subject, locale)
    const consensusByScope = {
      life: computeConsensus(votes, { readingScope: 'life' }),
      today: computeConsensus(votes, { readingScope: 'today' }),
      question: computeConsensus(votes, { readingScope: 'question' }),
    } satisfies Record<ReadingScope, AxisConsensus>
    recordSubject(stats, subject, votes, consensusByScope, combinedByScope)
  }
  return stats
}

// ─── report rendering ────────────────────────────────────────────────────

const SYSTEM_LABEL: Record<SystemId, string> = {
  saju: 'saju',
  astro: 'astro',
  prism: 'prism',
  ziwei: 'ziwei',
  numerology: 'numerology',
  name: 'name',
  iching: 'iching',
  tarot: 'tarot',
  runes: 'runes',
  ninestar: 'ninestar',
  sukuyou: 'sukuyou',
  tzolkin: 'tzolkin',
}

function renderLeaderShareHistogram(scopeStats: PhaseScopeStats, n: number): string[] {
  const lines = scopeStats.leaderShareHistogram.map((count, i) => {
    const lo = i * 5
    const hi = i === 19 ? 100 : lo + 4
    return `| ${String(lo).padStart(3)}–${String(hi).padStart(3)} | ${String(count).padStart(6)} | ${pct(count, n).padStart(7)} | ${bar(count, n)} |`
  })
  return ['| Leader share | Count | Share | |', '| --- | ---: | ---: | --- |', ...lines]
}

function renderVerdictTable(scopeStats: PhaseScopeStats, n: number): string[] {
  const order: PhaseVerdict[] = ['consensus', 'lean', 'split']
  return [
    '| Verdict | Count | Share | |',
    '| --- | ---: | ---: | --- |',
    ...order.map((v) => `| ${v} | ${scopeStats.verdictCounts[v]} | ${pct(scopeStats.verdictCounts[v], n)} | ${bar(scopeStats.verdictCounts[v], n)} |`),
    '',
    `- polarized (tally bimodal, annotation only): **${pct(scopeStats.polarizedCount, n)}**`,
  ]
}

function renderOppositionPairs(scopeStats: PhaseScopeStats, n: number): string[] {
  const entries = [...scopeStats.oppositionPairCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  if (entries.length === 0) return ['_no opposite-pole pairs recorded_']
  return [
    '| Pair | Count | Share of N |',
    '| --- | ---: | ---: |',
    ...entries.map(([key, count]) => {
      const [a, b] = key.split('|')
      return `| ${a} ↔ ${b} | ${count} | ${pct(count, n)} |`
    }),
    '',
    `- subjects with at least one opposite-pole pair: **${pct(scopeStats.subjectsWithOpposition, n)}**`,
  ]
}

function renderLeaderAxisTable(scopeStats: PhaseScopeStats, n: number): string[] {
  return [
    '| Axis | Count | Share | |',
    '| --- | ---: | ---: | --- |',
    ...PHASE_AXES.map((axis) => `| ${axis} | ${scopeStats.leaderAxisCounts[axis]} | ${pct(scopeStats.leaderAxisCounts[axis], n)} | ${bar(scopeStats.leaderAxisCounts[axis], n)} |`),
  ]
}

function mergePhaseScope(a: PhaseScopeStats, b: PhaseScopeStats): PhaseScopeStats {
  const out = emptyPhaseScopeStats()
  for (let i = 0; i < 20; i++) out.leaderShareHistogram[i] = a.leaderShareHistogram[i]! + b.leaderShareHistogram[i]!
  for (const v of ['consensus', 'lean', 'split'] as const) out.verdictCounts[v] = a.verdictCounts[v] + b.verdictCounts[v]
  out.polarizedCount = a.polarizedCount + b.polarizedCount
  out.subjectsWithOpposition = a.subjectsWithOpposition + b.subjectsWithOpposition
  out.leaderShareSum = a.leaderShareSum + b.leaderShareSum
  for (const axis of PHASE_AXES) out.leaderAxisCounts[axis] = a.leaderAxisCounts[axis] + b.leaderAxisCounts[axis]
  for (const [key, count] of a.oppositionPairCounts) out.oppositionPairCounts.set(key, (out.oppositionPairCounts.get(key) ?? 0) + count)
  for (const [key, count] of b.oppositionPairCounts) out.oppositionPairCounts.set(key, (out.oppositionPairCounts.get(key) ?? 0) + count)
  return out
}

function mergeSubsetPhase(a: SubsetPhaseStats, b: SubsetPhaseStats): SubsetPhaseStats {
  const out = emptySubsetPhaseStats()
  out.n = a.n + b.n
  out.nWithTwoPlus = a.nWithTwoPlus + b.nWithTwoPlus
  out.leaderShareSum = a.leaderShareSum + b.leaderShareSum
  out.unanimityCount = a.unanimityCount + b.unanimityCount
  out.fiftyFiftyVoterCount = a.fiftyFiftyVoterCount + b.fiftyFiftyVoterCount
  out.participatingSum = a.participatingSum + b.participatingSum
  for (let i = 0; i < 20; i++) out.leaderShareHistogram[i] = a.leaderShareHistogram[i]! + b.leaderShareHistogram[i]!
  for (const v of ['consensus', 'lean', 'split'] as const) out.verdictCounts[v] = a.verdictCounts[v] + b.verdictCounts[v]
  for (const axis of PHASE_AXES) out.leaderAxisCounts[axis] = a.leaderAxisCounts[axis] + b.leaderAxisCounts[axis]
  return out
}

function clusterShare35to44FromHist(histogram: number[], n: number): number {
  let count = 0
  for (let i = 7; i <= 8; i++) count += histogram[i]!
  return n === 0 ? 0 : count / n
}

function renderSubsetHistogram(stats: SubsetPhaseStats): string[] {
  const lines = stats.leaderShareHistogram.map((count, i) => {
    const lo = i * 5
    const hi = i === 19 ? 100 : lo + 4
    return `| ${String(lo).padStart(3)}–${String(hi).padStart(3)} | ${String(count).padStart(6)} | ${pct(count, stats.n).padStart(7)} | ${bar(count, stats.n)} |`
  })
  return ['| Leader share | Count | Share | |', '| --- | ---: | ---: | --- |', ...lines]
}

function renderSubsetExperiment(
  label: string,
  systems: readonly string[],
  stats: SubsetPhaseStats,
): string[] {
  const meanLeader = stats.leaderShareSum / stats.n
  const cluster = clusterShare35to44FromHist(stats.leaderShareHistogram, stats.n)
  const denom = stats.nWithTwoPlus
  return [
    `### ${label}`,
    '',
    `- systems: ${systems.join(', ')}`,
    `- mean participating: **${(stats.participatingSum / stats.n).toFixed(2)}** of ${systems.length}`,
    `- mean leader share: **${meanLeader.toFixed(1)}%**`,
    `- 35–44% band: **${(cluster * 100).toFixed(1)}%**`,
    `- unanimity (all participating voters share one dominant axis, among N with ≥2 voters): **${pct(stats.unanimityCount, denom)}** (${stats.unanimityCount} / ${denom})`,
    `- 50/50 voter split (exactly two dominant axes, equal voter counts, among N with ≥2 voters): **${pct(stats.fiftyFiftyVoterCount, denom)}** (${stats.fiftyFiftyVoterCount} / ${denom})`,
    '',
    '#### Leader-share histogram (bucketed by 5)',
    '',
    ...renderSubsetHistogram(stats),
    '',
    `#### Verdict distribution if thresholds were ${PHASE_CONSENSUS_MIN}/${PHASE_LEAN_MIN} (NOT applied)`,
    '',
    '| Verdict | Count | Share | |',
    '| --- | ---: | ---: | --- |',
    ...(['consensus', 'lean', 'split'] as const).map(
      (v) => `| ${v} | ${stats.verdictCounts[v]} | ${pct(stats.verdictCounts[v], stats.n)} | ${bar(stats.verdictCounts[v], stats.n)} |`,
    ),
    '',
    '#### Which phase axis leads',
    '',
    '| Axis | Count | Share | |',
    '| --- | ---: | ---: | --- |',
    ...PHASE_AXES.map((axis) => `| ${axis} | ${stats.leaderAxisCounts[axis]} | ${pct(stats.leaderAxisCounts[axis], stats.n)} | ${bar(stats.leaderAxisCounts[axis], stats.n)} |`),
    '',
  ]
}

function clusterShare35to44(scopeStats: PhaseScopeStats, n: number): number {
  let count = 0
  for (let i = 7; i <= 8; i++) count += scopeStats.leaderShareHistogram[i]!
  return n === 0 ? 0 : count / n
}

function renderScopePhaseSection(scope: ReadingScope, scopeStats: PhaseScopeStats, n: number): string[] {
  const meanLeader = scopeStats.leaderShareSum / n
  const cluster = clusterShare35to44(scopeStats, n)
  const clusterNote =
    scope === 'life' && cluster >= 0.6
      ? [
          '',
          `★ **Life scope still clusters at 35–44%** (${(cluster * 100).toFixed(1)}% of subjects). Phase consensus is genuinely weak at era/annual scales — consider changing what we DISPLAY rather than lowering thresholds further.`,
        ]
      : cluster >= 0.5
        ? ['', `Note: ${(cluster * 100).toFixed(1)}% of subjects fall in the 35–44% leader-share band.`]
        : ['', `Leader share is more spread under \`${scope}\` scope (35–44% band: ${(cluster * 100).toFixed(1)}%).`]

  return [
    `### readingScope \`${scope}\` (combined ko + en, N = ${n.toLocaleString()})`,
    '',
    `- mean leader share: **${meanLeader.toFixed(1)}%**`,
    '',
    '#### Leader-share histogram (bucketed by 5)',
    '',
    ...renderLeaderShareHistogram(scopeStats, n),
    '',
    `#### Verdict distribution (current thresholds: consensus≥${PHASE_CONSENSUS_MIN} / lean≥${PHASE_LEAN_MIN} / split<${PHASE_LEAN_MIN})`,
    '',
    ...renderVerdictTable(scopeStats, n),
    '',
    '#### Opposition pairs (top 5)',
    '',
    ...renderOppositionPairs(scopeStats, n),
    '',
    '#### Which phase axis leads',
    '',
    ...renderLeaderAxisTable(scopeStats, n),
    ...clusterNote,
    '',
  ]
}

function renderElementSupply(stats: RunStats, combinedSupply: Record<SystemId, ElementSupplyRow>): string[] {
  const projectorRows = SYSTEM_IDS.map((id) => {
    const row = combinedSupply[id]!
    if (row.weightSum <= 0) return `| ${SYSTEM_LABEL[id]} | — | — | — | — | — |`
    const means = ELEMENT_AXES.map((axis) => row.sum[axis] / row.weightSum)
    return `| ${SYSTEM_LABEL[id]} | ${means.map((v) => v.toFixed(1)).join(' | ')} |`
  })
  const aggregateMeans = ELEMENT_AXES.map((axis) => stats.aggregateElementTotalSum[axis] / stats.n)

  const woodByProjector = SYSTEM_IDS.map((id) => {
    const row = combinedSupply[id]!
    if (row.weightSum <= 0) return { id, wood: null as number | null }
    return { id, wood: row.sum.wood / row.weightSum }
  }).filter((r) => r.wood !== null) as { id: SystemId; wood: number }[]

  woodByProjector.sort((a, b) => a.wood - b.wood)
  const lowestWood = woodByProjector[0]
  const aggregateWood = aggregateMeans[0]!
  const otherElementsMean = ELEMENT_AXES.filter((a) => a !== 'wood').reduce((s, a) => s + aggregateMeans[ELEMENT_AXES.indexOf(a)]!, 0) / 4
  const woodGap = otherElementsMean - aggregateWood

  const diagnosis =
    woodGap > 2 && lowestWood
      ? [
          '',
          `★ **Wood skew diagnosis**: aggregate wood mean (**${aggregateWood.toFixed(1)}%**) sits **${woodGap.toFixed(1)} pts** below the other four elements' average (**${otherElementsMean.toFixed(1)}%**). Lowest wood supplier among participating projectors: **${SYSTEM_LABEL[lowestWood.id]}** (mean wood **${lowestWood.wood.toFixed(1)}%**).`,
        ]
      : ['', `★ Aggregate wood (**${aggregateWood.toFixed(1)}%**) is within ~2 pts of the other elements' average after mapping fixes.`]

  return [
    '| Projector | wood | fire | earth | metal | water |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...projectorRows,
    '',
    `Aggregate mean element total (from consensus, N=${stats.n.toLocaleString()}): **${aggregateMeans.map((v) => v.toFixed(1)).join(' / ')}**`,
    ...diagnosis,
  ]
}

function mergeElementSupply(a: Record<SystemId, ElementSupplyRow>, b: Record<SystemId, ElementSupplyRow>): Record<SystemId, ElementSupplyRow> {
  const out = emptyElementSupply()
  for (const id of SYSTEM_IDS) {
    for (const axis of ELEMENT_AXES) out[id]!.sum[axis] = a[id]!.sum[axis] + b[id]!.sum[axis]
    out[id]!.weightSum = a[id]!.weightSum + b[id]!.weightSum
  }
  return out
}

function renderRunReport(stats: RunStats): string[] {
  const participatingSpaces = stats.locale === 'ko' ? 'name participates in traits + elements (phase unreadable)' : 'name is entirely unreadable (non-CJK locale)'
  return [
    `## Locale \`${stats.locale}\` (N = ${stats.n.toLocaleString()})`,
    '',
    `${stats.locale === 'ko' ? 'Korean name supplied →' : 'No CJK name supplied →'} ${participatingSpaces}.`,
    '',
    '### Element deficiency',
    '',
    ...renderElementDeficiencyTable(stats),
    '',
    `- flat deficiency vectors (max deficiency < 5): ${pct(stats.flatDeficiencyCount, stats.n)}`,
    '',
    '### Traits',
    '',
    '#### How many of the 6 axes are contested',
    '',
    ...renderContestedHistogram(stats),
    '',
    `- mean contested axes: **${(stats.contestedCountHistogram.reduce((sum, c, i) => sum + c * i, 0) / stats.n).toFixed(2)}** of 6`,
    '',
    '#### Per-axis contested rate',
    '',
    ...renderAxisContestedTable(stats),
    '',
    '#### Centered profile spread distribution',
    '',
    ...renderSpreadHistogram(stats),
    '',
    '### Participation',
    '',
    ...renderParticipationTable(stats),
    '',
    '#### Unreadable systems, by space and code',
    '',
    ...renderUnreadableTable(stats),
    '',
    '#### Unknown-birth-time cohort (10%) vs. the rest',
    '',
    ...renderCohortComparison(stats),
    '',
  ]
}

function renderElementDeficiencyTable(stats: RunStats): string[] {
  const maxShare = Math.max(...ELEMENT_AXES.map((axis) => stats.elementTopDeficiencyCounts[axis] / stats.n))
  const flagged = maxShare > 0.35
  const rows = [
    '| Element | Top-deficiency % | Mean deficiency | |',
    '| --- | ---: | ---: | --- |',
    ...ELEMENT_AXES.map(
      (axis) =>
        `| ${axis} | ${pct(stats.elementTopDeficiencyCounts[axis], stats.n)} | ${(stats.elementDeficiencySum[axis] / stats.n).toFixed(2)} | ${bar(stats.elementTopDeficiencyCounts[axis], stats.n)} |`,
    ),
  ]
  const flag = flagged
    ? [
        '',
        `★ **FLAG**: at least one element (top-deficiency share ${(maxShare * 100).toFixed(2)}%) exceeds 35% of subjects. The talisman product depends on this vector being varied — investigate before shipping.`,
      ]
    : ['', `★ No single element exceeds 35% top-deficiency share (max observed: ${(maxShare * 100).toFixed(2)}%). The deficiency vector is varied.`]
  return [...rows, ...flag]
}

function renderContestedHistogram(stats: RunStats): string[] {
  return [
    '| Contested axes | Count | Share | |',
    '| --- | ---: | ---: | --- |',
    ...stats.contestedCountHistogram.map((count, i) => `| ${i} of 6 | ${count} | ${pct(count, stats.n)} | ${bar(count, stats.n)} |`),
  ]
}

function renderAxisContestedTable(stats: RunStats): string[] {
  return [
    '| Axis | Contested % | |',
    '| --- | ---: | --- |',
    ...TRAIT_AXES.map((axis) => `| ${axis} | ${pct(stats.axisContestedCounts[axis], stats.n)} | ${bar(stats.axisContestedCounts[axis], stats.n)} |`),
  ]
}

function renderSpreadHistogram(stats: RunStats): string[] {
  const bucketWidth = 2
  const bucketCount = 11 // 0-2 .. 18-20, plus 20+
  const buckets = new Array(bucketCount).fill(0) as number[]
  for (const v of stats.spreadSamples) {
    const idx = Math.min(bucketCount - 1, Math.floor(v / bucketWidth))
    buckets[idx]! += 1
  }
  const total = stats.spreadSamples.length
  const sorted = [...stats.spreadSamples].sort((a, b) => a - b)
  const lines = buckets.map((count, i) => {
    const lo = i * bucketWidth
    const label = i === bucketCount - 1 ? `${lo}+` : `${lo}–${lo + bucketWidth - 1}`
    return `| ${label.padStart(6)} | ${String(count).padStart(7)} | ${pct(count, total).padStart(7)} | ${bar(count, total)} |`
  })
  return [
    '| Centered spread | Count | Share | |',
    '| --- | ---: | ---: | --- |',
    ...lines,
    '',
    `- samples: ${total.toLocaleString()} (6 axes × ${stats.n.toLocaleString()} subjects)`,
    `- mean: **${mean(stats.spreadSamples).toFixed(2)}**`,
    `- median (p50): **${percentile(sorted, 0.5).toFixed(2)}**`,
    `- p90: **${percentile(sorted, 0.9).toFixed(2)}**`,
    `- current TRAIT_CONTESTED_SPREAD = **${TRAIT_CONTESTED_SPREAD}**`,
  ]
}

function renderParticipationTable(stats: RunStats): string[] {
  return [
    '| Space | Mean systems participating (of 12) |',
    '| --- | ---: |',
    `| traits | ${(stats.participatingSum.traits / stats.n).toFixed(2)} |`,
    `| elements | ${(stats.participatingSum.elements / stats.n).toFixed(2)} |`,
    `| phase | ${(stats.participatingSum.phase / stats.n).toFixed(2)} |`,
  ]
}

function renderUnreadableTable(stats: RunStats): string[] {
  type Row = { system: SystemId; space: string; code: string; count: number }
  const rows: Row[] = []
  for (const [key, count] of stats.unreadableCounts.entries()) {
    const [system, space, code] = key.split('|') as [SystemId, string, string]
    rows.push({ system, space, code, count })
  }
  rows.sort((a, b) => b.count - a.count)
  return [
    '| System | Space | Code | Count | Share of N | |',
    '| --- | --- | --- | ---: | ---: | --- |',
    ...rows.map((r) => `| ${SYSTEM_LABEL[r.system]} | ${r.space} | \`${r.code}\` | ${r.count} | ${pct(r.count, stats.n)} | ${bar(r.count, stats.n)} |`),
  ]
}

function renderCohortComparison(stats: RunStats): string[] {
  const rowFor = (label: string, c: CohortAccumulator): string =>
    `| ${label} | ${c.n} | ${(c.participating.traits / c.n).toFixed(2)} | ${(c.participating.elements / c.n).toFixed(2)} | ${(c.participating.phase / c.n).toFixed(2)} | ${(c.contestedSum / c.n).toFixed(2)} | ${(c.leaderShareSum / c.n).toFixed(1)} |`
  return [
    '| Cohort | N | traits participating | elements participating | phase participating | mean contested axes | mean leader share |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    rowFor('birth time known', stats.cohortKnown),
    rowFor('birth time UNKNOWN', stats.cohortUnknown),
    '',
    `- unknown-birth-time share of subjects: ${pct(stats.unknownBirthTimeCount, stats.n)} (target ~10%)`,
    `- \`ziwei\` traits unreadable count: ${stats.unreadableCounts.get('ziwei|traits|ziwei.no_birth_time') ?? 0} — should equal the unknown-birth-time count (${stats.unknownBirthTimeCount}), since \`ziwei\` is the only system whose traits/phase go fully \`unreadable\` (not merely degraded) on unknown birth time.`,
    `- \`ziwei\` phase unreadable count: ${stats.unreadableCounts.get('ziwei|phase|ziwei.no_birth_time') ?? 0} (ziwei.no_current_daxian may add a small amount on top when \`atDate\` falls outside the computed 大限 range even with a known birth time).`,
  ]
}

// ─── main ────────────────────────────────────────────────────────────────

const combinedByScope = {
  life: { leaderShare: [] as number[], spreadSamples: [] as number[] },
  today: { leaderShare: [] as number[], spreadSamples: [] as number[] },
  question: { leaderShare: [] as number[], spreadSamples: [] as number[] },
} satisfies Record<ReadingScope, { leaderShare: number[]; spreadSamples: number[] }>

const t0 = Date.now()
const koStats = runLocale('ko', 0x4b4f5f31, combinedByScope)
const tKo = Date.now()
const enStats = runLocale('en', 0x454e5f32, combinedByScope)
const tEn = Date.now()

const totalN = koStats.n + enStats.n
const combinedCore = mergeSubsetPhase(koStats.corePhase, enStats.corePhase)
const combinedEra = mergeSubsetPhase(koStats.eraPhase, enStats.eraPhase)

const combinedPhaseByScope = READING_SCOPES.reduce(
  (acc, scope) => {
    acc[scope] = mergePhaseScope(koStats.phaseByScope[scope], enStats.phaseByScope[scope])
    return acc
  },
  {} as Record<ReadingScope, PhaseScopeStats>,
)

function renderBeforeAfter(totalN: number): string[] {
  const life = combinedPhaseByScope.life
  const afterConsensus = (life.verdictCounts.consensus / totalN) * 100
  const afterLean = (life.verdictCounts.lean / totalN) * 100
  const afterSplit = (life.verdictCounts.split / totalN) * 100
  const afterPolarized = (life.polarizedCount / totalN) * 100
  const meanLeaderLife = life.leaderShareSum / totalN

  return [
    '## Before / after',
    '',
    '| Metric | Before softenPhase (life, equal weights) | After timescale + element fix (life scope) |',
    '| --- | ---: | ---: |',
    `| consensus % | ${BEFORE_SOFTEN.verdict.consensus.toFixed(2)}% | **${afterConsensus.toFixed(2)}%** |`,
    `| lean % | ${BEFORE_SOFTEN.verdict.lean.toFixed(2)}% | **${afterLean.toFixed(2)}%** |`,
    `| split % | ${BEFORE_SOFTEN.verdict.split.toFixed(2)}% | **${afterSplit.toFixed(2)}%** |`,
    `| mean leader share (life) | ${BEFORE_SOFTEN.meanLeaderShareLife.toFixed(1)}% | **${meanLeaderLife.toFixed(1)}%** |`,
    `| polarized % (life) | — | **${afterPolarized.toFixed(2)}%** |`,
    `| aggregate wood % | ${BEFORE_SOFTEN.woodAggregate.toFixed(1)}% | see element supply § |`,
    '',
  ]
}

function renderCoreVsFull(totalN: number): string[] {
  const life = combinedPhaseByScope.life
  const fullMean = life.leaderShareSum / totalN
  const coreMean = combinedCore.leaderShareSum / combinedCore.n
  const eraMean = combinedEra.leaderShareSum / combinedEra.n
  const fullCluster = clusterShare35to44(life, totalN)
  const coreCluster = clusterShare35to44FromHist(combinedCore.leaderShareHistogram, combinedCore.n)
  const eraCluster = clusterShare35to44FromHist(combinedEra.leaderShareHistogram, combinedEra.n)

  return [
    '## Core-subset phase (last structural attempt)',
    '',
    'Full-12 `tally` is the scope-weighted life tally. `coreTally` uses saju / ziwei / prism / numerology / ninestar, confidence weight only, no scope multiplier. Era-only is saju + ziwei. Verdict columns are hypothetical (PHASE_CONSENSUS_MIN/PHASE_LEAN_MIN) for reporting only — not in public output.',
    '',
    '| Lens | mean leader | 35–44% band | consensus@60 | lean@45 | split | unanimity (≥2) | 50/50 voters (≥2) |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    `| full-12 (life) | ${fullMean.toFixed(1)}% | ${(fullCluster * 100).toFixed(1)}% | ${pct(life.verdictCounts.consensus, totalN)} | ${pct(life.verdictCounts.lean, totalN)} | ${pct(life.verdictCounts.split, totalN)} | — | — |`,
    `| core (era+annual) | ${coreMean.toFixed(1)}% | ${(coreCluster * 100).toFixed(1)}% | ${pct(combinedCore.verdictCounts.consensus, combinedCore.n)} | ${pct(combinedCore.verdictCounts.lean, combinedCore.n)} | ${pct(combinedCore.verdictCounts.split, combinedCore.n)} | ${pct(combinedCore.unanimityCount, combinedCore.nWithTwoPlus)} | ${pct(combinedCore.fiftyFiftyVoterCount, combinedCore.nWithTwoPlus)} |`,
    `| era-only (saju+ziwei) | ${eraMean.toFixed(1)}% | ${(eraCluster * 100).toFixed(1)}% | ${pct(combinedEra.verdictCounts.consensus, combinedEra.n)} | ${pct(combinedEra.verdictCounts.lean, combinedEra.n)} | ${pct(combinedEra.verdictCounts.split, combinedEra.n)} | ${pct(combinedEra.unanimityCount, combinedEra.nWithTwoPlus)} | ${pct(combinedEra.fiftyFiftyVoterCount, combinedEra.nWithTwoPlus)} |`,
    '',
    ...renderSubsetExperiment('coreTally — era + annual (5 systems)', PHASE_CORE_SYSTEMS, combinedCore),
    ...renderSubsetExperiment('era-only — saju + ziwei', PHASE_ERA_CORE_SYSTEMS, combinedEra),
  ]
}

function renderScopeComparisonTable(totalN: number): string[] {
  const rowFor = (scope: ReadingScope): string => {
    const s = combinedPhaseByScope[scope]
    return `| ${scope} | ${(s.leaderShareSum / totalN).toFixed(1)}% | ${pct(s.verdictCounts.consensus, totalN)} | ${pct(s.verdictCounts.lean, totalN)} | ${pct(s.verdictCounts.split, totalN)} | ${pct(s.polarizedCount, totalN)} | ${(clusterShare35to44(s, totalN) * 100).toFixed(1)}% |`
  }
  return [
    '## Phase by readingScope (summary)',
    '',
    '| Scope | mean leader | consensus | lean | split | polarized | 35–44% band |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...READING_SCOPES.map(rowFor),
    '',
  ]
}

function renderCombinedElementSupply(koStats: RunStats, enStats: RunStats, totalN: number): string[] {
  const combinedSupply = mergeElementSupply(koStats.elementSupply, enStats.elementSupply)
  const combinedStats: RunStats = {
    ...koStats,
    n: totalN,
    aggregateElementTotalSum: ELEMENT_AXES.reduce(
      (acc, axis) => {
        acc[axis] = koStats.aggregateElementTotalSum[axis] + enStats.aggregateElementTotalSum[axis]
        return acc
      },
      { wood: 0, fire: 0, earth: 0, metal: 0, water: 0 },
    ),
  }
  return [
    '## Element supply by projector (combined ko + en)',
    '',
    'Mean element vector each projector contributes (weighted by its element confidence), plus aggregate consensus totals.',
    '',
    ...renderElementSupply(combinedStats, combinedSupply),
    '',
  ]
}

const lines: string[] = [
  '# Axis-layer consensus distribution',
  '',
  `Synthetic N = ${N_SUBJECTS.toLocaleString()} subjects, run TWICE (locale \`ko\` and locale \`en\`) = ${totalN.toLocaleString()} subject-runs total.`,
  '',
  '- birth datetime: year uniform 1950–2010, month/day uniform (leap years handled), time of day uniform HH:mm',
  '- 10% of subjects have an unknown birth time (`time: null`), to exercise the degraded/unreadable paths',
  '- timezone: uniform over `Asia/Seoul`, `Asia/Tokyo`, `America/New_York`',
  '- sex: uniform male/female; MBTI: uniform over the 16 types; colors: 3 distinct, uniform over the 24 PRISM colors; microCheck: 4 uniform integers 1–5',
  '- tarot: 3-card spread, uniform distinct positions 1–78; runes: 3 drawn from the 24 Elder Futhark; iching: standard 6-line coin draw — all from per-subject seeded draws (no shared seed across subjects)',
  '- numerology `latinName`: present for 70% of subjects (to exercise the expression-number blend vs. life-path-only fallback), independent of locale',
  '- locale \`ko\`: random single-character Korean surname + 2-syllable given name (valid Hangul syllables) → `name` projector active. locale \`en\`: random English name → `name` projector `supported: false` (`name.locale_unsupported`)',
  `- \`atDate\` fixed at **${AT_DATE}**`,
  '- phase consensus computed three times per subject: `readingScope` life / today / question (timescale weights in conventions.ts)',
  '- this run also records `coreTally` (era+annual subset) and an era-only (saju+ziwei) subset. Verdict columns in the report are hypothetical (PHASE_CONSENSUS_MIN/PHASE_LEAN_MIN), not public output.',
  '',
  `Elapsed: ko ${((tKo - t0) / 1000).toFixed(1)}s, en ${((tEn - tKo) / 1000).toFixed(1)}s, total ${((tEn - t0) / 1000).toFixed(1)}s.`,
  '',
  ...renderCoreVsFull(totalN),
  ...renderBeforeAfter(totalN),
  '## Phase by readingScope',
  '',
  ...READING_SCOPES.flatMap((scope) => renderScopePhaseSection(scope, combinedPhaseByScope[scope], totalN)),
  ...renderScopeComparisonTable(totalN),
  ...renderCombinedElementSupply(koStats, enStats, totalN),
  ...renderRunReport(koStats),
  ...renderRunReport(enStats),
]

const outPath = resolve(process.cwd(), 'docs/oracle-consensus-distribution.md')
writeFileSync(outPath, lines.join('\n'), 'utf8')
console.log(`wrote ${outPath}`)
console.log(`full-12 life: meanLeader=${(combinedPhaseByScope.life.leaderShareSum / totalN).toFixed(1)}%`)
console.log(`core: meanLeader=${(combinedCore.leaderShareSum / combinedCore.n).toFixed(1)}% unanimity=${pct(combinedCore.unanimityCount, combinedCore.nWithTwoPlus)} fiftyFifty=${pct(combinedCore.fiftyFiftyVoterCount, combinedCore.nWithTwoPlus)}`)
console.log(`era: meanLeader=${(combinedEra.leaderShareSum / combinedEra.n).toFixed(1)}% unanimity=${pct(combinedEra.unanimityCount, combinedEra.nWithTwoPlus)} fiftyFifty=${pct(combinedEra.fiftyFiftyVoterCount, combinedEra.nWithTwoPlus)}`)
