/**
 * 육효 용신 picker and strength compare.
 *
 * Parts stay separate — this file never sums 월령 + 일건 + 동효 into a
 * combined 왕쇠 score (see engines/draw/strength.ts).
 *
 * Directional polarity (up/down):
 *   旺/相 → plus, 囚/死 → minus, 休 is REST and is skipped.
 *
 * 세응 compare uses the textbook five-rank order 旺>相>休>囚>死. Ranking
 * 휴 below 相 is doctrine; treating 휴 as 강 is not — directional vote
 * still refuses to map 휴 to plus.
 */
import type { DayLineRelation, IchingDrawResult, IchingLine, MonthPhase } from '../engines/draw'
import type { SixRelative } from '../engines/draw/tables'
import type { LeagueBinaryVote, LeagueBallotAxis, LeaguePolarity } from './types'

/** Textbook 왕상휴수사 order. Directional vote does not use 휴 as 강. */
export const MONTH_PHASE_COMPARE_RANK: Record<MonthPhase, number> = {
  旺: 4,
  相: 3,
  休: 2,
  囚: 1,
  死: 0,
}

export type YongshenPick = {
  relative: SixRelative
  line: IchingLine
  source: 'yongshen' | 'bokjang_shi'
  discardedPositions: number[]
}

export type LineSignal = 'monthPhase' | 'dayRelation' | 'changing'

export type LinePolarityHit = {
  polarity: LeaguePolarity
  signal: LineSignal
}

export function mapPolarity(polarity: LeaguePolarity, axis: LeagueBallotAxis): LeagueBinaryVote {
  if (axis === 'pick_one') return polarity === 'plus' ? 'a' : 'b'
  return polarity === 'plus' ? 'up' : 'down'
}

export function isPlusVote(vote: LeagueBinaryVote): boolean {
  return vote === 'up' || vote === 'a'
}

/** 旺/相 → plus, 囚/死 → minus, 休/null → skip. */
export function monthPhasePolarity(phase: MonthPhase | null): LeaguePolarity | null {
  if (phase === '旺' || phase === '相') return 'plus'
  if (phase === '囚' || phase === '死') return 'minus'
  return null
}

/**
 * PRODUCT mapping of 일건 onto a binary: 생/비화 → plus, 극 → minus.
 * Actor (who generates/overcomes) is ignored — that would be a combined
 * 왕쇠 judgement the engine refuses to invent. Marked PRODUCT, not 일건 doctrine.
 */
export function dayRelationPolarity(rel: DayLineRelation | null): LeaguePolarity | null {
  if (!rel) return null
  return rel.kind === '극' ? 'minus' : 'plus'
}

/**
 * 동효 as a signal only when incoming 생/극 is unanimous. Mixed 생+극 is
 * skipped rather than scored — no combined weight.
 */
export function changingPolarity(fromChanging: IchingLine['fromChanging']): LeaguePolarity | null {
  if (fromChanging.length === 0) return null
  const kinds = new Set(fromChanging.map((entry) => entry.action))
  if (kinds.size !== 1) return null
  return kinds.has('생') ? 'plus' : 'minus'
}

/** First available part, in 월령 → 일건 → 동효 order. Never a weighted blend. */
export function polarityFromLine(line: IchingLine): LinePolarityHit | null {
  const month = monthPhasePolarity(line.monthPhase)
  if (month) return { polarity: month, signal: 'monthPhase' }
  const day = dayRelationPolarity(line.dayRelation)
  if (day) return { polarity: day, signal: 'dayRelation' }
  const changing = changingPolarity(line.fromChanging)
  if (changing) return { polarity: changing, signal: 'changing' }
  return null
}

function monthRank(phase: MonthPhase | null): number | null {
  if (!phase) return null
  return MONTH_PHASE_COMPARE_RANK[phase]
}

/**
 * When several lines carry the 용신 육친: prefer 动爻, then higher 월령 rank,
 * then the lower (bottom-most) position. Lowest-position tiebreak is PRODUCT.
 */
export function pickYongshenLine(reading: IchingDrawResult, relative: SixRelative): YongshenPick {
  const matches = reading.lines.filter((line) => line.relative === relative)
  if (matches.length === 0) {
    const shi = reading.lines.find((line) => line.position === reading.shi)
    if (!shi) throw new Error('league-divination: 세효 missing from 육효 chart')
    return { relative, line: shi, source: 'bokjang_shi', discardedPositions: [] }
  }

  const moving = matches.filter((line) => line.changing)
  const pool = moving.length > 0 ? moving : matches
  const sorted = [...pool].sort((a, b) => {
    const ra = monthRank(a.monthPhase) ?? -1
    const rb = monthRank(b.monthPhase) ?? -1
    if (rb !== ra) return rb - ra
    return a.position - b.position
  })
  const line = sorted[0]!
  const discardedPositions = matches.filter((item) => item.position !== line.position).map((item) => item.position)
  return { relative, line, source: 'yongshen', discardedPositions }
}

