/**
 * Korean / Japanese football club + league aliases → API-Football search.
 * Pure. Search still confirms via teams/search or fixtures?league=; this only seeds the query.
 */

export type FootballAliasRow = { aliases: readonly string[]; search: string }

export const FOOTBALL_TEAM_ALIASES: readonly FootballAliasRow[] = [
  { aliases: ['울산 hd', '울산 현대', '울산', 'ulsan hyundai', 'ulsan hd', 'ulsan'], search: 'Ulsan' },
  { aliases: ['전북 현대', '전북', 'jeonbuk hyundai', 'jeonbuk motors', 'jeonbuk'], search: 'Jeonbuk Motors' },
  { aliases: ['포항 스틸러스', '포항', 'pohang steelers', 'pohang'], search: 'Pohang Steelers' },
  { aliases: ['fc서울', 'fc 서울', '서울', 'fc seoul'], search: 'FC Seoul' },
  { aliases: ['수원 삼성', '수원fc', '수원 fc', '수원', 'suwon samsung', 'suwon fc', 'suwon'], search: 'Suwon' },
  { aliases: ['김천 상무', '김천', 'gimcheon sangmu', 'gimcheon'], search: 'Gimcheon Sangmu' },
  { aliases: ['강원fc', '강원 fc', '강원', 'gangwon'], search: 'Gangwon' },
  { aliases: ['인천 유나이티드', '인천', 'incheon united', 'incheon'], search: 'Incheon United' },
  { aliases: ['대전 하나시티즌', '대전 하나', '대전', 'daejeon'], search: 'Daejeon' },
  { aliases: ['광주fc', '광주 fc', '광주', 'gwangju'], search: 'Gwangju' },
  { aliases: ['제주 sk', '제주 유나이티드', '제주', 'jeju united', 'jeju'], search: 'Jeju United' },
  { aliases: ['대구fc', '대구 fc', '대구', 'daegu'], search: 'Daegu' },
  { aliases: ['가시마 앤틀러스', '가시마', 'kashima antlers', 'kashima'], search: 'Kashima Antlers' },
  { aliases: ['우라와 레즈', '우라와', 'urawa reds', 'urawa'], search: 'Urawa' },
  {
    aliases: ['요코하마 f. 마리노스', '요코하마 마리노스', '요코하마f마리노스', 'yokohama f. marinos', 'yokohama f marinos', 'yokohama marinos'],
    search: 'Yokohama F. Marinos',
  },
  { aliases: ['가와사키 프론탈레', '가와사키', 'kawasaki frontale', 'kawasaki'], search: 'Kawasaki Frontale' },
  { aliases: ['세레소 오사카', 'cerezo osaka'], search: 'Cerezo Osaka' },
  { aliases: ['감바 오사카', 'gamba osaka'], search: 'Gamba Osaka' },
  { aliases: ['나고야 그램퍼스', '나고야', 'nagoya grampus', 'nagoya'], search: 'Nagoya Grampus' },
  { aliases: ['산프레체 히로시마', 'sanfrecce hiroshima'], search: 'Sanfrecce Hiroshima' },
  { aliases: ['비셀 고베', 'vissel kobe'], search: 'Vissel Kobe' },
  { aliases: ['바이에른 뮌헨', '바이에른', 'bayern munich', 'bayern'], search: 'Bayern Munich' },
]

export type FootballLeagueAliasHit = { alias: string; leagueIds: readonly number[] }

