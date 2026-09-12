/**
 * 궁합 (compatibility) calculation stage — the kind='compat' sibling of
 * compute.ts, run synchronously inside the create request.
 *
 * Person A is the saved subject profile. Person B exists ONLY as
 * session_inputs.partner (see session-inputs.ts) — never a profile row.
 *
 * Per-system rule, decided from what each tradition actually has:
 *   NATIVE pair function ...... astro synastry, sukuyou 三九の秘法,
 *                               PRISM prismPairSketch (concordance)
 *   PRINCIPLED derivation ..... saju (일간 천간합 + 일지/띠 육합·삼합·충·원진 +
 *                               오행 보완), ziwei (명궁 지지 관계 + 부부궁 주성),
 *                               numerology (관계수 = reduce(LP_A + LP_B)),
 *                               name (인격 오행 상생·상극 + 총격), ninestar
 *                               (본명성 오행 관계)
 *   THE DRAW IS THE RELATIONSHIP tarot / runes / iching — one draw, the
 *                               position labels renamed to relationship roles
 *                               (본인·상대·두 사람 사이…), 세효=본인 응효=상대
 *   NO PAIR RULE .............. tzolkin — both portraits are read side by
 *                               side; it casts NO vote (all-null AxisVote,
 *                               machine code tzolkin.no_pair_rule) because
 *                               inventing a Maya pair score would be fiction.
 *
 * Vote shape: for person-systems each side is projected with the NORMAL
 * projector, then the two votes are blended (mean per space, weight 0.5,
 * basis 'derived') and the pair-relation reason codes are appended. Draw
 * votes pass through untouched — the draw already IS the relationship.
 */
import { computeConsensus, projectAstro, projectIching, projectMaya, projectName, projectNineStar, projectNumerology, projectRune, projectSaju, projectSukuyou, projectTarot, projectZiwei } from '../axes'
import { HALF_WEIGHT, phaseConfidence } from '../axes/conventions'
import { clampTraits, emptyElements, normalizeElements, normalizePhase } from '../axes/math'
import { PRISM_CYCLE_PHASE } from '../axes/tables'
import type { AxisVote, ElementAxis, TraitVector, UnreadableEntry } from '../axes/types'
import { type SystemId } from '../axes/types'
import { natalChart, synastry, type CrossAspect, type NatalChart } from '../engines/astro'
import {
  branchPairRelation,
  elementPairRelation,
  fiveElementBalance,
  fourPillars,
  greatLuck,
  nineStar,
  stemCombination,
  sukuyou,
  sukuyouRelation,
  tenGods,
  tzolkin,
} from '../engines/calendar'
import type { FiveElement, SukuyouRelationPair } from '../engines/calendar/types'
import { buildLiuyao, ichingDraw, runeDraw, tarotDraw } from '../engines/draw'
import { COMPAT_RUNE_LABELS, COMPAT_TAROT_LABELS } from '../engines/draw/conventions'
import { nameReading } from '../engines/name'
import { numerology, reducePythagorean } from '../engines/numerology'
import { PRISM_ENGINE_VERSION, prismPairSketch } from '../engines/prism'
import { ziweiChart } from '../engines/ziwei'
import type { OracleProfile } from '../schema'
import {
  ORACLE_DEFAULT_COORDS,
  ORACLE_DEFAULT_TIMEZONE,
  ORACLE_RUNE_COUNT,
  ORACLE_RUNE_POOL_SIZE,
  ORACLE_TAROT_DECK_SIZE,
  ORACLE_TAROT_SPREAD,
  readingScopeForSession,
} from './conventions'
import {
  derivePickedPositions,
  drawSeed,
  ichingClockFromAsOf,
  nominalAgeFrom,
  OracleComputeError,
  readIchingLines,
  readRuneInputs,
  readTarotInputs,
  splitNameParts,
  toClock,
  type ComputeAssumptions,
  type ComputedSystem,
  type ComputeOutput,
} from './compute'
import { buildNativeChart } from './native-chart'
import {
  astroCompatSideChart,
  astroRelationChart,
  ICHING_COMPAT_NOTE,
  nameRelationChart,
  ninestarRelationChart,
  numerologyRelationChart,
  pairChart,
  prismCompatChart,
  sajuRelationChart,
  sukuyouRelationChart,
  tzolkinCompatChart,
  ziweiCompatSideChart,
  ziweiRelationChart,
  type AstroPairRelation,
  type NamePairRelation,
  type NineStarPairRelation,
  type NumerologyPairRelation,
  type SajuPairRelation,
  type SukuyouPairRelation,
  type ZiweiPairRelation,
} from './native-chart-compat'
import { buildCompatReadingPayload, type PayloadContext } from './payload'
import type { PersonalData } from './privacy'
import type { OracleCompatPartnerInput, OracleSessionInputs } from './session-inputs'
import type { JsonObject } from './types'

