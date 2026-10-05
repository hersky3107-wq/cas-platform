/**
 * Display-time sports copy. Stored rounds stay English (gateway / packet /
 * grading). The card, chips, and headline localize names + proposition from
 * the MATCH instrument the same way catalog chips localize AAPL → 애플.
 */

import { LEAGUE_LOCALES, type LeagueLocale } from './i18n/locales'
import {
  decodeSportsInstrument,
  isNflLeague,
  isNhlLeague,
  isSoccerLeague,
  leagueLabelEn,
  opponentTeamOf,
  subjectTeamOf,
  type SportsInstrumentParts,
} from './gateway/adapters/sports-catalog'
import { FOOTBALL_LEAGUE_LABEL_KO } from './sports/api-football-leagues'
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
  'Ulsan HD': { short: '울산 HD', full: '울산 HD' },
  'Gwangju FC': { short: '광주FC', full: '광주FC' },
  'Jeonbuk Motors': { short: '전북 현대', full: '전북 현대' },
  'Pohang Steelers': { short: '포항 스틸러스', full: '포항 스틸러스' },
  'FC Seoul': { short: 'FC서울', full: 'FC서울' },
  'Daegu FC': { short: '대구FC', full: '대구FC' },
  'Daejeon Hana Citizen': { short: '대전 하나', full: '대전 하나 시티즌' },
  'Incheon United': { short: '인천', full: '인천 유나이티드' },
  'Jeju United': { short: '제주', full: '제주 유나이티드' },
  'Gangwon FC': { short: '강원FC', full: '강원FC' },
  'Gimcheon Sangmu': { short: '김천 상무', full: '김천 상무' },
  'FC Anyang': { short: '안양FC', full: 'FC안양' },
  'Suwon FC': { short: '수원FC', full: '수원FC' },
  'Suwon Samsung Bluewings': { short: '수원 삼성', full: '수원 삼성' },
  'Busan IPark': { short: '부산', full: '부산 아이파크' },
  'Jeonnam Dragons': { short: '전남', full: '전남 드래곤즈' },
  'Seongnam FC': { short: '성남', full: '성남FC' },
  'Gyeongnam FC': { short: '경남', full: '경남FC' },
  'Kashima Antlers': { short: '가시마', full: '가시마 앤틀러스' },
  'Vissel Kobe': { short: '고베', full: '비셀 고베' },
  'Kawasaki Frontale': { short: '가와사키', full: '가와사키 프론탈레' },
  'Cerezo Osaka': { short: '세레소', full: '세레소 오사카' },
  'Gamba Osaka': { short: '감바', full: '감바 오사카' },
  'FC Tokyo': { short: 'FC도쿄', full: 'FC 도쿄' },
  'Nagoya Grampus': { short: '나고야', full: '나고야 그램퍼스' },
  'Sanfrecce Hiroshima': { short: '히로시마', full: '산프레체 히로시마' },
  Urawa: { short: '우라와', full: '우라와 레즈' },
  'Yokohama F. Marinos': { short: '요코하마 마리노스', full: '요코하마 F. 마리노스' },
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
  'RB Leipzig': { short: '라이프치히', full: 'RB 라이프치히' },
  'Bayer Leverkusen': { short: '레버쿠젠', full: '바이어 레버쿠젠' },
  'Kansas City Chiefs': { short: '캔자스시티', full: '캔자스시티 치프스' },
  'Philadelphia Eagles': { short: '이글스', full: '필라델피아 이글스' },
  'Dallas Cowboys': { short: '카우보이스', full: '댈러스 카우보이스' },
  'Toronto Maple Leafs': { short: '메이플리프스', full: '토론토 메이플리프스' },
}

/** API-Football / Odds names that share one display row. */
const TEAM_ALIAS: Record<string, string> = {
  'Ulsan Hyundai FC': 'Ulsan HD',
  'Ulsan Hyundai': 'Ulsan HD',
  'Jeonbuk Hyundai Motors': 'Jeonbuk Motors',
  'Jeonbuk Hyundai': 'Jeonbuk Motors',
  'Daejeon Citizen': 'Daejeon Hana Citizen',
  'Daejeon Hana': 'Daejeon Hana Citizen',
  'Jeju SK': 'Jeju United',
  'Gimcheon Sangmu FC': 'Gimcheon Sangmu',
  'Bayern München': 'Bayern Munich',
  'Bayern Munchen': 'Bayern Munich',
  'Paris Saint-Germain': 'Paris Saint Germain',
  'Urawa Red Diamonds': 'Urawa',
  'Yokohama F Marinos': 'Yokohama F. Marinos',
}

