/**
 * KBO and CPBL fixtures come from multi-provider search, not a paid odds API.
 * Instrument: MATCH:baseball_kbo|baseball_cpbl:{YYYY-MM-DDTHHMM}:{home}:{away}:{subject}
 * Kickoff token is KST wall time with the colon removed so the codec stays colon-split.
 */

import {
  DOMESTIC_BASEBALL_WINDOW_MS,
  isDomesticBaseballLeague,
  type DomesticBaseballLeague,
} from './types'

export type DomesticTeam = {
  league: DomesticBaseballLeague
  canonical: string
  ko: string
  ja: string
  zhTW: string
  aliases: readonly string[]
}

export const DOMESTIC_TEAMS: readonly DomesticTeam[] = [
  { league: 'baseball_kbo', canonical: 'KIA Tigers', ko: 'KIA 타이거즈', ja: 'KIAタイガース', zhTW: '起亞虎', aliases: ['kia tigers', 'kia', '기아', '기아 타이거즈', 'kia타이거즈'] },
  { league: 'baseball_kbo', canonical: 'Samsung Lions', ko: '삼성 라이온즈', ja: 'サムスンライオンズ', zhTW: '三星獅', aliases: ['samsung lions', '삼성', '삼성 라이온즈'] },
  { league: 'baseball_kbo', canonical: 'LG Twins', ko: 'LG 트윈스', ja: 'LGツインズ', zhTW: 'LG雙子', aliases: ['lg twins', 'lg', '엘지', 'lg 트윈스', '엘지 트윈스'] },
  { league: 'baseball_kbo', canonical: 'Doosan Bears', ko: '두산 베어스', ja: '斗山ベアーズ', zhTW: '斗山熊', aliases: ['doosan bears', 'doosan', '두산', '두산 베어스'] },
  { league: 'baseball_kbo', canonical: 'KT Wiz', ko: 'KT 위즈', ja: 'KTウィズ', zhTW: 'KT巫師', aliases: ['kt wiz', 'kt', '케이티', 'kt 위즈'] },
  { league: 'baseball_kbo', canonical: 'SSG Landers', ko: 'SSG 랜더스', ja: 'SSGランダース', zhTW: 'SSG登陸者', aliases: ['ssg landers', 'ssg', '랜더스', 'ssg 랜더스'] },
  { league: 'baseball_kbo', canonical: 'Lotte Giants', ko: '롯데 자이언츠', ja: 'ロッテジャイアンツ', zhTW: '樂天巨人', aliases: ['lotte giants', 'lotte', '롯데', '롯데 자이언츠'] },
  { league: 'baseball_kbo', canonical: 'Hanwha Eagles', ko: '한화 이글스', ja: 'ハンファイーグルス', zhTW: '韓火鷹', aliases: ['hanwha eagles', 'hanwha', '한화', '한화 이글스'] },
  { league: 'baseball_kbo', canonical: 'NC Dinos', ko: 'NC 다이노스', ja: 'NCダイノス', zhTW: 'NC恐龍', aliases: ['nc dinos', 'nc', '엔씨', 'nc 다이노스'] },
  { league: 'baseball_kbo', canonical: 'Kiwoom Heroes', ko: '키움 히어로즈', ja: 'キウムヒーローズ', zhTW: '培證英雄', aliases: ['kiwoom heroes', 'kiwoom', '키움', '키움 히어로즈'] },
  { league: 'baseball_cpbl', canonical: 'CTBC Brothers', ko: '중신 브라더스', ja: '中信兄弟', zhTW: '中信兄弟', aliases: ['ctbc brothers', 'ctbc', '중신', '중신 브라더스', '中信兄弟'] },
  { league: 'baseball_cpbl', canonical: 'Uni-President Lions', ko: '퉁이 라이온스', ja: '統一ライオンズ', zhTW: '統一獅', aliases: ['uni-president lions', 'uni lions', '퉁이', '퉁이 라이온스', '統一獅'] },
  { league: 'baseball_cpbl', canonical: 'Rakuten Monkeys', ko: '라쿠텐 몽키스', ja: '楽天モンキーズ', zhTW: '樂天桃猿', aliases: ['rakuten monkeys', '라쿠텐', '라쿠텐 몽키스', '樂天桃猿'] },
  { league: 'baseball_cpbl', canonical: 'Fubon Guardians', ko: '푸방 가디언스', ja: '富邦ガーディアンズ', zhTW: '富邦悍將', aliases: ['fubon guardians', '푸방', '푸방 가디언스', '富邦悍將'] },
  { league: 'baseball_cpbl', canonical: 'Wei Chuan Dragons', ko: '웨이취안 드래곤스', ja: '味全ドラゴンズ', zhTW: '味全龍', aliases: ['wei chuan dragons', 'weichuan', '웨이취안', '웨이취안 드래곤스', '味全龍'] },
  { league: 'baseball_cpbl', canonical: 'TSG Hawks', ko: 'TSG 호크스', ja: 'TSGホークス', zhTW: '台鋼雄鷹', aliases: ['tsg hawks', 'tsg', '호크스', 'tsg 호크스', '台鋼雄鷹'] },
]