/** Systems offered in 단일 궁합. Tzolkin is excluded: no pair rule exists. */
export const COMPAT_SINGLE_SYSTEMS = [
  'saju',
  'astro',
  'prism',
  'ziwei',
  'numerology',
  'name',
  'iching',
  'tarot',
  'runes',
  'ninestar',
  'sukuyou',
] as const satisfies readonly SystemId[]

export function isCompatSingleSystem(system: string): boolean {
  return (COMPAT_SINGLE_SYSTEMS as readonly string[]).includes(system)
}

export type CompatComputeInput = {
  profile: OracleProfile
  partner: OracleCompatPartnerInput
  systems: SystemId[]
  seed: string
  asOfDate: string
  locale: string
  question: string | null
  sessionInputs: OracleSessionInputs | null
  /** Needle set covering the subject AND Person B (personalDataFrom). */
  personalData: PersonalData
}

type PersonCtx = {
  date: string
  time: string | null
  timeExact: boolean
  tz: string
  lat: number
  lng: number
  sex: 'male' | 'female'
  latinName: string | null
  nameParts: { surname: string; givenName: string } | null
}

function jsonObject(value: object): JsonObject {
  return value as JsonObject
}

/* ------------------------------------------------------------------ */
/* Vote blending                                                       */
/* ------------------------------------------------------------------ */

function meanRecord<K extends string>(a: Record<K, number>, b: Record<K, number>): Record<K, number> {
  const out = {} as Record<K, number>
  for (const key of Object.keys(a) as K[]) out[key] = (a[key] + b[key]) / 2
  return out
}

/**
 * Blend the two personal votes into one pair vote: mean per space where both
 * sides read it, unreadable where either side is blank. Confidence drops to
 * 0.5/'derived' — a blended vote must never outweigh a native one.
 */
export function blendPairVotes(
  system: SystemId,
  a: AxisVote,
  b: AxisVote,
  relationReasons: string[],
): AxisVote {
  const traits = a.traits && b.traits ? clampTraits(meanRecord(a.traits, b.traits)) : null
  const elements = a.elements && b.elements ? normalizeElements(meanRecord(a.elements, b.elements)) : null
  const phase = a.phase && b.phase ? normalizePhase(meanRecord(a.phase, b.phase)) : null

  const unreadable: UnreadableEntry[] = []
  if (!traits) unreadable.push({ space: 'traits', code: 'compat.side_unreadable' })
  if (!elements) unreadable.push({ space: 'elements', code: 'compat.side_unreadable' })
  if (!phase) unreadable.push({ space: 'phase', code: 'compat.side_unreadable' })

  const mergeReasons = (l?: string[], r?: string[], extra: string[] = []): string[] => {
    const out: string[] = []
    for (const code of [...(l ?? []).slice(0, 2), ...(r ?? []).slice(0, 2), ...extra]) {
      if (!out.includes(code)) out.push(code)
    }
    return out.slice(0, 6)
  }

  return {
    system,
    traits,
    elements,
    phase,
    confidence: {
      traits: traits ? { weight: HALF_WEIGHT, basis: 'derived' } : null,
      elements: elements ? { weight: HALF_WEIGHT, basis: 'derived' } : null,
      phase: phase ? phaseConfidence(system, HALF_WEIGHT, 'derived') : null,
    },
    unreadable,
    reasons: {
      traits: mergeReasons(a.reasons.traits, b.reasons.traits, relationReasons),
      elements: mergeReasons(a.reasons.elements, b.reasons.elements, relationReasons),
      phase: mergeReasons(a.reasons.phase, b.reasons.phase),
    },
    engineVersion: a.engineVersion,
  }
}

/* ------------------------------------------------------------------ */
/* Pair relations (typed, stored in oracle_computations.result)        */
/* ------------------------------------------------------------------ */

const FIVE_ELEMENTS: readonly FiveElement[] = ['wood', 'fire', 'earth', 'metal', 'water']

function missingElements(balance: Record<FiveElement, number>): FiveElement[] {
  return FIVE_ELEMENTS.filter((element) => (balance[element] ?? 0) === 0)
}

function strongElements(balance: Record<FiveElement, number>): FiveElement[] {
  return FIVE_ELEMENTS.filter((element) => (balance[element] ?? 0) >= 2)
}

