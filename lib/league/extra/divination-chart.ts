/**
 * Divination seat chart — league layer only.
 *
 *   tech / politics / entertainment → 사주 연주·월주 of the subject
 *     (Wikidata birth / founding month) and of the resolution period
 *   real estate → 구성기학 年盤·月盤 for the reference month and the
 *     region's direction from the capital centre
 *
 * The chart reaches the oracle reader as a few colour lines appended to its
 * user prompt through a league-side `LeagueReaderCall`. The oracle's 4-system
 * code vote still owns the verdict, and no oracle file changes.
 */
import type { LeagueReaderCall } from '@/lib/oracle/league-divination/reader'
import { decodePropertyInstrument } from '../gateway/adapters/real-estate-catalog'
import { oracleCategoryFromLedger } from './divination'
import {
  boardHits,
  midMonthInstantMs,
  nineStarAt,
  oppositeBranch,
  pillarsAt,
  seoulYearMonth,
  starAt,
  yearMonthPillars,
} from './divination-calendar'
import {
  preferredLabel,
  type DivinationChart,
  type KigakuBoard,
  type KigakuChart,
  type KigakuHit,
  type SajuChart,
} from './divination-chart-types'
import { KIGAKU_ORIGIN_KO, propertyRegionDirection } from './divination-direction'
import { DIRECTION_KO, NINE_STAR_HANGUL, ganzhiHangul, type EarthlyBranch } from './divination-ganzhi'
import type { SajuCategory, SubjectBirth } from './divination-wikidata'
import { isRealEstateLedgerCategory } from './real-estate-category'

export type DivinationChartRound = {
  category: string
  instrument: string
  subject_label?: string | null
  resolves_at?: string | null
  opened_at?: string | null
  created_at?: string | null
}

export type DivinationChartDeps = {
  resolveSubject: (name: string, category: SajuCategory) => Promise<SubjectBirth | null>
}

const SAJU_CATEGORIES: readonly SajuCategory[] = ['tech', 'politics_election', 'entertainment']

export function sajuCategoryOf(ledgerCategory: string): SajuCategory | null {
  const oracle = oracleCategoryFromLedger(ledgerCategory)
  return (SAJU_CATEGORIES as readonly string[]).includes(oracle) ? (oracle as SajuCategory) : null
}

export function sajuChart(subject: SubjectBirth, periodAt: string): SajuChart | null {
  const pillars = yearMonthPillars(subject.yearMonth)
  const period = pillarsAt(periodAt)
  const periodYearMonth = seoulYearMonth(periodAt)
  if (!pillars || !period || !periodYearMonth) return null
  return {
    kind: 'saju',
    subject: {
      qid: subject.qid,
      kind: subject.kind,
      source: subject.source,
      yearMonth: subject.yearMonth,
      labels: subject.labels,
      ceo: subject.ceo,
    },
    pillars,
    period: { yearMonth: periodYearMonth, ...period },
  }
}

export function kigakuChartForInstrument(instrument: string): KigakuChart | null {
  const parts = decodePropertyInstrument(instrument)
  if (!parts) return null
  const placed = propertyRegionDirection(parts.country, parts.regionCode)
  const at = midMonthInstantMs(parts.refMonth)
  if (!placed || at == null) return null
  const stars = nineStarAt(at)
  if (!stars) return null
  const board = (center: number, branch: EarthlyBranch, scope: 'year' | 'month'): KigakuBoard => ({
    center,
    star: starAt(center, placed.direction),
    branch,
    hits: boardHits(center, branch, placed.direction, scope),
  })
  const year = board(stars.yearStar, stars.yearBranch, 'year')
  const month = board(stars.monthStar, stars.monthBranch, 'month')
  return {
    kind: 'kigaku',
    period: parts.refMonth,
    qiYear: stars.qiYear,
    origin: placed.origin,
    region: { country: parts.country, code: parts.regionCode, nameKo: parts.region.nameKo, nameEn: parts.region.nameEn },
    direction: placed.direction,
    year,
    month,
    clear: year.hits.length === 0 && month.hits.length === 0,
  }
}