export type DomesticIntent = {
  league: DomesticBaseballLeague
  teams: DomesticTeam[]
  subject: DomesticTeam
}

export type DomesticGame = {
  league: DomesticBaseballLeague
  home: string
  away: string
  kickoffMs: number
  venue: string | null
  subject: string
}

const ALIASES = DOMESTIC_TEAMS.flatMap((team) =>
  team.aliases.map((alias) => ({ alias: alias.toLowerCase(), team })),
).sort((a, b) => b.alias.length - a.alias.length)

export function displayDomesticTeam(
  canonical: string,
  locale: 'ko' | 'ja' | 'zh-TW' | string,
): string | null {
  const team = DOMESTIC_TEAMS.find((row) => row.canonical === canonical)
  if (!team) return null
  if (locale === 'ko') return team.ko
  if (locale === 'ja') return team.ja
  if (locale === 'zh-TW') return team.zhTW
  return team.canonical
}

export function parseDomesticBaseballIntent(raw: string): DomesticIntent | null {
  const lower = raw.toLowerCase()
  const found: DomesticTeam[] = []
  const occupied: Array<[number, number]> = []
  for (const row of ALIASES) {
    let from = 0
    while (from < lower.length) {
      const at = lower.indexOf(row.alias, from)
      if (at < 0) break
      const end = at + row.alias.length
      from = at + 1
      if (latinShortAlias(row.alias) && !latinTokenBoundary(lower, at, end)) continue
      if (occupied.some(([a, b]) => at < b && end > a)) continue
      if (found.some((team) => team.canonical === row.team.canonical)) break
      occupied.push([at, end])
      found.push(row.team)
      break
    }
    if (found.length === 2) break
  }
  if (!found.length) return null
  const league = found[0]!.league
  const teams = found.filter((team) => team.league === league)
  if (!teams.length) return null
  return { league, teams, subject: teams[0]! }
}

export function encodeDomesticBaseballInstrument(game: DomesticGame): string {
  const stamp = kstStamp(game.kickoffMs)
  return [
    'MATCH',
    game.league,
    stamp,
    encodeURIComponent(game.home),
    encodeURIComponent(game.away),
    encodeURIComponent(game.subject),
  ].join(':')
}

export function decodeDomesticBaseballInstrument(instrument: string): DomesticGame | null {
  const parts = instrument.split(':')
  if (parts.length !== 6 || parts[0] !== 'MATCH') return null
  const league = parts[1] ?? ''
  if (!isDomesticBaseballLeague(league)) return null
  const kickoffMs = parseKstStamp(parts[2] ?? '')
  const home = safeDecode(parts[3] ?? '')
  const away = safeDecode(parts[4] ?? '')
  const subject = safeDecode(parts[5] ?? '')
  if (!kickoffMs || !home || !away || !subject) return null
  return { league, home, away, kickoffMs, venue: null, subject }
}

export function gamesWithinWindow(games: readonly DomesticGame[], now: Date): DomesticGame[] {
  const start = now.getTime()
  const end = start + DOMESTIC_BASEBALL_WINDOW_MS
  return games
    .filter((game) => game.kickoffMs > start && game.kickoffMs <= end)
    .sort((a, b) => a.kickoffMs - b.kickoffMs)
}

export function gamesFromSearchText(text: string, now: Date, intent: DomesticIntent): DomesticGame[] {
  const lines = text.split(/\n+/)
  const games: DomesticGame[] = []
  const names = DOMESTIC_TEAMS.filter((team) => team.league === intent.league)
  for (const line of lines) {
    const dated = line.match(/(20\d{2})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/)
    if (!dated) continue
    const year = Number(dated[1])
    const month = Number(dated[2])
    const day = Number(dated[3])
    const hour = dated[4] ? Number(dated[4]) : 18
    const minute = dated[5] ? Number(dated[5]) : 30
    const kickoffMs = Date.parse(
      `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+09:00`,
    )
    if (!Number.isFinite(kickoffMs)) continue
    const mentioned = names.filter((team) => line.toLowerCase().includes(team.canonical.toLowerCase()) || line.includes(team.ko))
    if (mentioned.length < 2 && intent.teams.length < 2) {
      if (!mentioned.some((team) => team.canonical === intent.subject.canonical) && !line.includes(intent.subject.ko)) continue
    }
    const pair = mentioned.length >= 2 ? mentioned.slice(0, 2) : intent.teams.length >= 2 ? intent.teams : mentioned
    if (pair.length < 1) continue
    const home = pair[0]!.canonical
    const away = (pair[1] ?? pair[0]!).canonical
    if (home === away && intent.teams.length < 2) continue
    const venue = line.match(/(?:at|@|장소|구장)\s*[:：]?\s*([A-Za-z0-9가-힣 .]{2,40})/)
    const subject = intent.subject.canonical
    games.push({
      league: intent.league,
      home: intent.teams.length >= 2 ? intent.teams[0]!.canonical : home,
      away: intent.teams.length >= 2 ? intent.teams[1]!.canonical : away === home ? '' : away,
      kickoffMs,
      venue: venue?.[1]?.trim() ?? null,
      subject,
    })
  }
  return gamesWithinWindow(
    games.filter((game) => game.home && game.away && game.home !== game.away),
    now,
  )
}

