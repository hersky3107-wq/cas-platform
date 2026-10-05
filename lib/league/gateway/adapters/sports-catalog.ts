/**
 * Sports entity world. Football resolves onto API-Football professional
 * competitions (any soccer_* key). Other sports stay on the Odds-API launch
 * slate (MLB / NBA / UFC). Never invents a match that is not public.
 */

import { FOOTBALL_LEAGUE_LABEL_EN, isFootballInstrumentLeague } from '../../sports/api-football-leagues'
import { teamsMatch } from '../../sports/lineup-logic'
import { isSportsLeagueKey, type SportsLeagueKey } from '../../sports/types'
import { detectBettingFraming } from '../betting-framing'

export type SportsSide = 'home' | 'away'

export type SportsInstrumentParts = {
  league: string
  eventId: string
  side: SportsSide
  kickoffMs: number
  home: string
  away: string
}

export type SportsFixtureLite = {
  fixture_id: string
  league: string
  home: string
  away: string
  kickoff: string
}

export const SPORTS_RESOLVES_AFTER_KICKOFF_MS = 2.5 * 60 * 60 * 1000
export const FOOTBALL_RESOLVES_AFTER_KICKOFF_MS = 3 * 60 * 60 * 1000

export function isSportsInstrumentLeague(league: string): boolean {
  return isSportsLeagueKey(league) || isFootballInstrumentLeague(league)
}

export const SOCCER_LEAGUES: readonly SportsLeagueKey[] = [
  'soccer_epl',
  'soccer_uefa_champs_league',
  'soccer_spain_la_liga',
  'soccer_italy_serie_a',
  'soccer_uefa_nations_league',
]

export const MMA_LEAGUES: readonly SportsLeagueKey[] = ['mma_mixed_martial_arts']

export function isSoccerLeague(league: string): boolean {
  return (SOCCER_LEAGUES as readonly string[]).includes(league) || isFootballInstrumentLeague(league)
}

export function isMmaLeague(league: string): boolean {
  return (MMA_LEAGUES as readonly string[]).includes(league)
}

export function isNflLeague(league: string): boolean {
  return league === 'americanfootball_nfl'
}

export function isNhlLeague(league: string): boolean {
  return league === 'icehockey_nhl'
}

const LEAGUE_LABEL_EN: Record<SportsLeagueKey, string> = {
  soccer_epl: 'Premier League',
  soccer_uefa_champs_league: 'UEFA Champions League',
  soccer_spain_la_liga: 'La Liga',
  soccer_italy_serie_a: 'Serie A',
  soccer_uefa_nations_league: 'UEFA Nations League',
  baseball_mlb: 'MLB',
  basketball_nba: 'NBA',
  americanfootball_nfl: 'NFL',
  icehockey_nhl: 'NHL',
  mma_mixed_martial_arts: 'UFC',
}