/** Null when the round has no chart (other categories, unknown subject, unmapped region). */
export async function buildDivinationChart(
  round: DivinationChartRound,
  deps: DivinationChartDeps,
): Promise<DivinationChart | null> {
  if (isRealEstateLedgerCategory(round.category)) return kigakuChartForInstrument(round.instrument)
  const category = sajuCategoryOf(round.category)
  const name = round.subject_label?.trim()
  const periodAt = round.resolves_at || round.opened_at || round.created_at
  if (!category || !name || !periodAt) return null
  const subject = await deps.resolveSubject(name, category)
  return subject ? sajuChart(subject, periodAt) : null
}

const HIT_KO: Record<KigakuHit, string> = {
  gohwang: '오황살',
  amgeom: '암검살',
  sepa: '세파',
  wolpa: '월파',
}

const COLOUR_NOTE = '위 줄은 색채 참고용입니다. CODE VERDICT를 바꾸지 말고, 언급한다면 한 줄 이내로 짧게 쓰십시오.'

function hitKo(board: KigakuBoard, hit: KigakuHit): string {
  if ((hit === 'sepa' || hit === 'wolpa') && board.branch) {
    return `${HIT_KO[hit]}(${oppositeBranch(board.branch as EarthlyBranch)})`
  }
  return HIT_KO[hit]
}

function pillarKo(ganzhi: string): string {
  return ganzhiHangul(ganzhi) ?? ganzhi
}

export function divinationChartPromptLines(chart: DivinationChart): string[] {
  if (chart.kind === 'saju') {
    const ceo = chart.subject.source === 'ceo_birth' && chart.subject.ceo
      ? preferredLabel(chart.subject.ceo.labels, ['ko', 'en'])
      : null
    const basis = chart.subject.source === 'inception' ? '창립' : '출생'
    return [
      `대상 사주: ${ceo ? `${ceo}(현 CEO) ` : ''}${pillarKo(chart.pillars.year)}년 ${pillarKo(chart.pillars.month)}월 (${basis} ${chart.subject.yearMonth})`,
      `기간 사주: ${pillarKo(chart.period.year)}년 ${pillarKo(chart.period.month)}월 (판정 시점 ${chart.period.yearMonth})`,
      COLOUR_NOTE,
    ]
  }
  const head = `구성기학 (기간 ${chart.period}): 연반 중궁 ${NINE_STAR_HANGUL[chart.year.center - 1]}, 월반 중궁 ${NINE_STAR_HANGUL[chart.month.center - 1]}`
  const origin = KIGAKU_ORIGIN_KO[chart.origin]
  if (chart.direction === 'center') {
    return [head, `대상 방위: ${chart.region.nameKo} — ${origin} 그 자리(중궁). 방위 살 없음`, COLOUR_NOTE]
  }
  const hits = [
    ...chart.year.hits.map((hit) => `연반 ${hitKo(chart.year, hit)}`),
    ...chart.month.hits.map((hit) => `월반 ${hitKo(chart.month, hit)}`),
  ]
  return [
    head,
    `대상 방위: ${chart.region.nameKo} — ${origin}에서 ${DIRECTION_KO[chart.direction]}. 연반 ${NINE_STAR_HANGUL[chart.year.star - 1]}, 월반 ${NINE_STAR_HANGUL[chart.month.star - 1]}. ${
      hits.length > 0 ? `해당 살: ${hits.join(', ')}` : '해당 살 없음'
    }`,
    COLOUR_NOTE,
  ]
}

/** Lines go just before the reader's closing "Write exactly …" instruction. */
export function appendChartToReaderPrompt(userPrompt: string, lines: readonly string[]): string {
  if (lines.length === 0) return userPrompt
  const rows = userPrompt.split('\n')
  const at = rows.findIndex((row) => row.startsWith('Write exactly'))
  if (at < 0) return [...rows, ...lines].join('\n')
  return [...rows.slice(0, at), ...lines, ...rows.slice(at)].join('\n')
}

export function chartAwareReaderCall(lines: readonly string[], base: LeagueReaderCall): LeagueReaderCall {
  return (input) => base({ ...input, userPrompt: appendChartToReaderPrompt(input.userPrompt, lines) })
}