export type DomesticResolution =
  | { kind: 'ready'; instrument: string; label: string }
  | { kind: 'picks'; options: Array<{ id: string; label: string }> }
  | { kind: 'none' }

export function resolveDomesticBaseball(
  intent: DomesticIntent,
  games: readonly DomesticGame[],
  now: Date,
): DomesticResolution {
  let open = gamesWithinWindow(games, now)
  if (intent.teams.length >= 2) {
    const want = new Set(intent.teams.map((team) => team.canonical))
    open = open.filter((game) => want.has(game.home) && want.has(game.away))
  } else {
    const name = intent.subject.canonical
    open = open.filter((game) => game.home === name || game.away === name || game.subject === name)
  }
  if (!open.length) return { kind: 'none' }
  const options = open.map((game) => ({
    id: encodeDomesticBaseballInstrument({ ...game, subject: intent.subject.canonical }),
    label: `${game.home} vs ${game.away}`,
  }))
  if (options.length === 1) {
    return { kind: 'ready', instrument: options[0]!.id, label: intent.subject.canonical }
  }
  return { kind: 'picks', options }
}

export function domesticSearchQueries(intent: DomesticIntent): string[] {
  const names = intent.teams.map((team) => team.ko).join(' ')
  return [
    `${names} 다음 경기 일정 7일 KST 구장 포스트시즌`,
    `${intent.teams.map((team) => team.canonical).join(' ')} next game schedule 7 days postseason KST venue`,
  ]
}

const PACKET_HEADINGS = [
  'announced starting pitchers',
  'recent form',
  'injuries and roster moves',
  'season head-to-head',
  'standings or series status',
] as const

export function formatDomesticBaseballPacket(game: DomesticGame, findings: readonly string[]): string {
  const body = findings.filter((line) => !/prediction|predicted|win probability|\bodds\b|betting|\btip\b|예측|배당|픽|scorebase/i.test(line))
  const blocks = PACKET_HEADINGS.map((heading) => {
    const rows = body.filter((line) => headingMatches(heading, line))
    const text = rows.length ? rows.map((row) => `- ${row}`).join('\n') : '- none measured'
    return `${heading.toUpperCase()}\n${text}`
  })
  return [
    'SPORTS PACKET — search-based, unverified.',
    `${game.home} vs ${game.away}`,
    `League: ${game.league}`,
    `Kickoff KST: ${kstStamp(game.kickoffMs)}`,
    game.venue ? `Venue: ${game.venue}` : 'Venue: none measured',
    'Final result including extra innings. A tie is No.',
    'BOTH SIDES. Missing facts stay "none measured". No third-party predictions, tips, or odds.',
    ...blocks,
  ].join('\n')
}

function latinShortAlias(alias: string): boolean {
  return alias.length <= 3 && /^[a-z0-9]+$/.test(alias)
}

function latinTokenBoundary(lower: string, at: number, end: number): boolean {
  const before = at === 0 || !/[a-z0-9]/i.test(lower[at - 1] ?? '')
  const after = end >= lower.length || !/[a-z0-9]/i.test(lower[end] ?? '')
  return before && after
}

function headingMatches(heading: (typeof PACKET_HEADINGS)[number], line: string): boolean {
  if (heading === 'announced starting pitchers') return /선발|pitcher|선발투수/i.test(line)
  if (heading === 'recent form') return /최근|form|연승|연패|last \d/i.test(line)
  if (heading === 'injuries and roster moves') return /엔트리|말소|등록|injury|부상|roster/i.test(line)
  if (heading === 'season head-to-head') return /상대\s*전적|head-to-head|맞대결/i.test(line)
  if (heading === 'standings or series status') return /순위|standings|시리즈|postseason|포스트시즌/i.test(line)
  return false
}

function kstStamp(ms: number): string {
  const shifted = new Date(ms + 9 * 3600_000)
  const y = shifted.getUTCFullYear()
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const d = String(shifted.getUTCDate()).padStart(2, '0')
  const hh = String(shifted.getUTCHours()).padStart(2, '0')
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0')
  return `${y}-${m}-${d}T${hh}${mm}`
}

function parseKstStamp(stamp: string): number | null {
  const match = stamp.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})$/)
  if (!match) return null
  const ms = Date.parse(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00+09:00`)
  return Number.isFinite(ms) ? ms : null
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