const TEAM_JA: Record<string, string> = {
  'Ulsan HD': '蔚山HD',
  'Gwangju FC': '光州FC',
  'Jeonbuk Motors': '全北現代',
  'Pohang Steelers': '浦項スティーラーズ',
  'FC Seoul': 'FCソウル',
  'Kashima Antlers': '鹿島アントラーズ',
  Urawa: '浦和レッズ',
  'Yokohama F. Marinos': '横浜F・マリノス',
  'Vissel Kobe': 'ヴィッセル神戸',
  'Kawasaki Frontale': '川崎フロンターレ',
  Arsenal: 'アーセナル',
  'Tottenham Hotspur': 'トッテナム',
  'Manchester City': 'マンチェスター・シティ',
  'Manchester United': 'マンチェスター・ユナイテッド',
  Liverpool: 'リバプール',
  Chelsea: 'チェルシー',
  'Real Madrid': 'レアル・マドリード',
  Barcelona: 'バルセロナ',
  'Bayern Munich': 'バイエルン',
  'Paris Saint Germain': 'パリ・サンジェルマン',
  'Los Angeles Dodgers': 'ドジャース',
  'New York Yankees': 'ヤンキース',
  'Los Angeles Lakers': 'レイカーズ',
  'Boston Celtics': 'セルティックス',
}

const LEAGUE_KO: Record<SportsLeagueKey, string> = {
  soccer_epl: '프리미어리그',
  soccer_uefa_champs_league: '챔피언스리그',
  soccer_spain_la_liga: '라리가',
  soccer_italy_serie_a: '세리에 A',
  soccer_uefa_nations_league: '네이션스리그',
  baseball_mlb: 'MLB',
  basketball_nba: 'NBA',
  americanfootball_nfl: 'NFL',
  icehockey_nhl: 'NHL',
  mma_mixed_martial_arts: 'UFC',
}

function canonicalTeam(name: string): string {
  return TEAM_ALIAS[name] ?? name
}

function lookupKo(name: string): TeamKo | null {
  return TEAM_KO[name] ?? TEAM_KO[canonicalTeam(name)] ?? null
}

/** Locale-aware team name. Unmapped teams keep the API name. */
export function displaySportsTeam(
  name: string,
  locale: LeagueLocale,
  form: 'short' | 'full' = 'short',
): string {
  const key = canonicalTeam(name)
  if (locale === 'ja') return TEAM_JA[key] ?? TEAM_JA[name] ?? name
  if (locale !== 'ko') return name
  const row = lookupKo(name)
  if (!row) return name
  return form === 'full' ? row.full : row.short
}

/** Football and NFL can finish level. NHL's official result includes OT/SO. */
export function sportsDrawPossible(league: string): boolean {
  return isSoccerLeague(league) || isNflLeague(league)
}

const DRAW_OR_LOSS: Record<LeagueLocale, (subject: string) => string> = {
  en: (s) => `${s} draw or loss`,
  ko: (s) => `${s} 무·패`,
  ja: (s) => `${s}の引き分け・負け`,
  'zh-TW': (s) => `${s} 和或敗`,
  fr: (s) => `${s} nul ou défaite`,
  es: (s) => `${s} empate o derrota`,
  ar: (s) => `${s} تعادل أو خسارة`,
  pt: (s) => `${s} empate ou derrota`,
}

export function drawOrLossLabel(subject: string, locale: LeagueLocale): string {
  return DRAW_OR_LOSS[locale](subject)
}

export function sportsLeagueLabel(league: string, locale: LeagueLocale): string {
  if (locale === 'ko') {
    return LEAGUE_KO[league as SportsLeagueKey] ?? FOOTBALL_LEAGUE_LABEL_KO[league] ?? leagueLabelEn(league)
  }
  return leagueLabelEn(league)
}

export function sportsVsLabel(instrument: string, locale: LeagueLocale): string | null {
  const parts = decodeSportsInstrument(instrument)
  if (!parts) return null
  const subject = displaySportsTeam(subjectTeamOf(parts), locale, 'short')
  const opponent = displaySportsTeam(opponentTeamOf(parts), locale, 'short')
  return `${subject} vs ${opponent}`
}

function sportsHomeAwayLabel(parts: SportsInstrumentParts, locale: LeagueLocale): string {
  const home = displaySportsTeam(parts.home, locale, 'short')
  const away = displaySportsTeam(parts.away, locale, 'short')
  return `${home} vs ${away}`
}