export function leagueLabelEn(league: string): string {
  if (league in LEAGUE_LABEL_EN) return LEAGUE_LABEL_EN[league as SportsLeagueKey]
  if (FOOTBALL_LEAGUE_LABEL_EN[league]) return FOOTBALL_LEAGUE_LABEL_EN[league]
  if (league.startsWith('soccer_')) {
    return league
      .replace(/^soccer_/, '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
  }
  return league
}

type AliasRow = { aliases: readonly string[]; canonical: string }

const TEAM_ALIASES: readonly AliasRow[] = [
  { aliases: ['tottenham hotspur', 'tottenham', 'spurs', '토트넘', '토튼햄'], canonical: 'Tottenham Hotspur' },
  { aliases: ['arsenal', '아스날', '아스널', 'アーセナル', '阿森納', 'أرسنال'], canonical: 'Arsenal' },
  { aliases: ['manchester city', 'man city', 'mcfc', '맨시티', '맨체스터 시티'], canonical: 'Manchester City' },
  { aliases: ['manchester united', 'man united', 'man utd', 'mufc', '맨유', '맨체스터 유나이티드'], canonical: 'Manchester United' },
  { aliases: ['liverpool', 'lfc', '리버풀'], canonical: 'Liverpool' },
  { aliases: ['chelsea', 'cfc', '첼시'], canonical: 'Chelsea' },
  { aliases: ['newcastle united', 'newcastle', '뉴캐슬'], canonical: 'Newcastle United' },
  { aliases: ['aston villa', 'villa', '아스톤 빌라', '애스턴 빌라'], canonical: 'Aston Villa' },
  { aliases: ['brighton and hove albion', 'brighton', '브라이튼'], canonical: 'Brighton and Hove Albion' },
  { aliases: ['crystal palace', 'palace', '팰리스', '크리스탈 팰리스'], canonical: 'Crystal Palace' },
  { aliases: ['west ham united', 'west ham', '웨스트햄'], canonical: 'West Ham United' },
  { aliases: ['nottingham forest', 'forest', '노팅엄', '노팅엄 포레스트'], canonical: 'Nottingham Forest' },
  { aliases: ['fulham', '풀럼', '풀햄'], canonical: 'Fulham' },
  { aliases: ['brentford', '브렌트퍼드', '브렌트포드'], canonical: 'Brentford' },
  { aliases: ['bournemouth', 'afc bournemouth', '본머스'], canonical: 'Bournemouth' },
  { aliases: ['everton', '에버턴'], canonical: 'Everton' },
  { aliases: ['wolverhampton wanderers', 'wolves', '울버햄튼', '울브스'], canonical: 'Wolverhampton Wanderers' },
  { aliases: ['leeds united', 'leeds', '리즈'], canonical: 'Leeds United' },
  { aliases: ['burnley', '번리'], canonical: 'Burnley' },
  { aliases: ['sunderland', '선덜랜드'], canonical: 'Sunderland' },
  { aliases: ['real madrid', '레알', '레알 마드리드'], canonical: 'Real Madrid' },
  { aliases: ['barcelona', 'barca', '바르셀로나', '바르사'], canonical: 'Barcelona' },
  { aliases: ['atletico madrid', 'atlético madrid', 'atleti', '아틀레티코'], canonical: 'Atletico Madrid' },
  { aliases: ['athletic club', 'athletic bilbao', '빌바오'], canonical: 'Athletic Club' },
  { aliases: ['bayern munich', 'bayern', '바이에른'], canonical: 'Bayern Munich' },
  { aliases: ['paris saint germain', 'paris saint-germain', 'psg', '파리 생제르맹', '파리생제르맹'], canonical: 'Paris Saint Germain' },
  { aliases: ['inter milan', 'internazionale', 'inter', '인터 밀란', '인터밀란'], canonical: 'Inter Milan' },
  { aliases: ['ac milan', 'milan', '밀란'], canonical: 'AC Milan' },
  { aliases: ['juventus', '유벤투스'], canonical: 'Juventus' },
  { aliases: ['napoli', '나폴리'], canonical: 'Napoli' },
  { aliases: ['as roma', 'roma', '로마'], canonical: 'AS Roma' },
  { aliases: ['ipswich town', 'ipswich', '입스위치'], canonical: 'Ipswich Town' },
  { aliases: ['hull city', 'hull', '헐시티', '헐'], canonical: 'Hull City' },
  { aliases: ['coventry city', 'coventry', '코번트리'], canonical: 'Coventry City' },
  { aliases: ['south korea', 'korea', '대한민국', '한국'], canonical: 'South Korea' },
  { aliases: ['japan', '일본'], canonical: 'Japan' },
  { aliases: ['france', '프랑스'], canonical: 'France' },
  { aliases: ['england', '잉글랜드'], canonical: 'England' },
  { aliases: ['spain', '스페인'], canonical: 'Spain' },
  { aliases: ['germany', '독일'], canonical: 'Germany' },
  { aliases: ['italy', '이탈리아'], canonical: 'Italy' },
  { aliases: ['portugal', '포르투갈'], canonical: 'Portugal' },
  { aliases: ['netherlands', 'holland', '네덜란드'], canonical: 'Netherlands' },
  { aliases: ['belgium', '벨기에'], canonical: 'Belgium' },
  { aliases: ['croatia', '크로아티아'], canonical: 'Croatia' },
  { aliases: ['serbia', '세르비아'], canonical: 'Serbia' },
  { aliases: ['denmark', '덴마크'], canonical: 'Denmark' },
  { aliases: ['san francisco giants', 'giants', '자이언츠'], canonical: 'San Francisco Giants' },
  { aliases: ['los angeles dodgers', 'dodgers', '다저스', 'ドジャース', '道奇', 'الدودجرز'], canonical: 'Los Angeles Dodgers' },
  { aliases: ['new york yankees', 'yankees', '양키스'], canonical: 'New York Yankees' },
  { aliases: ['boston red sox', 'red sox', '레드삭스'], canonical: 'Boston Red Sox' },
  { aliases: ['los angeles lakers', 'lakers', '레이커스'], canonical: 'Los Angeles Lakers' },
  { aliases: ['boston celtics', 'celtics', '셀틱스'], canonical: 'Boston Celtics' },
  { aliases: ['golden state warriors', 'warriors', '워리어스'], canonical: 'Golden State Warriors' },
  { aliases: ['울산 hd', '울산 현대', '울산', 'ulsan hyundai', 'ulsan hd', 'ulsan', 'ウルサン', '蔚山', 'أولسان'], canonical: 'Ulsan HD' },
  { aliases: ['전북 현대', '전북', 'jeonbuk hyundai', 'jeonbuk motors', 'jeonbuk'], canonical: 'Jeonbuk Motors' },
  { aliases: ['포항 스틸러스', '포항', 'pohang steelers', 'pohang'], canonical: 'Pohang Steelers' },
  { aliases: ['fc서울', 'fc 서울', '서울', 'fc seoul'], canonical: 'FC Seoul' },
  { aliases: ['수원 삼성', '수원fc', '수원 fc', '수원', 'suwon samsung', 'suwon fc', 'suwon'], canonical: 'Suwon' },
  { aliases: ['김천 상무', '김천', 'gimcheon sangmu', 'gimcheon'], canonical: 'Gimcheon Sangmu' },
  { aliases: ['강원fc', '강원 fc', '강원', 'gangwon'], canonical: 'Gangwon' },
  { aliases: ['인천 유나이티드', '인천', 'incheon united', 'incheon'], canonical: 'Incheon United' },
  { aliases: ['대전 하나시티즌', '대전 하나', '대전', 'daejeon'], canonical: 'Daejeon' },
  { aliases: ['광주fc', '광주 fc', '광주', 'gwangju'], canonical: 'Gwangju' },
  { aliases: ['제주 sk', '제주 유나이티드', '제주', 'jeju united', 'jeju'], canonical: 'Jeju United' },
  { aliases: ['대구fc', '대구 fc', '대구', 'daegu'], canonical: 'Daegu' },
  { aliases: ['가시마 앤틀러스', '가시마', 'kashima antlers', 'kashima'], canonical: 'Kashima Antlers' },
  { aliases: ['우라와 레즈', '우라와', 'urawa reds', 'urawa'], canonical: 'Urawa' },
  { aliases: ['요코하마 f. 마리노스', '요코하마 마리노스', 'yokohama f. marinos', 'yokohama f marinos'], canonical: 'Yokohama F. Marinos' },
  { aliases: ['가와사키 프론탈레', '가와사키', 'kawasaki frontale', 'kawasaki'], canonical: 'Kawasaki Frontale' },
  { aliases: ['비셀 고베', 'vissel kobe'], canonical: 'Vissel Kobe' },
  { aliases: ['산프레체 히로시마', 'sanfrecce hiroshima'], canonical: 'Sanfrecce Hiroshima' },
  { aliases: ['kansas city chiefs', 'kansas city', 'chiefs', '캔자스시티 치프스', '캔자스시티', '치프스'], canonical: 'Kansas City Chiefs' },
  { aliases: ['philadelphia eagles', 'eagles', '필라델피아 이글스'], canonical: 'Philadelphia Eagles' },
  { aliases: ['dallas cowboys', 'cowboys', '댈러스 카우보이스'], canonical: 'Dallas Cowboys' },
  { aliases: ['toronto maple leafs', 'maple leafs', '토론토 메이플리프스', '메이플리프스'], canonical: 'Toronto Maple Leafs' },
]

const ATHLETES: readonly AliasRow[] = [
  { aliases: ['손흥민', 'son heung-min', 'son heungmin', 'heung-min son', 'heungmin son'], canonical: 'Tottenham Hotspur' },
  { aliases: ['황희찬', 'hwang hee-chan', 'hee-chan hwang'], canonical: 'Wolverhampton Wanderers' },
  { aliases: ['이강인', 'lee kang-in', 'kang-in lee'], canonical: 'Paris Saint Germain' },
  { aliases: ['김민재', 'kim min-jae', 'min-jae kim'], canonical: 'Bayern Munich' },
  { aliases: ['오타니', 'shohei ohtani', 'ohtani'], canonical: 'Los Angeles Dodgers' },
  { aliases: ['르브론', 'lebron james', 'lebron'], canonical: 'Los Angeles Lakers' },
]

const ALIAS_INDEX: Array<{ alias: string; canonical: string; kind: 'athlete' | 'team' }> = (() => {
  const rows: Array<{ alias: string; canonical: string; kind: 'athlete' | 'team' }> = []
  for (const row of ATHLETES) {
    for (const alias of row.aliases) rows.push({ alias: alias.toLowerCase(), canonical: row.canonical, kind: 'athlete' })
  }
  for (const row of TEAM_ALIASES) {
    for (const alias of row.aliases) rows.push({ alias: alias.toLowerCase(), canonical: row.canonical, kind: 'team' })
  }
  rows.sort((a, b) => b.alias.length - a.alias.length)
  return rows
})()

export { detectBettingFraming }

export function encodeSportsInstrument(parts: SportsInstrumentParts): string {
  return [
    'MATCH',
    parts.league,
    parts.eventId,
    parts.side,
    String(parts.kickoffMs),
    encodeURIComponent(parts.home),
    encodeURIComponent(parts.away),
  ].join(':')
}

export function decodeSportsInstrument(instrument: string | null | undefined): SportsInstrumentParts | null {
  if (!instrument) return null
  const parts = instrument.split(':')
  if (parts.length !== 7 || parts[0] !== 'MATCH') return null
  const league = parts[1] ?? ''
  const eventId = parts[2] ?? ''
  const side = parts[3]
  const kickoffMs = Number(parts[4])
  const home = decodeURIComponent(parts[5] ?? '')
  const away = decodeURIComponent(parts[6] ?? '')
  if (!isSportsInstrumentLeague(league)) return null
  if (!eventId || (side !== 'home' && side !== 'away')) return null
  if (!Number.isFinite(kickoffMs) || kickoffMs <= 0) return null
  if (!home || !away) return null
  return { league, eventId, side, kickoffMs, home, away }
}

export function subjectTeamOf(parts: SportsInstrumentParts): string {
  return parts.side === 'home' ? parts.home : parts.away
}

export function opponentTeamOf(parts: SportsInstrumentParts): string {
  return parts.side === 'home' ? parts.away : parts.home
}

export function sideForTeam(fixture: SportsFixtureLite, team: string): SportsSide | null {
  if (teamsMatch(fixture.home, team)) return 'home'
  if (teamsMatch(fixture.away, team)) return 'away'
  return null
}

export type MentionHit = { canonical: string; kind: 'athlete' | 'team' }

export function extractSportsMentions(raw: string): MentionHit[] {
  const lower = raw.toLowerCase()
  const hits: Array<MentionHit & { at: number }> = []
  const used = new Set<string>()
  const occupied: Array<[number, number]> = []
  for (const row of ALIAS_INDEX) {
    let from = 0
    while (from < lower.length) {
      const at = lower.indexOf(row.alias, from)
      if (at < 0) break
      const end = at + row.alias.length
      const overlaps = occupied.some(([a, b]) => at < b && end > a)
      from = at + 1
      if (overlaps) continue
      occupied.push([at, end])
      if (used.has(row.canonical)) break
      used.add(row.canonical)
      hits.push({ canonical: row.canonical, kind: row.kind, at })
      break
    }
  }
  hits.sort((a, b) => a.at - b.at)
  return hits.map(({ canonical, kind }) => ({ canonical, kind }))
}

export function fixturesForTeam(slate: readonly SportsFixtureLite[], team: string, now: Date): SportsFixtureLite[] {
  const nowMs = now.getTime()
  return slate
    .filter((row) => Date.parse(row.kickoff) > nowMs - 3 * 60 * 60 * 1000)
    .filter((row) => sideForTeam(row, team) !== null)
    .sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff))
}

export function fixtureForBoth(
  slate: readonly SportsFixtureLite[],
  a: string,
  b: string,
  now: Date,
): SportsFixtureLite | null {
  const nowMs = now.getTime()
  const hits = slate
    .filter((row) => Date.parse(row.kickoff) > nowMs - 3 * 60 * 60 * 1000)
    .filter((row) => sideForTeam(row, a) !== null && sideForTeam(row, b) !== null)
    .sort((x, y) => Date.parse(x.kickoff) - Date.parse(y.kickoff))
  return hits[0] ?? null
}

export function partsFromFixture(fixture: SportsFixtureLite, side: SportsSide): SportsInstrumentParts {
  return {
    league: fixture.league,
    eventId: fixture.fixture_id,
    side,
    kickoffMs: Date.parse(fixture.kickoff),
    home: fixture.home,
    away: fixture.away,
  }
}

export function fixtureChipLabel(fixture: SportsFixtureLite, subject?: string): string {
  const vs = `${fixture.home} vs ${fixture.away}`
  const when = fixture.kickoff.slice(0, 16).replace('T', ' ')
  if (subject) return `${subject} · ${vs} · ${when}`
  return `${vs} · ${when}`
}
