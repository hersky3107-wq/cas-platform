/**
 * Compact chart pack the single reader sees. Proposition + category +
 * timestamp + native facts. No price, volume, news, packet.
 */
import { SIGNS } from '../engines/astro/tables'
import { stemByHanja } from '../engines/calendar/tables'
import type { LeagueDivinationResult } from './types'
import { tarotNameKo, runeNameKo } from './names'
import { presenceFromVote } from './status'
import { isPlusVote } from './yongshen'

function signFromLongitude(longitude: number): string {
  const index = ((Math.floor(longitude / 30) % 12) + 12) % 12
  return SIGNS[index]!.name
}

export type LeagueReaderCompactPack = {
  proposition: string
  subjectName: string
  category: string
  seoul: { date: string; time: string; tz: string }
  hourPin: LeagueDivinationResult['seoul']['hourPin']
  /** Already decided in code. The reader explains this; it does not vote. */
  codeVerdict: 'up' | 'down' | 'a' | 'b'
  votedCount: 1 | 2 | 3 | 4
  ichingAlone: boolean
  voterRoll: {
    id: 'iching' | 'tarot' | 'runes' | 'taeil'
    nameKo: string
    status: 'voted' | '결번'
    statusLabel: '표를 냄' | '말을 아낌'
    ballot: 'up' | 'down' | 'a' | 'b' | null
    reason: string | null
  }[]
  votes: LeagueDivinationResult['votes']
  iching: {
    primary: string
    primaryHangul: string
    resulting: string
    resultingHangul: string
    relative: string
    yongshenPosition: number
    yongshenMonthPhase: string | null
    shi: number
    ying: number
    hiddenRelatives: string[]
  }
  tarot: { outcome: string; outcomeKo: string; reversed: boolean }
  runes: { future: string; futureKo: string; reversed: boolean }
  taeil: {
    label: '택일'
    dayGanzhi: string
    dayHangul: string
    monthGanzhi: string
    yongshenStem: string
    yongshenStemHangul: string
    yongshenElement: string
  }
  astro: {
    ballot: null
    sunSign: string
    moonSign: string
    ascendantSign: string | null
  }
  ninestar: {
    ballot: null
    year: number
    month: number
    day: number
  }
}

export function compactReaderPack(
  result: LeagueDivinationResult,
  input: { proposition: string; subjectName: string },
): LeagueReaderCompactPack {
  const outcome = result.charts.tarot.cards.find((card) => card.positionLabel === 'Outcome')
  const future = result.charts.runes.runes.find((rune) => rune.positionLabel === 'Future')
  const yongshenLine = result.charts.iching.draw.lines.find(
    (line) => line.position === result.charts.iching.yongshenPosition,
  )
  const angles = result.charts.astro.chart.angles
  return {
    proposition: input.proposition,
    subjectName: input.subjectName,
    category: result.categoryId,
    seoul: { date: result.seoul.date, time: result.seoul.time, tz: result.seoul.tz },
    hourPin: result.seoul.hourPin,
    codeVerdict: result.aggregate.vote,
    votedCount: result.aggregate.votedCount,
    ichingAlone: result.aggregate.ichingAlone,
    voterRoll: (
      [
        ['iching', '육효'],
        ['tarot', '타로'],
        ['runes', '룬'],
        ['taeil', '택일'],
      ] as const
    ).map(([id, nameKo]) => {
      const presence = presenceFromVote(result.votes[id])
      return {
        id,
        nameKo,
        status: presence.status,
        statusLabel: presence.statusLabel,
        ballot: presence.ballot,
        reason: presence.reason,
      }
    }),
    votes: result.votes,
    iching: {
      primary: result.charts.iching.draw.primary.hanja,
      primaryHangul: result.charts.iching.draw.primary.hangul,
      resulting: result.charts.iching.draw.resulting.hanja,
      resultingHangul: result.charts.iching.draw.resulting.hangul,
      relative: result.charts.iching.relative,
      yongshenPosition: result.charts.iching.yongshenPosition,
      yongshenMonthPhase: yongshenLine?.monthPhase ?? null,
      shi: result.charts.iching.draw.shi,
      ying: result.charts.iching.draw.ying,
      hiddenRelatives: [...result.charts.iching.draw.hiddenRelatives],
    },
    tarot: {
      outcome: outcome?.name ?? '',
      outcomeKo: outcome ? tarotNameKo(outcome.name, outcome.id) : '',
      reversed: outcome?.reversed ?? false,
    },
    runes: {
      future: future?.name ?? '',
      futureKo: future ? runeNameKo(future.name) : '',
      reversed: future?.reversed ?? false,
    },
    taeil: {
      label: '택일',
      dayGanzhi: result.charts.taeil.pillars.day.ganzhi,
      dayHangul: `${result.charts.taeil.pillars.day.stem.hangul}${result.charts.taeil.pillars.day.branch.hangul}`,
      monthGanzhi: result.charts.taeil.pillars.month.ganzhi,
      yongshenStem: result.charts.taeil.yongshen.stemHanja,
      yongshenStemHangul: stemByHanja(result.charts.taeil.yongshen.stemHanja).hangul,
      yongshenElement: result.charts.taeil.yongshen.element,
    },
    astro: {
      ballot: null,
      sunSign: result.charts.astro.chart.bodies.Sun.sign,
      moonSign: result.charts.astro.chart.bodies.Moon.sign,
      ascendantSign: angles ? signFromLongitude(angles.ascendant) : null,
    },
    ninestar: {
      ballot: null,
      year: result.charts.ninestar.result.year.number,
      month: result.charts.ninestar.result.month.number,
      day: result.charts.ninestar.result.day.number,
    },
  }
}

export function codeVerdictToOutput(vote: LeagueDivinationResult['aggregate']['vote'], pickOne: boolean): {
  verdict: 'up' | 'down'
  pick: 'A' | 'B' | null
} {
  const plus = isPlusVote(vote)
  return {
    verdict: plus ? 'up' : 'down',
    pick: pickOne ? (plus ? 'A' : 'B') : null,
  }
}
