/**
 * Code-generated rationale when the reader fails parse twice.
 * A reading, not a chart dump — name the piece and say what it means.
 * Still no market language, still 4–5 lines, still locked to the code verdict.
 * Never claims four systems agreed when some 결번 / 말을 아킴.
 */
import type { LeagueReaderCompactPack } from './compact-pack'
import {
  elementKo,
  elementSense,
  monthPhaseKo,
  monthPhaseSense,
  relativeKo,
  relativeSense,
  runeMeaningKo,
} from './names'
import { isPlusVote } from './yongshen'

function orient(reversed: boolean): string {
  return reversed ? '뒤집혀' : '바로 서서'
}

function lean(pack: LeagueReaderCompactPack): string {
  const plus = isPlusVote(pack.codeVerdict)
  if (pack.codeVerdict === 'a' || pack.codeVerdict === 'b') {
    return plus ? '세효 쪽이 이 판의 무게입니다.' : '응효 쪽이 이 판의 무게입니다.'
  }
  return plus ? '합은 길한 쪽으로 기울었습니다.' : '합은 흉한 쪽으로 기울었습니다.'
}

function close(pack: LeagueReaderCompactPack): string {
  const end = lean(pack)
  if (pack.ichingAlone) {
    return `타로·룬·택일은 말을 아꼈고 육효가 홀로 표를 냈습니다. ${end}`
  }
  if (pack.votedCount < 4) {
    return `표를 낸 것은 ${pack.votedCount}개 체계뿐입니다. ${end}`
  }
  return end
}

export function fallbackRationale(pack: LeagueReaderCompactPack): string {
  const relative = relativeKo(pack.iching.relative)
  const relativeMeaning = relativeSense(pack.iching.relative)
  const phaseLabel = monthPhaseKo(pack.iching.yongshenMonthPhase)
  const phaseMeaning = monthPhaseSense(pack.iching.yongshenMonthPhase)
  const hex = `${pack.iching.primaryHangul}(${pack.iching.primary})`
  const tarot = pack.tarot.outcomeKo || pack.tarot.outcome
  const rune = pack.runes.futureKo || pack.runes.future
  const runeMeaning = runeMeaningKo(pack.runes.future)
  const element = elementKo(pack.taeil.yongshenElement)
  const elementMeaning = elementSense(pack.taeil.yongshenElement)
  const day = pack.taeil.dayHangul || pack.taeil.dayGanzhi
  const stem = pack.taeil.yongshenStemHangul
  const phaseClause = phaseLabel
    ? `월령 ${phaseLabel} — ${phaseMeaning}`
    : `월령을 읽지 못해 ${phaseMeaning}`

  const tarotLine = pack.votes.tarot.abstained
    ? `결과 패는 ${tarot} — ${orient(pack.tarot.reversed)} 나왔으나 표가 방향을 주지 않아 말을 아꼈습니다.`
    : `결과 패는 ${tarot} — ${orient(pack.tarot.reversed)} 나온 자리입니다. 그 패가 가리키는 결말이 이 판의 무게입니다.`
  const runeLine = pack.votes.runes.abstained
    ? `미래 룬 ${rune} — ${orient(pack.runes.reversed)} 있으나 표가 방향을 주지 않아 말을 아꼈습니다.`
    : `미래 룬 ${rune} — ${orient(pack.runes.reversed)} 있습니다. ${runeMeaning}입니다.`
  const taeilLine = pack.votes.taeil.abstained
    ? `택일 일진 ${day}에 ${stem}(${element})이 용신이나, 일진과 월건이 갈려 말을 아꼈습니다.`
    : `택일 일진 ${day}에 ${stem}(${element})이 용신으로 들어앉았습니다. ${elementMeaning}입니다.`

  const lines = [
    `육효 본괘 ${hex}의 용신은 ${relative}입니다. ${relative}는 ${relativeMeaning}이며, ${phaseClause}입니다.`,
    tarotLine,
    runeLine,
    taeilLine,
    close(pack),
  ]
  return lines.join('\n')
}