export function formatSportsKickoff(kickoffMs: number, locale: LeagueLocale): string {
  const tag = locale === 'zh-TW' ? 'zh-TW' : locale
  return new Intl.DateTimeFormat(tag, {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(kickoffMs))
}

/** "{home} vs {away} · {competition} · {kickoff}" — never the raw horizon chip. */
export function sportsCardHeaderLine(instrument: string, locale: LeagueLocale): string | null {
  const parts = decodeSportsInstrument(instrument)
  if (!parts) return null
  return `${sportsHomeAwayLabel(parts, locale)} · ${sportsLeagueLabel(parts.league, locale)} · ${formatSportsKickoff(parts.kickoffMs, locale)}`
}

export function formatSportsPropositionLocalized(parts: SportsInstrumentParts, locale: LeagueLocale): string {
  const named = locale === 'ko' || locale === 'ja'
  const subject = displaySportsTeam(subjectTeamOf(parts), locale, named ? 'full' : 'short')
  const opponent = displaySportsTeam(opponentTeamOf(parts), locale, named ? 'full' : 'short')
  const competition = sportsLeagueLabel(parts.league, locale)
  const soccer = isSoccerLeague(parts.league)
  const nfl = isNflLeague(parts.league)
  const nhl = isNhlLeague(parts.league)
  if (locale === 'ko') {
    if (soccer) return `${subject}가 ${opponent}와의 ${competition} 경기에서 정규시간(90분+추가시간, 무승부는 패)에 이길까?`
    if (nfl) return `${subject}가 ${opponent}와의 ${competition} 경기에서 이길까? 무승부는 패.`
    if (nhl) return `${subject}가 ${opponent}와의 ${competition} 경기에서 이길까? 연장·승부치기 포함 최종 결과.`
    return `${subject}가 ${opponent}와의 ${competition} 경기에서 이길까?`
  }
  if (locale === 'ja') {
    if (soccer) return `${subject}は${opponent}との${competition}の試合で、通常時間（90分＋アディショナル、引き分けは否）に勝つか？`
    if (nfl) return `${subject}は${opponent}との${competition}の試合に勝つか？引き分けは否。`
    if (nhl) return `${subject}は${opponent}との${competition}の試合に勝つか？延長・シュートアウトを含む最終結果。`
    return `${subject}は${opponent}との${competition}の試合に勝つか？`
  }
  if (locale === 'zh-TW') {
    if (soccer) return `${subject}會在對${opponent}的${competition}比賽中，於正規時間（90分鐘加傷停，和局算否）贏嗎？`
    if (nfl) return `${subject}會在對${opponent}的${competition}比賽中贏嗎？平手算否。`
    if (nhl) return `${subject}會在對${opponent}的${competition}比賽中贏嗎？含延長與點球大戰的最終結果。`
    return `${subject}會在對${opponent}的${competition}比賽中贏嗎？`
  }
  if (locale === 'fr') {
    if (soccer) return `${subject} va-t-il gagner le match de ${competition} contre ${opponent} dans le temps réglementaire (90 minutes plus arrêts de jeu ; un nul est Non) ?`
    if (nfl) return `${subject} va-t-il gagner le match de ${competition} contre ${opponent} ? Un nul est Non.`
    if (nhl) return `${subject} va-t-il gagner le match de ${competition} contre ${opponent} (résultat final, prolongations et tirs au but compris) ?`
    return `${subject} va-t-il gagner le match de ${competition} contre ${opponent} ?`
  }
  if (locale === 'es') {
    if (soccer) return `¿Ganará ${subject} el partido de ${competition} contra ${opponent} en el tiempo reglamentario (90 minutos más descuento; un empate es No)?`
    if (nfl) return `¿Ganará ${subject} el partido de ${competition} contra ${opponent}? Un empate es No.`
    if (nhl) return `¿Ganará ${subject} el partido de ${competition} contra ${opponent} (resultado final, prórroga y tanda de penaltis incluidas)?`
    return `¿Ganará ${subject} el partido de ${competition} contra ${opponent}?`
  }
  if (locale === 'ar') {
    if (soccer) return `هل سيفوز ${subject} على ${opponent} في ${competition} خلال الوقت الأصلي (90 دقيقة مع الوقت بدل الضائع؛ التعادل يعني لا)؟`
    if (nfl) return `هل سيفوز ${subject} على ${opponent} في ${competition}؟ التعادل يعني لا.`
    if (nhl) return `هل سيفوز ${subject} على ${opponent} في ${competition} (النتيجة النهائية بما فيها الوقت الإضافي وركلات الترجيح)؟`
    return `هل سيفوز ${subject} على ${opponent} في ${competition}؟`
  }
  if (locale === 'pt') {
    if (soccer) return `${subject} vai vencer o jogo de ${competition} contra ${opponent} no tempo regulamentar (90 minutos mais acréscimos; um empate é Não)?`
    if (nfl) return `${subject} vai vencer o jogo de ${competition} contra ${opponent}? Um empate é Não.`
    if (nhl) return `${subject} vai vencer o jogo de ${competition} contra ${opponent} (resultado final, incluindo prorrogação e pênaltis)?`
    return `${subject} vai vencer o jogo de ${competition} contra ${opponent}?`
  }
  if (soccer) {
    return `Will ${subject} win the ${competition} match against ${opponent} in regular time (90 minutes plus stoppage; a draw is No)?`
  }
  if (nfl) return `Will ${subject} win the ${competition} game against ${opponent}? A tie is No.`
  if (nhl) {
    return `Will ${subject} win the ${competition} game against ${opponent} (final result, including overtime and the shootout)?`
  }
  return `Will ${subject} win the ${competition} game against ${opponent}?`
}

export function sportsAllPropositions(parts: SportsInstrumentParts): Record<LeagueLocale, string> {
  const out = {} as Record<LeagueLocale, string>
  for (const locale of LEAGUE_LOCALES) out[locale] = formatSportsPropositionLocalized(parts, locale)
  return out
}

/** Card / locked-panel proposition. Falls back to the stored English text. */
export function sportsPropositionDisplay(instrument: string, stored: string, locale: LeagueLocale): string {
  const parts = decodeSportsInstrument(instrument)
  if (!parts) return stored
  return formatSportsPropositionLocalized(parts, locale)
}