export const FOOTBALL_LEAGUE_ALIASES: readonly FootballLeagueAliasHit[] = [
  { alias: '케이리그1', leagueIds: [292] },
  { alias: 'k리그1', leagueIds: [292] },
  { alias: 'k-리그1', leagueIds: [292] },
  { alias: 'k league 1', leagueIds: [292] },
  { alias: 'kleague1', leagueIds: [292] },
  { alias: '케이리그2', leagueIds: [293] },
  { alias: 'k리그2', leagueIds: [293] },
  { alias: 'k-리그2', leagueIds: [293] },
  { alias: 'k league 2', leagueIds: [293] },
  { alias: '케이리그', leagueIds: [292, 293] },
  { alias: 'k리그', leagueIds: [292, 293] },
  { alias: 'k-리그', leagueIds: [292, 293] },
  { alias: 'k league', leagueIds: [292, 293] },
  { alias: 'kleague', leagueIds: [292, 293] },
  { alias: '제이리그2', leagueIds: [99] },
  { alias: 'j리그2', leagueIds: [99] },
  { alias: 'j-league 2', leagueIds: [99] },
  { alias: 'j2', leagueIds: [99] },
  { alias: '제이리그', leagueIds: [98, 99] },
  { alias: 'j리그', leagueIds: [98, 99] },
  { alias: 'j-league', leagueIds: [98, 99] },
  { alias: 'j league', leagueIds: [98, 99] },
  { alias: 'j1', leagueIds: [98] },
  { alias: '분데스리가', leagueIds: [78] },
  { alias: 'bundesliga', leagueIds: [78] },
  { alias: '프리미어리그', leagueIds: [39] },
  { alias: 'premier league', leagueIds: [39] },
  { alias: 'epl', leagueIds: [39] },
  { alias: '라리가', leagueIds: [140] },
  { alias: 'la liga', leagueIds: [140] },
  { alias: '세리에', leagueIds: [135] },
  { alias: 'serie a', leagueIds: [135] },
  { alias: '리그앙', leagueIds: [61] },
  { alias: 'ligue 1', leagueIds: [61] },
]

const TEAM_INDEX: Array<{ alias: string; search: string }> = (() => {
  const rows: Array<{ alias: string; search: string }> = []
  for (const row of FOOTBALL_TEAM_ALIASES) {
    for (const alias of row.aliases) rows.push({ alias: alias.toLowerCase(), search: row.search })
  }
  rows.sort((a, b) => b.alias.length - a.alias.length)
  return rows
})()

const LEAGUE_INDEX = [...FOOTBALL_LEAGUE_ALIASES].sort((a, b) => b.alias.length - a.alias.length)

const SEARCH_STOP =
  /^(vs|and|the|fc|next|game|win|beat|will|who|wins|경기|다음|오늘|내일|이길까|이겨|누가|할까|승리|예측)$/i

export function resolveFootballSearchName(raw: string): string | null {
  const lower = raw.trim().toLowerCase()
  if (!lower) return null
  for (const row of TEAM_INDEX) {
    if (lower === row.alias) return row.search
  }
  return null
}

function isTokenBoundary(lower: string, at: number, end: number): boolean {
  const before = at === 0 || /[\s,./|:\-]/.test(lower[at - 1] ?? '')
  const after = end >= lower.length || /[\s,./|:\-]/.test(lower[end] ?? '')
  return before && after
}

/** Longest-first club alias hits in a free-prompt string. */
export function extractFootballAliasHits(raw: string): string[] {
  const lower = raw.toLowerCase()
  const hits: string[] = []
  const occupied: Array<[number, number]> = []
  const seen = new Set<string>()
  for (const row of TEAM_INDEX) {
    let from = 0
    while (from < lower.length) {
      const at = lower.indexOf(row.alias, from)
      if (at < 0) break
      const end = at + row.alias.length
      const overlaps = occupied.some(([a, b]) => at < b && end > a)
      from = at + 1
      if (overlaps) continue
      occupied.push([at, end])
      if (seen.has(row.search)) break
      seen.add(row.search)
      hits.push(row.search)
      break
    }
  }
  return hits
}

export function extractFootballLeagueHits(raw: string): number[] {
  const lower = raw.toLowerCase()
  const ids: number[] = []
  const occupied: Array<[number, number]> = []
  const seen = new Set<number>()
  for (const row of LEAGUE_INDEX) {
    const alias = row.alias.toLowerCase()
    let from = 0
    while (from < lower.length) {
      const at = lower.indexOf(alias, from)
      if (at < 0) break
      const end = at + alias.length
      const overlaps = occupied.some(([a, b]) => at < b && end > a)
      from = at + 1
      if (overlaps) continue
      if (alias.length <= 2 && !isTokenBoundary(lower, at, end)) continue
      occupied.push([at, end])
      for (const id of row.leagueIds) {
        if (!seen.has(id)) {
          seen.add(id)
          ids.push(id)
        }
      }
      break
    }
  }
  return ids
}

export function leftoverFootballTokens(raw: string): string[] {
  let rest = raw
  for (const row of [...TEAM_INDEX, ...LEAGUE_INDEX.map((r) => ({ alias: r.alias.toLowerCase() }))]) {
    rest = rest.replace(new RegExp(row.alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' ')
  }
  return rest
    .split(/[\s,./|:]+/)
    .map((t) => t.replace(/[?？!！]+$/g, '').trim())
    .filter((t) => t.length >= 2 && !SEARCH_STOP.test(t))
}
