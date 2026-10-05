/**
 * API-Football league id ↔ Odds-API / MATCH instrument key.
 * Pure. Unknown leagues become soccer_af_{id} so decode still accepts them.
 */

export const FOOTBALL_SEARCH_WINDOW_MS = 35 * 86_400_000

/** Curated popular set — ranking / suggestions only. Opening still allows other professional comps. */
export const POPULAR_FOOTBALL_LEAGUE_IDS: readonly number[] = [
  39, 40, 140, 135, 78, 61, 88, 94, 179, 203, 307, 253, 262, 71, 128, 292, 293, 98, 99, 188, 169,
  2, 3, 848, 17, 18, 13, 45, 143, 66, 81, 137, 1, 4, 5, 6, 7, 9, 10, 29, 32, 34,
]

const POPULAR_SET = new Set(POPULAR_FOOTBALL_LEAGUE_IDS)

export const API_FOOTBALL_LEAGUE_TO_KEY: Record<number, string> = {
  39: 'soccer_epl',
  40: 'soccer_efl_championship',
  140: 'soccer_spain_la_liga',
  135: 'soccer_italy_serie_a',
  78: 'soccer_germany_bundesliga',
  61: 'soccer_france_ligue_one',
  2: 'soccer_uefa_champs_league',
  3: 'soccer_uefa_europa_league',
  848: 'soccer_uefa_europa_conference_league',
  5: 'soccer_uefa_nations_league',
  4: 'soccer_uefa_european_championship',
  1: 'soccer_fifa_world_cup',
  6: 'soccer_africa_cup_of_nations',
  7: 'soccer_afc_asian_cup',
  9: 'soccer_copa_america',
  10: 'soccer_fifa_friendlies',
  13: 'soccer_copa_libertadores',
  29: 'soccer_fifa_world_cup_qualifiers_asia',
  32: 'soccer_fifa_world_cup_qualifiers_europe',
  34: 'soccer_fifa_world_cup_qualifiers_sa',
  45: 'soccer_fa_cup',
  48: 'soccer_efl_cup',
  66: 'soccer_coupe_de_france',
  81: 'soccer_dfb_pokal',
  137: 'soccer_coppa_italia',
  143: 'soccer_copa_del_rey',
  169: 'soccer_china_superleague',
  188: 'soccer_australia_aleague',
  253: 'soccer_usa_mls',
  262: 'soccer_mexico_ligamx',
  71: 'soccer_brazil_campeonato',
  128: 'soccer_argentina_primera_division',
  88: 'soccer_netherlands_eredivisie',
  94: 'soccer_portugal_primeira_liga',
  144: 'soccer_belgium_first_div',
  203: 'soccer_turkey_super_league',
  197: 'soccer_greece_super_league',
  179: 'soccer_scotland_premiership',
  292: 'soccer_korea_kleague1',
  293: 'soccer_korea_kleague2',
  98: 'soccer_japan_j_league',
  99: 'soccer_japan_j_league2',
  17: 'soccer_afc_champions_league',
  18: 'soccer_afc_champions_league_two',
  307: 'soccer_saudi_pro_league',
}

const KEY_TO_ID: Record<string, number> = (() => {
  const out: Record<string, number> = {}
  for (const [id, key] of Object.entries(API_FOOTBALL_LEAGUE_TO_KEY)) {
    if (out[key] == null) out[key] = Number(id)
  }
  return out
})()

