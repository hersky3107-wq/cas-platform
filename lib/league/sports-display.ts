/**
 * Display-time sports copy. Stored rounds stay English (gateway / packet /
 * grading). The card, chips, and headline localize names + proposition from
 * the MATCH instrument the same way catalog chips localize AAPL → 애플.
 */

import type { LeagueLocale } from './i18n/locales'
import {
  decodeSportsInstrument,
  isSoccerLeague,
  leagueLabelEn,
  opponentTeamOf,
  subjectTeamOf,
  type SportsInstrumentParts,
} from './gateway/adapters/sports-catalog'
import type { SportsLeagueKey } from './sports/types'

type TeamKo = { short: string; full: string }

const TEAM_KO: Record<string, TeamKo> = {
  'Los Angeles Dodgers': { short: 'LA 다저스', full: '로스앤젤레스 다저스' },
  'San Francisco Giants': { short: 'SF 자이언츠', full: '샌프란시스코 자이언츠' },
  'New York Yankees': { short: 'NY 양키스', full: '뉴욕 양키스' },
  'Boston Red Sox': { short: '보스턴 레드삭스', full: '보스턴 레드삭스' },
  'Los Angeles Lakers': { short: 'LA 레이커스', full: '로스앤젤레스 레이커스' },
  'Boston Celtics': { short: '보스턴 셀틱스', full: '보스턴 셀틱스' },
  'Golden State Warriors': { short: 'GS 워리어스', full: '골든스테이트 워리어스' },
  'New York Knicks': { short: 'NY 닉스', full: '뉴욕 닉스' },
  'Miami Heat': { short: '마이애미 히트', full: '마이애미 히트' },
  'Chicago Bulls': { short: '시카고 불스', full: '시카고 불스' },
  'Dallas Mavericks': { short: '댈러스 매버릭스', full: '댈러스 매버릭스' },
  'Philadelphia Phillies': { short: '필라델피아 필리스', full: '필라델피아 필리스' },
  'New York Mets': { short: 'NY 메츠', full: '뉴욕 메츠' },
  'Chicago Cubs': { short: '시카고 컵스', full: '시카고 컵스' },
  'Atlanta Braves': { short: '애틀랜타 브레이브스', full: '애틀랜타 브레이브스' },
  'Houston Astros': { short: '휴스턴 애스트로스', full: '휴스턴 애스트로스' },
  'Tottenham Hotspur': { short: '토트넘', full: '토트넘 홋스퍼' },
  Arsenal: { short: '아스날', full: '아스날' },
  'Manchester City': { short: '맨시티', full: '맨체스터 시티' },
  'Manchester United': { short: '맨유', full: '맨체스터 유나이티드' },
  Liverpool: { short: '리버풀', full: '리버풀' },
  Chelsea: { short: '첼시', full: '첼시' },
  'Newcastle United': { short: '뉴캐슬', full: '뉴캐슬 유나이티드' },
  'Aston Villa': { short: '아스톤 빌라', full: '아스톤 빌라' },
  'Brighton and Hove Albion': { short: '브라이튼', full: '브라이튼' },
  'Crystal Palace': { short: '팰리스', full: '크리스탈 팰리스' },
  'West Ham United': { short: '웨스트햄', full: '웨스트햄 유나이티드' },
  'Nottingham Forest': { short: '노팅엄', full: '노팅엄 포레스트' },
  Fulham: { short: '풀럼', full: '풀럼' },
  Brentford: { short: '브렌트퍼드', full: '브렌트퍼드' },
  Bournemouth: { short: '본머스', full: '본머스' },
  Everton: { short: '에버턴', full: '에버턴' },
  'Wolverhampton Wanderers': { short: '울버햄튼', full: '울버햄튼 원더러스' },
  'Leeds United': { short: '리즈', full: '리즈 유나이티드' },
  Burnley: { short: '번리', full: '번리' },
  Sunderland: { short: '선덜랜드', full: '선덜랜드' },
  'Real Madrid': { short: '레알 마드리드', full: '레알 마드리드' },
  Barcelona: { short: '바르셀로나', full: '바르셀로나' },
  'Atletico Madrid': { short: '아틀레티코', full: '아틀레티코 마드리드' },
  'Athletic Club': { short: '빌바오', full: '아틀레틱 빌바오' },
  'Bayern Munich': { short: '바이에른', full: '바이에른 뮌헨' },
  'Paris Saint Germain': { short: 'PSG', full: '파리 생제르맹' },
  'Inter Milan': { short: '인터 밀란', full: '인터 밀란' },
  'AC Milan': { short: '밀란', full: 'AC 밀란' },
  Juventus: { short: '유벤투스', full: '유벤투스' },
  Napoli: { short: '나폴리', full: '나폴리' },
  'AS Roma': { short: '로마', full: 'AS 로마' },
  'South Korea': { short: '한국', full: '대한민국' },
  Japan: { short: '일본', full: '일본' },
  France: { short: '프랑스', full: '프랑스' },
  England: { short: '잉글랜드', full: '잉글랜드' },
  Spain: { short: '스페인', full: '스페인' },
  Germany: { short: '독일', full: '독일' },
  Italy: { short: '이탈리아', full: '이탈리아' },
  Portugal: { short: '포르투갈', full: '포르투갈' },
  Netherlands: { short: '네덜란드', full: '네덜란드' },
  'Borussia Dortmund': { short: '도르트문트', full: '도르트문트' },
}