function sajuRelationReasons(rel: SajuPairRelation): string[] {
  const reasons: string[] = [`compat.saju.stem_${rel.dayStem.elements}`]
  if (rel.dayStem.combination) reasons.push('compat.saju.stem_hap')
  const day = rel.dayBranch.relation
  if (day.yukhap) reasons.push('compat.saju.day_yukhap')
  if (day.samhap) reasons.push('compat.saju.day_samhap')
  if (day.chung) reasons.push('compat.saju.day_chung')
  if (day.wonjin) reasons.push('compat.saju.day_wonjin')
  const year = rel.yearBranch.relation
  if (year.yukhap) reasons.push('compat.saju.year_yukhap')
  if (year.samhap) reasons.push('compat.saju.year_samhap')
  if (year.chung) reasons.push('compat.saju.year_chung')
  if (year.wonjin) reasons.push('compat.saju.year_wonjin')
  return reasons
}

const SUKUYOU_PAIR_CODE: Record<SukuyouRelationPair, string> = {
  命: 'myeong',
  業胎: 'eoptae',
  栄親: 'yeongchin',
  友衰: 'usoe',
  安壊: 'angoe',
  危成: 'wiseong',
}

/** Core synastry bodies: luminaries + the two classical relationship planets. */
const SYNASTRY_CORE_BODIES: ReadonlySet<string> = new Set(['Sun', 'Moon', 'Venus', 'Mars'])
const SYNASTRY_ASPECT_CAP = 12

export function prioritizeSynastryAspects(aspects: readonly CrossAspect[], cap = SYNASTRY_ASPECT_CAP): CrossAspect[] {
  return [...aspects]
    .sort((left, right) => {
      const leftScore =
        (SYNASTRY_CORE_BODIES.has(left.a) ? 1 : 0) + (SYNASTRY_CORE_BODIES.has(left.b) ? 1 : 0)
      const rightScore =
        (SYNASTRY_CORE_BODIES.has(right.a) ? 1 : 0) + (SYNASTRY_CORE_BODIES.has(right.b) ? 1 : 0)
      if (leftScore !== rightScore) return rightScore - leftScore
      return left.orb - right.orb
    })
    .slice(0, cap)
}

/* ------------------------------------------------------------------ */
/* Per-system pair computation                                         */
/* ------------------------------------------------------------------ */

type Shared = {
  asOfDate: string
  locale: string
  seed: string
  sessionInputs: OracleSessionInputs | null
}

type CompatOutcome =
  | { vote: AxisVote; result: JsonObject; chart: JsonObject }
  | { unreadableCode: string }