export const FOOTBALL_LEAGUE_LABEL_EN: Record<string, string> = {
  soccer_epl: 'Premier League',
  soccer_spain_la_liga: 'La Liga',
  soccer_italy_serie_a: 'Serie A',
  soccer_germany_bundesliga: 'Bundesliga',
  soccer_france_ligue_one: 'Ligue 1',
  soccer_uefa_champs_league: 'UEFA Champions League',
  soccer_uefa_europa_league: 'UEFA Europa League',
  soccer_uefa_europa_conference_league: 'UEFA Europa Conference League',
  soccer_uefa_nations_league: 'UEFA Nations League',
  soccer_uefa_european_championship: 'UEFA European Championship',
  soccer_fifa_world_cup: 'FIFA World Cup',
  soccer_fa_cup: 'FA Cup',
  soccer_efl_cup: 'EFL Cup',
  soccer_efl_championship: 'EFL Championship',
  soccer_coupe_de_france: 'Coupe de France',
  soccer_dfb_pokal: 'DFB-Pokal',
  soccer_coppa_italia: 'Coppa Italia',
  soccer_copa_del_rey: 'Copa del Rey',
  soccer_china_superleague: 'Chinese Super League',
  soccer_saudi_pro_league: 'Saudi Pro League',
  soccer_africa_cup_of_nations: 'Africa Cup of Nations',
  soccer_afc_asian_cup: 'AFC Asian Cup',
  soccer_copa_america: 'Copa América',
  soccer_fifa_friendlies: 'International Friendlies',
  soccer_fifa_world_cup_qualifiers_asia: 'World Cup Qualifiers (AFC)',
  soccer_fifa_world_cup_qualifiers_europe: 'World Cup Qualifiers (UEFA)',
  soccer_fifa_world_cup_qualifiers_sa: 'World Cup Qualifiers (CONMEBOL)',
  soccer_copa_libertadores: 'Copa Libertadores',
  soccer_afc_champions_league_two: 'AFC Champions League Two',
  soccer_korea_kleague1: 'K League 1',
  soccer_korea_kleague2: 'K League 2',
  soccer_japan_j_league: 'J1 League',
  soccer_japan_j_league2: 'J2 League',
  soccer_australia_aleague: 'A-League',
  soccer_usa_mls: 'MLS',
  soccer_mexico_ligamx: 'Liga MX',
  soccer_brazil_campeonato: 'Brasileirão',
  soccer_argentina_primera_division: 'Argentine Primera División',
  soccer_netherlands_eredivisie: 'Eredivisie',
  soccer_portugal_primeira_liga: 'Primeira Liga',
  soccer_belgium_first_div: 'Belgian Pro League',
  soccer_turkey_super_league: 'Süper Lig',
  soccer_greece_super_league: 'Super League Greece',
  soccer_scotland_premiership: 'Scottish Premiership',
  soccer_afc_champions_league: 'AFC Champions League',
}

export const FOOTBALL_LEAGUE_LABEL_KO: Record<string, string> = {
  soccer_korea_kleague1: 'K리그1',
  soccer_korea_kleague2: 'K리그2',
  soccer_japan_j_league: 'J1리그',
  soccer_japan_j_league2: 'J2리그',
  soccer_australia_aleague: 'A리그',
  soccer_usa_mls: 'MLS',
  soccer_germany_bundesliga: '분데스리가',
  soccer_france_ligue_one: '리그 1',
  soccer_uefa_europa_league: '유로파리그',
  soccer_afc_champions_league: 'AFC 챔피언스리그',
}

export function footballLeagueKeyFromApiId(leagueId: number, fallbackName?: string): string {
  const mapped = API_FOOTBALL_LEAGUE_TO_KEY[leagueId]
  if (mapped) return mapped
  const slug = (fallbackName ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40)
  return slug ? `soccer_${slug}` : `soccer_af_${leagueId}`
}

export function apiFootballLeagueIdFromKey(league: string): number | null {
  if (KEY_TO_ID[league] != null) return KEY_TO_ID[league]
  const af = league.match(/^soccer_af_(\d+)$/)
  if (af) return Number(af[1])
  return null
}

export function isFootballInstrumentLeague(league: string): boolean {
  return league.startsWith('soccer_')
}

export function isPopularFootballLeagueId(leagueId: number): boolean {
  return POPULAR_SET.has(leagueId)
}

const REFUSED_NAME =
  /amateur|youth|reserve|academy|primavera|u-?1[679]\b|u-?2[013]\b|u-?23\b|k3(?:리그|_|$|\b)|k4(?:리그|_|$|\b)|k league 3|j3(?:리그|_|$|\b)|jfl\b|japan football league|regionalliga|3\.\s*liga|league one|league two|national league|non-league|serie c|serie d|ligue 3|national 2|segunda federaci[oó]n|segunda b|semipro|frauen|women'?s|wsl|femenin|femminile|damen|ladies/i

export function isRefusedFootballCompetition(leagueId: number | null | undefined, leagueName?: string | null): boolean {
  if (leagueId != null && POPULAR_SET.has(leagueId)) return false
  const name = `${leagueName ?? ''} ${leagueId != null ? API_FOOTBALL_LEAGUE_TO_KEY[leagueId] ?? '' : ''}`.trim()
  return REFUSED_NAME.test(name)
}

export function isRefusedFootballLeagueKey(league: string, leagueName?: string | null): boolean {
  const id = apiFootballLeagueIdFromKey(league)
  return isRefusedFootballCompetition(id, leagueName ?? league)
}

export function footballPopularityRank(leagueId: number | null | undefined, leagueKey?: string): number {
  if (leagueId != null && POPULAR_SET.has(leagueId)) return 0
  const id = leagueKey ? apiFootballLeagueIdFromKey(leagueKey) : null
  if (id != null && POPULAR_SET.has(id)) return 0
  return 1
}

export function encodeApiFootballEventId(fixtureId: number): string {
  return `af-${fixtureId}`
}

export function parseApiFootballEventId(eventId: string): number | null {
  const m = eventId.trim().match(/^af-(\d+)$/)
  if (m) return Number(m[1])
  if (/^\d+$/.test(eventId.trim())) return Number(eventId.trim())
  return null
}