const LEAGUE_KO: Record<SportsLeagueKey, string> = {
  soccer_epl: '프리미어리그',
  soccer_uefa_champs_league: '챔피언스리그',
  soccer_spain_la_liga: '라리가',
  soccer_italy_serie_a: '세리에 A',
  soccer_uefa_nations_league: '네이션스리그',
  baseball_mlb: 'MLB',
  basketball_nba: 'NBA',
  mma_mixed_martial_arts: 'UFC',
}

function lookupKo(name: string): TeamKo | null {
  return TEAM_KO[name] ?? null
}

/** Locale-aware team name. Unmapped teams keep the English (romanized) Odds-API name. */
export function displaySportsTeam(
  name: string,
  locale: LeagueLocale,
  form: 'short' | 'full' = 'short',
): string {
  if (locale !== 'ko') return name
  const row = lookupKo(name)
  if (!row) return name
  return form === 'full' ? row.full : row.short
}

export function sportsLeagueLabel(league: SportsLeagueKey, locale: LeagueLocale): string {
  if (locale === 'ko') return LEAGUE_KO[league]
  return leagueLabelEn(league)
}

export function sportsVsLabel(instrument: string, locale: LeagueLocale): string | null {
  const parts = decodeSportsInstrument(instrument)
  if (!parts) return null
  const subject = displaySportsTeam(subjectTeamOf(parts), locale, 'short')
  const opponent = displaySportsTeam(opponentTeamOf(parts), locale, 'short')
  return `${subject} vs ${opponent}`
}

export function formatSportsPropositionLocalized(parts: SportsInstrumentParts, locale: LeagueLocale): string {
  const subject = displaySportsTeam(subjectTeamOf(parts), locale, locale === 'ko' ? 'full' : 'short')
  const opponent = displaySportsTeam(opponentTeamOf(parts), locale, locale === 'ko' ? 'full' : 'short')
  const competition = sportsLeagueLabel(parts.league, locale)
  if (locale === 'ko') {
    if (isSoccerLeague(parts.league)) {
      return `${subject}가 ${opponent}와의 ${competition} 경기에서 정규시간(90분+추가시간, 무승부는 패)에 이길까?`
    }
    return `${subject}가 ${opponent}와의 ${competition} 경기에서 이길까?`
  }
  if (isSoccerLeague(parts.league)) {
    return `Will ${subject} win the ${competition} match against ${opponent} in regular time (90 minutes plus stoppage; a draw is No)?`
  }
  return `Will ${subject} win the ${competition} game against ${opponent}?`
}

/** Card / locked-panel proposition. Falls back to the stored English text. */
export function sportsPropositionDisplay(instrument: string, stored: string, locale: LeagueLocale): string {
  const parts = decodeSportsInstrument(instrument)
  if (!parts) return stored
  return formatSportsPropositionLocalized(parts, locale)
}