/**
 * 용신 polarity. 복장 (육친 absent) falls back to 세효 and then the same
 * 월령 → 일건 → 동효 cascade. Never returns null when 월령+일건 are present.
 *
 * Last-resort plus is PRODUCT and is unreachable once the Seoul clock
 * supplies both 월령 and 일건 (일건 always yields a polarity).
 */
export function yongshenPolarity(
  reading: IchingDrawResult,
  relative: SixRelative,
): { pick: YongshenPick; hit: LinePolarityHit; fallbackToShi: boolean } {
  const pick = pickYongshenLine(reading, relative)
  const fromYongshen = polarityFromLine(pick.line)
  if (fromYongshen) {
    return { pick, hit: fromYongshen, fallbackToShi: pick.source === 'bokjang_shi' }
  }

  if (pick.source !== 'bokjang_shi') {
    const shi = reading.lines.find((line) => line.position === reading.shi)
    if (shi) {
      const fromShi = polarityFromLine(shi)
      if (fromShi) {
        return {
          pick: { relative, line: shi, source: 'bokjang_shi', discardedPositions: [] },
          hit: fromShi,
          fallbackToShi: true,
        }
      }
    }
  }

  return {
    pick,
    hit: { polarity: 'plus', signal: 'monthPhase' },
    fallbackToShi: true,
  }
}

function linePolarityOrNull(line: IchingLine): LeaguePolarity | null {
  return polarityFromLine(line)?.polarity ?? null
}

/**
 * 세 = A, 응 = B. Same 월령 ranks as the textbook five-order, then 일건,
 * then 동효. Residual 세 (A) is PRODUCT, not a 세효-always-wins doctrine.
 */
export function compareShiYing(reading: IchingDrawResult): { vote: 'a' | 'b'; signal: string } {
  const shi = reading.lines.find((line) => line.position === reading.shi)
  const ying = reading.lines.find((line) => line.position === reading.ying)
  if (!shi || !ying) throw new Error('league-divination: 세효/응효 missing')

  const shiRank = monthRank(shi.monthPhase)
  const yingRank = monthRank(ying.monthPhase)
  if (shiRank !== null && yingRank !== null && shiRank !== yingRank) {
    return { vote: shiRank > yingRank ? 'a' : 'b', signal: 'shi_ying.monthPhase' }
  }

  const shiDay = dayRelationPolarity(shi.dayRelation)
  const yingDay = dayRelationPolarity(ying.dayRelation)
  if (shiDay && yingDay && shiDay !== yingDay) {
    return { vote: shiDay === 'plus' ? 'a' : 'b', signal: 'shi_ying.dayRelation' }
  }

  const shiCh = changingPolarity(shi.fromChanging)
  const yingCh = changingPolarity(ying.fromChanging)
  if (shiCh && yingCh && shiCh !== yingCh) {
    return { vote: shiCh === 'plus' ? 'a' : 'b', signal: 'shi_ying.changing' }
  }
  if (shiCh && !yingCh) return { vote: shiCh === 'plus' ? 'a' : 'b', signal: 'shi_ying.changing' }
  if (!shiCh && yingCh) return { vote: yingCh === 'plus' ? 'b' : 'a', signal: 'shi_ying.changing' }

  const shiP = linePolarityOrNull(shi)
  const yingP = linePolarityOrNull(ying)
  if (shiP && !yingP) return { vote: shiP === 'plus' ? 'a' : 'b', signal: 'shi_ying.shi_only' }
  if (!shiP && yingP) return { vote: yingP === 'plus' ? 'b' : 'a', signal: 'shi_ying.ying_only' }

  return { vote: 'a', signal: 'shi_ying.product_shi_wins' }
}

export function voteIching(
  reading: IchingDrawResult,
  relative: SixRelative,
  axis: LeagueBallotAxis,
): { vote: LeagueBinaryVote; pick: YongshenPick; source: string } {
  const { pick, hit, fallbackToShi } = yongshenPolarity(reading, relative)
  if (axis === 'pick_one') {
    const compared = compareShiYing(reading)
    return { vote: compared.vote, pick, source: compared.signal }
  }
  const source = fallbackToShi
    ? `bokjang.shi.${hit.signal}`
    : `yongshen.${hit.signal}`
  return { vote: mapPolarity(hit.polarity, axis), pick, source }
}
