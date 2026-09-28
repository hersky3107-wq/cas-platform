/**
 * Politics entity world. Instruments are server-encoded from the market slate.
 * Never invented from freeform text alone.
 *
 * ELECTION:{jurisdiction}:{office}:{cycle}:{district}:{candidate}:{pollCloseMs}
 */

import type { ElectionCandidateLite, PoliticsOffice } from '../../politics/markets'
import { POLITICS_WINDOW_MS } from '../../politics/markets'

export type PoliticsInstrumentParts = {
  jurisdiction: string
  office: PoliticsOffice
  cycle: string
  district: string
  candidate: string
  pollCloseMs: number
}

const OFFICES: readonly PoliticsOffice[] = ['president', 'senate', 'house', 'governor', 'mayor', 'other']

const OFFICE_KO: Record<PoliticsOffice, string> = {
  president: '대통령',
  senate: '상원',
  house: '하원',
  governor: '주지사',
  mayor: '시장',
  other: '선거',
}

const STATE_EN: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', IA: 'Iowa', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', MA: 'Massachusetts', MD: 'Maryland',
  ME: 'Maine', MI: 'Michigan', MN: 'Minnesota', MO: 'Missouri', MS: 'Mississippi',
  MT: 'Montana', NC: 'North Carolina', ND: 'North Dakota', NE: 'Nebraska', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NV: 'Nevada', NY: 'New York', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VA: 'Virginia',
  VT: 'Vermont', WA: 'Washington', WI: 'Wisconsin', WV: 'West Virginia', WY: 'Wyoming',
  DC: 'District of Columbia',
}

const STATE_KO: Record<string, string> = {
  AL: '앨라배마', AK: '알래스카', AZ: '애리조나', AR: '아칸소', CA: '캘리포니아',
  CO: '콜로라도', CT: '코네티컷', DE: '델라웨어', FL: '플로리다', GA: '조지아',
  HI: '하와이', IA: '아이오와', ID: '아이다호', IL: '일리노이', IN: '인디애나',
  KS: '캔자스', KY: '켄터키', LA: '루이지애나', MA: '매사추세츠', MD: '메릴랜드',
  ME: '메인', MI: '미시간', MN: '미네소타', MO: '미주리', MS: '미시시피',
  MT: '몬태나', NC: '노스캐롤라이나', ND: '노스다코타', NE: '네브래스카', NH: '뉴햄프셔',
  NJ: '뉴저지', NM: '뉴멕시코', NV: '네바다', NY: '뉴욕', OH: '오하이오',
  OK: '오클라호마', OR: '오리건', PA: '펜실베이니아', RI: '로드아일랜드', SC: '사우스캐롤라이나',
  SD: '사우스다코타', TN: '테네시', TX: '텍사스', UT: '유타', VA: '버지니아',
  VT: '버몬트', WA: '워싱턴', WI: '위스콘신', WV: '웨스트버지니아', WY: '와이오밍',
  DC: '워싱턴 D.C.',
}

const JURISDICTION_KO: Record<string, string> = {
  US: '미국',
  KR: '한국',
  BR: '브라질',
  UK: '영국',
  FR: '프랑스',
  DE: '독일',
  JP: '일본',
}

type Alias = { aliases: readonly string[]; canonical: string }

const PERSON_ALIASES: readonly Alias[] = [
  { aliases: ['donald trump', 'trump', '트럼프', '도널드 트럼프'], canonical: 'Donald Trump' },
  { aliases: ['kamala harris', 'harris', '해리스', '카말라 해리스'], canonical: 'Kamala Harris' },
  { aliases: ['lee jae-myung', 'lee jae myung', '이재명'], canonical: 'Lee Jae-myung' },
  { aliases: ['keisha lance bottoms', 'keisha bottoms', '케이샤 랜스 바텀스', '케이샤 바텀스', '바텀스'], canonical: 'Keisha Lance Bottoms' },
  { aliases: ['rick jackson', '릭 잭슨', '잭슨'], canonical: 'Rick Jackson' },
  { aliases: ['jon ossoff', 'ossoff', '존 오소프', '오소프'], canonical: 'Jon Ossoff' },
  { aliases: ['mike collins', '마이크 콜린스'], canonical: 'Mike Collins' },
  { aliases: ['greg abbott', 'abbott', '그렉 애벗', '그렉 애보트', '애벗'], canonical: 'Greg Abbott' },
  { aliases: ['kathy hochul', 'hochul', '캐시 호컬', '호컬'], canonical: 'Kathy Hochul' },
  { aliases: ['josh shapiro', 'shapiro', '조시 샤피로', '샤피로'], canonical: 'Josh Shapiro' },
  { aliases: ['jb pritzker', 'pritzker', '프리츠커', 'J.B. 프리츠커'], canonical: 'JB Pritzker' },
]

