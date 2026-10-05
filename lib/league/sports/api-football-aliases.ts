/**
 * Korean / Japanese football club aliases → API-Football search names.
 * Pure. Search still confirms via teams/search; this only seeds the query.
 */

export type FootballAliasRow = { aliases: readonly string[]; search: string }

export const FOOTBALL_TEAM_ALIASES: readonly FootballAliasRow[] = [
  { aliases: ['울산', '울산 hd', 'ulsan', 'ulsan hyundai', 'ulsan hd'], search: 'Ulsan' },
  { aliases: ['전북', '전북 현대', 'jeonbuk', 'jeonbuk hyundai', 'jeonbuk motors'], search: 'Jeonbuk Motors' },
  { aliases: ['포항', '포항 스틸러스', 'pohang', 'pohang steelers'], search: 'Pohang Steelers' },
  { aliases: ['서울', 'fc 서울', 'fc서울', 'fc seoul'], search: 'FC Seoul' },
  { aliases: ['수원', '수원 삼성', '수원fc', '수원 fc', 'suwon', 'suwon samsung', 'suwon fc'], search: 'Suwon' },
  { aliases: ['김천', '김천 상무', 'gimcheon', 'gimcheon sangmu'], search: 'Gimcheon Sangmu' },
  { aliases: ['강원', '강원fc', 'gangwon'], search: 'Gangwon' },
  { aliases: ['인천', '인천 유나이티드', 'incheon'], search: 'Incheon United' },
  { aliases: ['대전', '대전 하나', 'daejeon'], search: 'Daejeon' },
  { aliases: ['광주', '광주fc', 'gwangju'], search: 'Gwangju' },
  { aliases: ['제주', '제주 유나이티드', 'jeju'], search: 'Jeju United' },
  { aliases: ['대구', '대구fc', 'daegu'], search: 'Daegu' },
  { aliases: ['가시마', '가시마 앤틀러스', 'kashima', 'kashima antlers'], search: 'Kashima Antlers' },
  { aliases: ['우라와', '우라와 레즈', 'urawa', 'urawa reds'], search: 'Urawa' },
  {
    aliases: ['요코하마 f. 마리노스', '요코하마 마리노스', '요코하마f마리노스', 'yokohama f. marinos', 'yokohama f marinos', 'yokohama marinos'],
    search: 'Yokohama F. Marinos',
  },
  { aliases: ['가와사키', '가와사키 프론탈레', 'kawasaki', 'kawasaki frontale'], search: 'Kawasaki Frontale' },
  { aliases: ['세레소 오사카', 'cerezo osaka'], search: 'Cerezo Osaka' },
  { aliases: ['감바 오사카', 'gamba osaka'], search: 'Gamba Osaka' },
  { aliases: ['나고야', '나고야 그램퍼스', 'nagoya', 'nagoya grampus'], search: 'Nagoya Grampus' },
  { aliases: ['산프레체 히로시마', 'sanfrecce hiroshima'], search: 'Sanfrecce Hiroshima' },
  { aliases: ['비셀 고베', 'vissel kobe'], search: 'Vissel Kobe' },
]

const INDEX: Array<{ alias: string; search: string }> = (() => {
  const rows: Array<{ alias: string; search: string }> = []
  for (const row of FOOTBALL_TEAM_ALIASES) {
    for (const alias of row.aliases) rows.push({ alias: alias.toLowerCase(), search: row.search })
  }
  rows.sort((a, b) => b.alias.length - a.alias.length)
  return rows
})()

export function resolveFootballSearchName(raw: string): string | null {
  const lower = raw.trim().toLowerCase()
  if (!lower) return null
  for (const row of INDEX) {
    if (lower === row.alias) return row.search
  }
  return null
}

/** Longest-first alias hits in a free-prompt string. */
export function extractFootballAliasHits(raw: string): string[] {
  const lower = raw.toLowerCase()
  const hits: string[] = []
  const occupied: Array<[number, number]> = []
  const seen = new Set<string>()
  for (const row of INDEX) {
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
