/**
 * Code-generated rationale when the reader fails parse twice.
 * Facts only — no market language, no invented doctrine.
 */
import type { LeagueReaderCompactPack } from './compact-pack'
import { isPlusVote } from './yongshen'

function orient(reversed: boolean): string {
  return reversed ? '역방향' : '정방향'
}

function side(pack: LeagueReaderCompactPack): string {
  const plus = isPlusVote(pack.codeVerdict)
  if (pack.codeVerdict === 'a' || pack.codeVerdict === 'b') return plus ? '세효(A)' : '응효(B)'
  return plus ? '강·길 쪽' : '약·흉 쪽'
}

export function fallbackRationale(pack: LeagueReaderCompactPack): string {
  const phase = pack.iching.yongshenMonthPhase ? `월령 ${pack.iching.yongshenMonthPhase}` : '월령 없음'
  const lines = [
    `육효 본괘 ${pack.iching.primary}·용신 ${pack.iching.relative}는 ${phase}이다.`,
    `타로 결과 패는 ${pack.tarot.outcome} ${orient(pack.tarot.reversed)}이다.`,
    `룬 미래는 ${pack.runes.future} ${orient(pack.runes.reversed)}이다.`,
    `택일 일진 ${pack.taeil.dayGanzhi}를 용신 ${pack.taeil.yongshenStem}(${pack.taeil.yongshenElement})에 읽는다.`,
    `코드가 합한 방향은 ${side(pack)}이다.`,
  ]
  return lines.join('\n')
}