type OfficeAlias = { aliases: readonly string[]; office: PoliticsOffice; district: string }

function buildOfficeAliases(): readonly OfficeAlias[] {
  const list: OfficeAlias[] = []

  // Generic offices
  list.push({ aliases: ['대선', '대통령 선거', 'presidential', 'president', '미국 대선'], office: 'president', district: '_' })
  list.push({ aliases: ['주지사', 'governor', 'gubernatorial'], office: 'governor', district: '_' })
  list.push({ aliases: ['상원', '상원의원', 'senate', 'senator'], office: 'senate', district: '_' })
  list.push({ aliases: ['하원', '하원의원', 'house race', 'u.s. house', 'congressman', 'representative'], office: 'house', district: '_' })
  list.push({ aliases: ['시장', '시장 선거', 'mayor', 'mayoral'], office: 'mayor', district: '_' })

  // State-specific governor and senate aliases (e.g. "조지아 주지사", "Georgia Governor", "조지아 상원", "Georgia Senate")
  for (const [code, koName] of Object.entries(STATE_KO)) {
    const enName = STATE_EN[code]?.toLowerCase() ?? ''
    const codeLower = code.toLowerCase()
    // Governor
    const govAliases = [
      `${koName} 주지사`,
      `${koName}주지사`,
      `${koName} 주지사 선거`,
      `${codeLower} governor`,
      `${code} governor`,
    ]
    if (enName) {
      govAliases.push(`${enName} governor`, `${enName} gubernatorial`)
    }
    list.push({
      aliases: govAliases,
      office: 'governor',
      district: code,
    })
    // Senate
    const senAliases = [
      `${koName} 상원`,
      `${koName}상원`,
      `${koName} 상원의원`,
      `${koName} 상원 선거`,
      `${codeLower} senate`,
      `${code} senate`,
    ]
    if (enName) {
      senAliases.push(`${enName} senate`, `${enName} senator`)
    }
    list.push({
      aliases: senAliases,
      office: 'senate',
      district: code,
    })
  }

  // Pre-seed known house districts if common
  list.push({ aliases: ['애리조나 하원', 'arizona house', 'az-06', 'az-6'], office: 'house', district: 'AZ-6' })
  list.push({ aliases: ['뉴저지 5구역 하원', 'nj-5 house', 'nj-05 house'], office: 'house', district: 'NJ-5' })

  return list
}

const OFFICE_ALIASES: readonly OfficeAlias[] = buildOfficeAliases()

export function isPoliticsOffice(value: string): value is PoliticsOffice {
  return (OFFICES as readonly string[]).includes(value)
}

export function encodePoliticsInstrument(parts: PoliticsInstrumentParts): string {
  return [
    'ELECTION',
    parts.jurisdiction,
    parts.office,
    parts.cycle,
    parts.district || '_',
    encodeURIComponent(parts.candidate),
    String(parts.pollCloseMs),
  ].join(':')
}

export function decodePoliticsInstrument(instrument: string | null | undefined): PoliticsInstrumentParts | null {
  if (!instrument) return null
  const parts = instrument.split(':')
  if (parts.length !== 7 || parts[0] !== 'ELECTION') return null
  const jurisdiction = parts[1] ?? ''
  const office = parts[2] ?? ''
  const cycle = parts[3] ?? ''
  const district = parts[4] ?? '_'
  const candidate = decodeURIComponent(parts[5] ?? '')
  const pollCloseMs = Number(parts[6])
  if (!jurisdiction || !isPoliticsOffice(office) || !/^\d{4}$/.test(cycle)) return null
  if (!candidate || !Number.isFinite(pollCloseMs) || pollCloseMs <= 0) return null
  return { jurisdiction, office, cycle, district, candidate, pollCloseMs }
}