function computeCompatSystem(system: SystemId, a: PersonCtx, b: PersonCtx, shared: Shared): CompatOutcome {
  const { asOfDate, locale, seed } = shared
  const chartCtxA = { locale, nominalAge: nominalAgeFrom(a.date, asOfDate) }
  const chartCtxB = { locale, nominalAge: nominalAgeFrom(b.date, asOfDate) }

  switch (system) {
    case 'saju': {
      const pillarsA = fourPillars({ date: a.date, time: a.time, timezone: a.tz })
      const pillarsB = fourPillars({ date: b.date, time: b.time, timezone: b.tz })
      const balanceA = fiveElementBalance(pillarsA)
      const balanceB = fiveElementBalance(pillarsB)
      const luckA = a.time === null ? null : greatLuck({ date: a.date, time: a.time, timezone: a.tz, sex: a.sex })
      const luckB = b.time === null ? null : greatLuck({ date: b.date, time: b.time, timezone: b.tz, sex: b.sex })

      const relation: SajuPairRelation = {
        dayStem: {
          a: pillarsA.day.stem,
          b: pillarsB.day.stem,
          combination: stemCombination(pillarsA.day.stem.index, pillarsB.day.stem.index),
          elements: elementPairRelation(pillarsA.day.stem.element, pillarsB.day.stem.element),
        },
        dayBranch: {
          a: pillarsA.day.branch,
          b: pillarsB.day.branch,
          relation: branchPairRelation(pillarsA.day.branch.index, pillarsB.day.branch.index),
        },
        yearBranch: {
          a: pillarsA.year.branch,
          b: pillarsB.year.branch,
          relation: branchPairRelation(pillarsA.year.branch.index, pillarsB.year.branch.index),
        },
        complement: {
          aMissing: missingElements(balanceA),
          filledByB: missingElements(balanceA).filter((element) => strongElements(balanceB).includes(element)),
          bMissing: missingElements(balanceB),
          filledByA: missingElements(balanceB).filter((element) => strongElements(balanceA).includes(element)),
        },
      }

      const sideA = {
        pillars: jsonObject(pillarsA),
        fiveElements: jsonObject(balanceA),
        tenGods: jsonObject(tenGods(pillarsA.day.stem, pillarsA)),
        greatLuck: luckA ? jsonObject(luckA) : null,
      }
      const sideB = {
        pillars: jsonObject(pillarsB),
        fiveElements: jsonObject(balanceB),
        tenGods: jsonObject(tenGods(pillarsB.day.stem, pillarsB)),
        greatLuck: luckB ? jsonObject(luckB) : null,
      }

      const voteA = projectSaju({ date: a.date, time: a.time, timezone: a.tz, sex: a.sex, asOfDate })
      const voteB = projectSaju({ date: b.date, time: b.time, timezone: b.tz, sex: b.sex, asOfDate })
      return {
        vote: blendPairVotes('saju', voteA, voteB, sajuRelationReasons(relation)),
        result: { pair: true, a: sideA, b: sideB, relation: jsonObject(relation) },
        chart: pairChart({
          relation: sajuRelationChart(relation),
          a: buildNativeChart('saju', sideA, chartCtxA),
          b: buildNativeChart('saju', sideB, chartCtxB),
        }),
      }
    }

    case 'astro': {
      const asOf = { date: asOfDate, time: '12:00', tz: a.tz }
      const natalA: NatalChart = natalChart({
        date: a.date, time: a.time, tz: a.tz, lat: a.lat, lng: a.lng, timeKnown: a.timeExact,
      })
      const natalB: NatalChart = natalChart({
        date: b.date, time: b.time, tz: b.tz, lat: b.lat, lng: b.lng, timeKnown: b.timeExact,
      })
      const pair = synastry({ chartA: natalA, chartB: natalB })
      const relation: AstroPairRelation = {
        aspects: prioritizeSynastryAspects(pair.aspects),
        totalAspects: pair.aspects.length,
      }
      const voteA = projectAstro({ date: a.date, time: a.time, tz: a.tz, lat: a.lat, lng: a.lng, timeKnown: a.timeExact, asOf })
      const voteB = projectAstro({ date: b.date, time: b.time, tz: b.tz, lat: b.lat, lng: b.lng, timeKnown: b.timeExact, asOf })
      return {
        vote: blendPairVotes('astro', voteA, voteB, ['compat.astro.synastry']),
        result: {
          pair: true,
          a: { natal: jsonObject(natalA) },
          b: { natal: jsonObject(natalB) },
          relation: jsonObject(relation),
        },
        chart: pairChart({
          relation: astroRelationChart(relation),
          // Houses only for A — B's location is assumed, houses would be fiction.
          a: astroCompatSideChart(natalA, true),
          b: astroCompatSideChart(natalB, false),
        }),
      }
    }

    case 'prism': {
      // Native pair entry point — deliberately needs NO MBTI and NO colours.
      const sketch = prismPairSketch({ birthDateA: a.date, birthDateB: b.date, atDate: asOfDate })

      const traits = clampTraits(meanRecord(sketch.anchorA as TraitVector, sketch.anchorB as TraitVector))
      const elementsRaw = emptyElements(0)
      elementsRaw[sketch.a.seasonElement.toLowerCase() as ElementAxis] += 50
      elementsRaw[sketch.b.seasonElement.toLowerCase() as ElementAxis] += 50
      const elements = normalizeElements(elementsRaw)
      const phaseRaw = { advance: 0, hold: 0, release: 0 }
      phaseRaw[PRISM_CYCLE_PHASE[sketch.a.annualCycle.id]] += 50
      phaseRaw[PRISM_CYCLE_PHASE[sketch.b.annualCycle.id]] += 50
      const phase = normalizePhase(phaseRaw)

      const concordanceBand =
        sketch.anchorConcordance >= 67 ? 'high' : sketch.anchorConcordance >= 34 ? 'mid' : 'low'
      const vote: AxisVote = {
        system: 'prism',
        traits,
        elements,
        phase,
        confidence: {
          traits: { weight: HALF_WEIGHT, basis: 'derived' },
          elements: elements ? { weight: HALF_WEIGHT, basis: 'derived' } : null,
          phase: phase ? phaseConfidence('prism', HALF_WEIGHT, 'derived') : null,
        },
        unreadable: [
          ...(elements ? [] : [{ space: 'elements', code: 'prism.no_element_reading' } as UnreadableEntry]),
          ...(phase ? [] : [{ space: 'phase', code: 'prism.no_phase_reading' } as UnreadableEntry]),
        ],
        reasons: {
          traits: [`compat.prism.concordance_${concordanceBand}`, 'compat.prism.birth_anchor'],
          elements: [`compat.prism.season_${sketch.relationForA.toLowerCase()}`],
          phase: [sketch.sameAnnualCycle ? 'compat.prism.annual_cycle_match' : 'compat.prism.annual_cycle_offset'],
        },
        engineVersion: PRISM_ENGINE_VERSION,
      }
      return {
        vote,
        result: { pair: true, sketch: jsonObject(sketch) },
        chart: prismCompatChart(sketch),
      }
    }

    case 'ziwei': {
      // 명궁 needs a birth hour on BOTH sides. Degrade honestly, per side.
      if (a.time === null) return { unreadableCode: 'ziwei.no_birth_time' }
      if (b.time === null) return { unreadableCode: 'compat.ziwei.partner_no_birth_time' }
      const inputA = { birthDate: a.date, birthTime: a.time, tz: a.tz, sex: a.sex, atDate: asOfDate }
      const inputB = { birthDate: b.date, birthTime: b.time, tz: b.tz, sex: b.sex, atDate: asOfDate }
      const chartA = ziweiChart(inputA)
      const chartB = ziweiChart(inputB)
      if (chartA.mingGong === null || chartB.mingGong === null) {
        return { unreadableCode: 'compat.ziwei.no_ming_gong' }
      }

      const spouseMajorsOf = (
        palaces: ReadonlyArray<{ name: string; stars: ReadonlyArray<{ name: string; category: string }> }>,
      ): string[] => {
        const palace = palaces.find((row) => row.name === '夫妻')
        return palace ? palace.stars.filter((star) => star.category === 'major').map((star) => star.name) : []
      }
      const majorsA = spouseMajorsOf(chartA.palaces)
      const majorsB = spouseMajorsOf(chartB.palaces)

      const relation: ZiweiPairRelation = {
        ming: {
          aBranch: chartA.mingGong.branch,
          bBranch: chartB.mingGong.branch,
          relation: branchPairRelation(chartA.mingGong.index, chartB.mingGong.index),
        },
        spouseMajorsA: majorsA,
        spouseMajorsB: majorsB,
      }
      const ming = relation.ming.relation
      const mingReasons = [
        ...(ming.yukhap ? ['compat.ziwei.ming_yukhap'] : []),
        ...(ming.samhap ? ['compat.ziwei.ming_samhap'] : []),
        ...(ming.chung ? ['compat.ziwei.ming_chung'] : []),
        ...(ming.wonjin ? ['compat.ziwei.ming_wonjin'] : []),
      ]

      const sideChart = (
        chart: {
          wuXingJu: { name: string } | null
          mingGong: { branch: string } | null
          daXian: { currentDaXian: { palaceName: string; ageFrom: number; ageTo: number } | null } | null
        },
        majors: string[],
      ): JsonObject =>
        ziweiCompatSideChart({
          wuXingJu: chart.wuXingJu?.name ?? null,
          mingBranch: chart.mingGong?.branch ?? '',
          spouseMajors: majors,
          currentDaXian: chart.daXian?.currentDaXian
            ? {
                palaceName: chart.daXian.currentDaXian.palaceName,
                ageFrom: chart.daXian.currentDaXian.ageFrom,
                ageTo: chart.daXian.currentDaXian.ageTo,
              }
            : null,
        })

      return {
        vote: blendPairVotes(
          'ziwei',
          projectZiwei(inputA),
          projectZiwei(inputB),
          mingReasons.length > 0 ? mingReasons : ['compat.ziwei.ming_plain'],
        ),
        result: {
          pair: true,
          a: { chart: jsonObject(chartA) },
          b: { chart: jsonObject(chartB) },
          relation: jsonObject(relation),
        },
        chart: pairChart({
          relation: ziweiRelationChart(relation),
          a: sideChart(chartA, majorsA),
          b: sideChart(chartB, majorsB),
        }),
      }
    }

    case 'numerology': {
      const numbersA = numerology({ birthDate: a.date, latinName: a.latinName, atDate: asOfDate })
      const numbersB = numerology({ birthDate: b.date, latinName: b.latinName, atDate: asOfDate })
      const relation: NumerologyPairRelation = {
        lifePathA: numbersA.lifePath,
        lifePathB: numbersB.lifePath,
        relationshipNumber: reducePythagorean(numbersA.lifePath + numbersB.lifePath),
        personalYearA: numbersA.personalYear,
        personalYearB: numbersB.personalYear,
      }
      return {
        vote: blendPairVotes(
          'numerology',
          projectNumerology({ birthDate: a.date, latinName: a.latinName, atDate: asOfDate }),
          projectNumerology({ birthDate: b.date, latinName: b.latinName, atDate: asOfDate }),
          [`compat.numerology.relationship_${relation.relationshipNumber}`],
        ),
        result: {
          pair: true,
          a: { numbers: jsonObject(numbersA) },
          b: { numbers: jsonObject(numbersB) },
          relation: jsonObject(relation),
        },
        chart: pairChart({
          relation: numerologyRelationChart(relation),
          a: buildNativeChart('numerology', { numbers: jsonObject(numbersA) }, chartCtxA),
          b: buildNativeChart('numerology', { numbers: jsonObject(numbersB) }, chartCtxB),
        }),
      }
    }

    case 'name': {
      if (!a.nameParts) return { unreadableCode: 'name.no_name_on_profile' }
      if (!b.nameParts) return { unreadableCode: 'compat.name.partner_name_missing' }
      const readingA = nameReading({ ...a.nameParts, locale })
      const readingB = nameReading({ ...b.nameParts, locale })
      if (!readingA.supported || !readingB.supported || !readingA.fiveElements || !readingB.fiveElements || !readingA.numerology81 || !readingB.numerology81) {
        return { unreadableCode: 'compat.name.unsupported_locale' }
      }
      const relation: NamePairRelation = {
        inGyeok: {
          aElement: readingA.fiveElements.in,
          bElement: readingB.fiveElements.in,
          relation: elementPairRelation(readingA.fiveElements.in, readingB.fiveElements.in),
        },
        chongA: readingA.numerology81.chong,
        chongB: readingB.numerology81.chong,
      }
      return {
        vote: blendPairVotes(
          'name',
          projectName({ ...a.nameParts, locale }),
          projectName({ ...b.nameParts, locale }),
          [`compat.name.in_${relation.inGyeok.relation}`],
        ),
        result: {
          pair: true,
          a: { reading: jsonObject(readingA) },
          b: { reading: jsonObject(readingB) },
          relation: jsonObject(relation),
        },
        chart: pairChart({
          relation: nameRelationChart(relation),
          a: buildNativeChart('name', { reading: jsonObject(readingA) }, chartCtxA),
          b: buildNativeChart('name', { reading: jsonObject(readingB) }, chartCtxB),
        }),
      }
    }

    case 'iching': {
      const ichingSeed = drawSeed(seed, 'iching')
      const lines = readIchingLines(shared.sessionInputs)
      const clock = ichingClockFromAsOf(asOfDate, a.tz)
      const draw = lines
        ? buildLiuyao({ seed: ichingSeed, values: lines, ...clock })
        : ichingDraw({ seed: ichingSeed, ...clock })
      const result = { draw: jsonObject(draw) }
      const native = buildNativeChart('iching', result, chartCtxA)
      const chartLines = Array.isArray(native.효) ? native.효 : []
      const roleLine = (position: unknown) =>
        chartLines.find((line) => {
          return (
            line !== null &&
            typeof line === 'object' &&
            !Array.isArray(line) &&
            (line as { 위치?: unknown }).위치 === position
          )
        }) ?? null
      return {
        vote: projectIching({ seed: ichingSeed, values: lines ?? undefined }),
        result,
        chart: {
          ...native,
          세응풀이: ICHING_COMPAT_NOTE,
          본인세효: roleLine(native.세효),
          상대응효: roleLine(native.응효),
        },
      }
    }

    case 'tarot': {
      const tarotSeed = drawSeed(seed, 'tarot')
      const inputs = readTarotInputs(shared.sessionInputs)
      const spread = inputs?.spread ?? ORACLE_TAROT_SPREAD
      const pickedPositions = inputs?.pickedPositions ?? derivePickedPositions(tarotSeed, spread, ORACLE_TAROT_DECK_SIZE)
      const draw = tarotDraw({ seed: tarotSeed, spread, pickedPositions })
      const labels = COMPAT_TAROT_LABELS[spread]
      const cards = draw.cards.map((card, index) => ({
        ...card,
        positionLabel: labels?.[index] ?? card.positionLabel,
      }))
      const result = { draw: { ...jsonObject(draw), cards: cards.map(jsonObject) } }
      return {
        vote: projectTarot({ seed: tarotSeed, spread, pickedPositions }),
        result,
        chart: buildNativeChart('tarot', result, chartCtxA),
      }
    }

    case 'runes': {
      const runesSeed = drawSeed(seed, 'runes')
      const inputs = readRuneInputs(shared.sessionInputs)
      const spread = inputs?.spread ?? ORACLE_RUNE_COUNT
      const pickedPositions = inputs?.pickedPositions ?? derivePickedPositions(runesSeed, spread, ORACLE_RUNE_POOL_SIZE)
      const draw = runeDraw({ seed: runesSeed, count: spread, pickedPositions })
      const labels = COMPAT_RUNE_LABELS[spread]
      const runes = draw.runes.map((rune, index) => ({
        ...rune,
        positionLabel: labels?.[index] ?? rune.positionLabel,
      }))
      const result = { draw: { ...jsonObject(draw), runes: runes.map(jsonObject) } }
      return {
        vote: projectRune({ seed: runesSeed, count: spread, pickedPositions }),
        result,
        chart: buildNativeChart('runes', result, chartCtxA),
      }
    }

    case 'ninestar': {
      const natalA = nineStar({ date: a.date, time: a.time, timezone: a.tz })
      const natalB = nineStar({ date: b.date, time: b.time, timezone: b.tz })
      const current = nineStar({ date: asOfDate, time: '12:00', timezone: a.tz })
      const relation: NineStarPairRelation = {
        a: natalA.year,
        b: natalB.year,
        relation: elementPairRelation(natalA.year.element, natalB.year.element),
      }
      const sideA = { natal: jsonObject(natalA), current: jsonObject(current) }
      const sideB = { natal: jsonObject(natalB), current: jsonObject(current) }
      return {
        vote: blendPairVotes(
          'ninestar',
          projectNineStar({ date: a.date, time: a.time, timezone: a.tz, atDate: asOfDate }),
          projectNineStar({ date: b.date, time: b.time, timezone: b.tz, atDate: asOfDate }),
          [`compat.ninestar.${relation.relation}`],
        ),
        result: { pair: true, a: sideA, b: sideB, relation: jsonObject(relation) },
        chart: pairChart({
          relation: ninestarRelationChart(relation),
          a: buildNativeChart('ninestar', sideA, chartCtxA),
          b: buildNativeChart('ninestar', sideB, chartCtxB),
        }),
      }
    }

    case 'sukuyou': {
      const natalA = sukuyou({ date: a.date, time: a.time, timezone: a.tz })
      const natalB = sukuyou({ date: b.date, time: b.time, timezone: b.tz })
      const current = sukuyou({ date: asOfDate, time: '12:00', timezone: a.tz })
      const relation: SukuyouPairRelation = {
        fromA: sukuyouRelation(natalA.index, natalB.index),
        fromB: sukuyouRelation(natalB.index, natalA.index),
      }
      const sideA = { natal: jsonObject(natalA), current: jsonObject(current) }
      const sideB = { natal: jsonObject(natalB), current: jsonObject(current) }
      return {
        vote: blendPairVotes(
          'sukuyou',
          projectSukuyou({ birthDate: a.date, birthTime: a.time, tz: a.tz, atDate: asOfDate }),
          projectSukuyou({ birthDate: b.date, birthTime: b.time, tz: b.tz, atDate: asOfDate }),
          [`compat.sukuyou.pair_${SUKUYOU_PAIR_CODE[relation.fromA.pair]}`],
        ),
        result: { pair: true, a: sideA, b: sideB, relation: jsonObject(relation) },
        chart: pairChart({
          relation: sukuyouRelationChart(relation),
          a: buildNativeChart('sukuyou', sideA, chartCtxA),
          b: buildNativeChart('sukuyou', sideB, chartCtxB),
        }),
      }
    }

    case 'tzolkin': {
      // No pair rule in the tradition. Both portraits are READ side by side,
      // but the system casts NO vote: all three spaces unreadable, and the
      // consensus map shows it as such rather than a fabricated score.
      const natalA = tzolkin({ date: a.date })
      const natalB = tzolkin({ date: b.date })
      const current = tzolkin({ date: asOfDate })
      const sideA = { natal: jsonObject(natalA), current: jsonObject(current) }
      const sideB = { natal: jsonObject(natalB), current: jsonObject(current) }
      const engineVersion = projectMaya({ birthDate: a.date, atDate: asOfDate }).engineVersion
      const vote: AxisVote = {
        system: 'tzolkin',
        traits: null,
        elements: null,
        phase: null,
        confidence: { traits: null, elements: null, phase: null },
        unreadable: [
          { space: 'traits', code: 'tzolkin.no_pair_rule' },
          { space: 'elements', code: 'tzolkin.no_pair_rule' },
          { space: 'phase', code: 'tzolkin.no_pair_rule' },
        ],
        reasons: {},
        engineVersion,
      }
      return {
        vote,
        result: { pair: true, a: sideA, b: sideB },
        chart: tzolkinCompatChart(
          buildNativeChart('tzolkin', sideA, chartCtxA),
          buildNativeChart('tzolkin', sideB, chartCtxB),
        ),
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export function runCompatComputations(input: CompatComputeInput): ComputeOutput {
  const { profile, partner } = input
  const clock = toClock(profile.birth_time)
  const usableTime = profile.birth_time_source === 'unknown' ? null : clock

  const a: PersonCtx = {
    date: profile.birth_date,
    time: usableTime,
    timeExact: usableTime !== null && profile.birth_time_source === 'exact',
    tz: profile.tz ?? ORACLE_DEFAULT_TIMEZONE,
    lat: profile.lat ?? ORACLE_DEFAULT_COORDS.lat,
    lng: profile.lng ?? ORACLE_DEFAULT_COORDS.lng,
    sex: profile.sex === 'F' ? 'female' : 'male',
    latinName: profile.name_latin ?? null,
    nameParts: splitNameParts(profile.name_local, profile.name_hanja, profile.name_latin),
  }

  const partnerClock = toClock(partner.birthTime ?? null)
  const b: PersonCtx = {
    date: partner.birthDate,
    time: partnerClock,
    // A user-entered clock is treated as exact; there is no survey band here.
    timeExact: partnerClock !== null,
    // Person B has no saved location: subject's timezone + default coordinates.
    tz: a.tz,
    lat: ORACLE_DEFAULT_COORDS.lat,
    lng: ORACLE_DEFAULT_COORDS.lng,
    sex: partner.sex === 'F' ? 'female' : 'male',
    latinName: partner.name && /[A-Za-z]/.test(partner.name) ? partner.name : null,
    nameParts: partner.name ? splitNameParts(partner.name, null, null) : null,
  }

  const assumptions: ComputeAssumptions = {
    sexDefaulted: profile.sex === null,
    timezoneDefaulted: !profile.tz,
    coordinatesDefaulted: profile.lat === null || profile.lng === null,
    birthTimeUnknown: usableTime === null,
    birthTimeEstimated: usableTime !== null && profile.birth_time_source === 'estimated',
    partnerBirthTimeUnknown: partnerClock === null,
    partnerSexDefaulted: partner.sex == null,
    partnerLocationAssumed: true,
  }

  const readingScope = readingScopeForSession('compat', input.question !== null)
  const payloadContext: PayloadContext = {
    kind: 'compat',
    locale: input.locale,
    readingScope,
    asOfDate: input.asOfDate,
    question: input.question,
    nominalAge: nominalAgeFrom(profile.birth_date, input.asOfDate),
  }
  const shared: Shared = {
    asOfDate: input.asOfDate,
    locale: input.locale,
    seed: input.seed,
    sessionInputs: input.sessionInputs,
  }

  const systems: ComputedSystem[] = []
  const votes: AxisVote[] = []

  for (const system of input.systems) {
    let outcome: CompatOutcome
    try {
      outcome = computeCompatSystem(system, a, b, shared)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'unknown error'
      outcome = { unreadableCode: `${system}.engine_error:${message.slice(0, 120)}` }
    }

    if ('unreadableCode' in outcome) {
      systems.push({
        system,
        result: null,
        aiPayload: null,
        axes: null,
        engineVersion: null,
        vote: null,
        unreadableCode: outcome.unreadableCode,
      })
      continue
    }

    votes.push(outcome.vote)
    systems.push({
      system,
      result: outcome.result,
      aiPayload: buildCompatReadingPayload(outcome.vote, outcome.chart, payloadContext, input.personalData),
      axes: jsonObject(outcome.vote),
      engineVersion: outcome.vote.engineVersion,
      vote: outcome.vote,
      unreadableCode: null,
    })
  }

  // A voteless tzolkin still reads (its payload exists); a session where no
  // system produced even that has nothing to show and fails.
  if (systems.every((entry) => entry.aiPayload === null)) {
    throw new OracleComputeError('no_readable_system', 'no requested system produced a readable pair result')
  }

  return {
    systems,
    votes,
    consensus: computeConsensus(votes, { readingScope }),
    readingScope,
    assumptions,
  }
}