export function raceTitle(parts: Pick<PoliticsInstrumentParts, 'jurisdiction' | 'office' | 'cycle' | 'district'>): string {
  const where = JURISDICTION_KO[parts.jurisdiction] ?? parts.jurisdiction
  const office = OFFICE_KO[parts.office]
  if (parts.district && parts.district !== '_') {
    const house = parts.district.match(/^([A-Z]{2})-(\d+)$/)
    if (house) {
      const state = STATE_KO[house[1]!] ?? house[1]
      return `${parts.cycle} ${where} ${state} ${house[2]}구역 ${office}`
    }
    const state = STATE_KO[parts.district] ?? parts.district
    return `${parts.cycle} ${where} ${state} ${office}`
  }
  return `${parts.cycle} ${where} ${office}`
}

export function formatElectionProposition(parts: PoliticsInstrumentParts): string {
  return `${raceTitle(parts)} ${parts.candidate} 당선`
}

export function politicsChipLabel(row: ElectionCandidateLite): string {
  const parts: PoliticsInstrumentParts = {
    jurisdiction: row.jurisdiction,
    office: row.office,
    cycle: row.cycle,
    district: row.district,
    candidate: row.candidate,
    pollCloseMs: Date.parse(row.pollCloseIso),
  }
  return `${parts.candidate} · ${raceTitle(parts)}`
}

export function partsFromCandidate(row: ElectionCandidateLite): PoliticsInstrumentParts | null {
  const pollCloseMs = Date.parse(row.pollCloseIso)
  if (!Number.isFinite(pollCloseMs)) return null
  if (!isPoliticsOffice(row.office)) return null
  return {
    jurisdiction: row.jurisdiction,
    office: row.office,
    cycle: row.cycle,
    district: row.district || '_',
    candidate: row.candidate,
    pollCloseMs,
  }
}

export function instrumentForCandidate(row: ElectionCandidateLite): string | null {
  const parts = partsFromCandidate(row)
  return parts ? encodePoliticsInstrument(parts) : null
}

function namesMatch(a: string, b: string): boolean {
  const left = a.trim().toLowerCase()
  const right = b.trim().toLowerCase()
  if (!left || !right) return false
  if (left === right || left.includes(right) || right.includes(left)) return true
  const lt = left.split(/\s+/).filter(Boolean)
  const rt = right.split(/\s+/).filter(Boolean)
  return lt.length > 0 && rt.length > 0 && lt[0] === rt[0] && lt[lt.length - 1] === rt[rt.length - 1]
}

export type PoliticsMention = { kind: 'person' | 'office'; canonical: string; office?: PoliticsOffice; district?: string }

export function extractPoliticsMentions(raw: string): PoliticsMention[] {
  const lower = raw.toLowerCase()
  const hits: Array<PoliticsMention & { at: number }> = []
  for (const row of PERSON_ALIASES) {
    for (const alias of row.aliases) {
      const at = lower.indexOf(alias.toLowerCase())
      if (at >= 0) {
        hits.push({ kind: 'person', canonical: row.canonical, at })
        break
      }
    }
  }
  const officeHits: Array<OfficeAlias & { at: number; alias: string }> = []
  for (const row of OFFICE_ALIASES) {
    for (const alias of row.aliases) {
      const at = lower.indexOf(alias.toLowerCase())
      if (at >= 0) officeHits.push({ ...row, at, alias })
    }
  }
  officeHits.sort((a, b) => b.alias.length - a.alias.length || a.at - b.at)
  if (officeHits[0]) {
    const best = officeHits[0]
    hits.push({ kind: 'office', canonical: best.office, office: best.office, district: best.district, at: best.at })
  }
  hits.sort((a, b) => a.at - b.at)
  return hits.map(({ kind, canonical, office, district }) => ({ kind, canonical, office, district }))
}

export function slateNamesInText(raw: string, slate: readonly ElectionCandidateLite[]): string[] {
  const lower = raw.toLowerCase()
  const found: Array<{ name: string; at: number }> = []
  const seen = new Set<string>()
  const names = [...slate.map((r) => r.candidate)].sort((a, b) => b.length - a.length)
  for (const name of names) {
    if (name.length < 4) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    const at = lower.indexOf(key)
    if (at < 0) continue
    seen.add(key)
    found.push({ name, at })
  }
  found.sort((a, b) => a.at - b.at)
  return found.map((row) => row.name)
}

export function candidateMatches(row: ElectionCandidateLite, name: string): boolean {
  return namesMatch(row.candidate, name)
}

export function withinPoliticsHorizon(pollCloseMs: number, now: Date): boolean {
  const nowMs = now.getTime()
  return pollCloseMs > nowMs - 6 * 60 * 60 * 1000 && pollCloseMs <= nowMs + POLITICS_WINDOW_MS
}

export { POLITICS_WINDOW_MS }
