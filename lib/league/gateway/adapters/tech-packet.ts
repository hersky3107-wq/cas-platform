import type { CategoryPacket, PacketBuildContext, PacketRound } from '../types'

export type TechResearchFinding = {
  query: string
  summary: string
  citations?: string[]
  searchResults?: { url?: string; title?: string; date?: string; snippet?: string }[]
}

/** Subset of `ResearchPacket` — kept here so this module stays test-importable. */
export type TechResearchPacket = {
  available: boolean
  cached: boolean
  cacheKey: string
  queries: string[]
  findings: TechResearchFinding[]
  costUsd: number
  tier: string
  multiSourceBlock?: string
  error?: string
}

import {
  TECH_BASE_RATES,
  TECH_RELATED,
  companyById,
  decodeTechInstrument,
  objectById,
} from './tech-catalog'
import { catalogCompanyForText, decodeOpenTechInstrument } from './tech-resolve'

/**
 * Tech packet IO. No price series, no Twelve Data. Research is the shared
 * multi-source packet (Perplexity + up to 3 scout search providers).
 */
export type TechPacketIo = {
  getResearchPacket(args: {
    round: PacketRound
    budgetRemainingUsd: number
    tier: 'normal'
  }): Promise<TechResearchPacket>
}

/**
 * Fresh normal-tier research is ~$0.03 (4 Perplexity queries, see
 * `lib/league/research-tier.ts`). Cache hit is $0. Twelve Data credits: 0.
 */
export const TECH_PACKET_FRESH_COST_USD = 0.03

const HTTPS_RE = /https:\/\/[^\s)>"']+/i

const MONTH_MAP: Record<string, string> = {
  january: '01',
  jan: '01',
  february: '02',
  feb: '02',
  march: '03',
  mar: '03',
  april: '04',
  apr: '04',
  may: '05',
  june: '06',
  jun: '06',
  july: '07',
  jul: '07',
  august: '08',
  aug: '08',
  september: '09',
  sept: '09',
  sep: '09',
  october: '10',
  oct: '10',
  november: '11',
  nov: '11',
  december: '12',
  dec: '12',
}

/**
 * Parses and normalizes dates from search results metadata, natural-language
 * prose, or URL paths to canonical `YYYY-MM-DD`.
 */
export function parseNormalizedDate(raw?: string | null): string | null {
  if (!raw || typeof raw !== 'string') return null
  const str = raw.trim()

  // 1. ISO date: YYYY-MM-DD (e.g. 2026-09-07 or 2026/09/07 or 2026.09.07)
  const isoMatch = str.match(/(?:^|[\s/._-])(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])(?:$|[\s/._-])/)
  if (isoMatch) {
    const [, y, m, d] = isoMatch
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  // 2. Korean date: YYYY년 MM월 DD일
  const koMatch = str.match(/(?:^|[\s/._-])(20\d{2})\s*년\s*(0?[1-9]|1[0-2])\s*월\s*(0?[1-9]|[12]\d|3[01])\s*일?/)
  if (koMatch) {
    const [, y, m, d] = koMatch
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  // 3. Month Day, Year (e.g. September 9, 2026; Sept. 9, 2026; Aug 25 2026; Sept. 5, 2026)
  const monthDayYearMatch = str.match(
    /(?:^|[\s/._-])(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember|t)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember))\s*\.?\s*(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})(?:$|[\s/._-])/i
  )
  if (monthDayYearMatch) {
    const [, monthStr, dayStr, yearStr] = monthDayYearMatch
    const m = MONTH_MAP[monthStr.toLowerCase()]
    if (m) {
      return `${yearStr}-${m}-${dayStr.padStart(2, '0')}`
    }
  }

  // 4. Day Month Year (e.g. 9 September 2026; 25 Aug 2026)
  const dayMonthYearMatch = str.match(
    /(?:^|[\s/._-])(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember|t)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember))\s*\.?,?\s+(20\d{2})(?:$|[\s/._-])/i
  )
  if (dayMonthYearMatch) {
    const [, dayStr, monthStr, yearStr] = dayMonthYearMatch
    const m = MONTH_MAP[monthStr.toLowerCase()]
    if (m) {
      return `${yearStr}-${m}-${dayStr.padStart(2, '0')}`
    }
  }

  return null
}

const REPUTABLE_DOMAINS = [
  'reuters.com',
  'bloomberg.com',
  'wsj.com',
  'ft.com',
  'nytimes.com',
  'bbc.com',
  'bbc.co.uk',
  'apnews.com',
  'theverge.com',
  'techcrunch.com',
  'wired.com',
  'arstechnica.com',
  'cnbc.com',
  'yonhapnews.co.kr',
  'yna.co.kr',
  'hankyung.com',
  'mk.co.kr',
  'apple.com',
  'nvidia.com',
  'samsung.com',
  'openai.com',
  'spacex.com',
  'microsoft.com',
  'blog.google',
  'about.fb.com',
  'sec.gov',
  'anthropic.com',
]

/** Host match only. A missing day is left null — never invented. */
export function isReputableTechUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
    return REPUTABLE_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))
  } catch {
    return false
  }
}

/**
 * Option C: a 0 same-class count is a first occurrence, not a 0% prior.
 * Keep the numeric line only when the class has history.
 */
export function formatSameClassOfficialPostsLine(count: number, asOf: string): string {
  if (count === 0) {
    return 'Same-class official posts last 12 months: FIRST OCCURRENCE — NO PRIOR BASELINE (novel product class)'
  }
  return `Same-class official posts last 12 months: ${count} (as of ${asOf})`
}

function cleanUrl(raw?: string | null): string | null {
  if (!raw || typeof raw !== 'string') return null
  const trimmed = raw.trim()
  const match = trimmed.match(HTTPS_RE)
  if (!match) return null
  return match[0].replace(/[),;.\]"']+$/, '')
}

export type SourcedFinding = {
  query: string
  url: string | null
  date: string | null
  summary: string
  usable: boolean
}

export type FindingInput =
  | TechResearchFinding
  | {
      query: string
      summary: string
      citations?: string[]
      searchResults?: { url?: string; title?: string; date?: string; snippet?: string }[]
    }

export function sourceFinding(
  arg1: string | FindingInput,
  arg2?: string,
  meta?: {
    citations?: string[]
    searchResults?: { url?: string; title?: string; date?: string; snippet?: string }[]
  },
): SourcedFinding {
  let query: string
  let summary: string
  let citations: string[] | undefined
  let searchResults: { url?: string; title?: string; date?: string; snippet?: string }[] | undefined

  if (typeof arg1 === 'object' && arg1 !== null) {
    query = arg1.query
    summary = arg1.summary
    citations = arg1.citations
    searchResults = arg1.searchResults
  } else {
    query = arg1
    summary = arg2 ?? ''
    citations = meta?.citations
    searchResults = meta?.searchResults
  }

  // 1. URL Extraction: structured citations / search_results first, prose regex fallback
  let url: string | null = null
  if (citations && citations.length > 0) {
    for (const c of citations) {
      const u = cleanUrl(c)
      if (u) {
        url = u
        break
      }
    }
  }
  if (!url && searchResults && searchResults.length > 0) {
    for (const r of searchResults) {
      const u = cleanUrl(r.url)
      if (u) {
        url = u
        break
      }
    }
  }
  if (!url) {
    url = cleanUrl(summary)
  }

  // 2. Date Extraction: structured search_results date first, then search_results snippet/title, then summary prose, then date in url
  let date: string | null = null
  if (searchResults && searchResults.length > 0) {
    for (const r of searchResults) {
      date = parseNormalizedDate(r.date) || parseNormalizedDate(r.snippet) || parseNormalizedDate(r.title)
      if (date) break
    }
  }
  if (!date) {
    date = parseNormalizedDate(summary)
  }
  if (!date && url) {
    date = parseNormalizedDate(url)
  }

  const usable = Boolean(url && (date || isReputableTechUrl(url)))

  return {
    query,
    url,
    date,
    summary: summary.trim(),
    usable,
  }
}

const DOES_NOT_OCCUR = /no product|not yet|hasn'?t|have not|will not|won'?t|postponed|denied|아직|없다|미발표|미공개/i

function sideLine(findings: SourcedFinding[]): string {
  if (findings.length === 0) return 'none measured'
  return findings
    .map((f) => `${f.date ?? 'date unavailable'} | ${f.url} | ${f.summary.slice(0, 160)}`)
    .join(' ; ')
}

export function assembleTechInjection(args: {
  round: PacketRound
  research: TechResearchPacket
}): string {
  const decoded = decodeTechInstrument(args.round.instrument)
  const open = decodeOpenTechInstrument(args.round.instrument)
  const company =
    (decoded ? companyById(decoded.companyId) : null) ??
    (open ? catalogCompanyForText(open.subjectSlug) : null)
  const object = decoded ? objectById(decoded.objectId) : null
  const base = company ? TECH_BASE_RATES[company.id] : undefined
  const related = company ? TECH_RELATED[company.id] ?? [] : []
  const subject = company?.label_en ?? open?.subjectSlug ?? 'UNAVAILABLE'
  const objectLabel = object?.label_en ?? (open ? open.objectSlug.replace(/_/g, ' ') : 'UNAVAILABLE')

  const sourced = args.research.findings.map((f) => sourceFinding(f))
  const usable = sourced.filter((f) => f.usable)
  const dropped = sourced.filter((f) => !f.usable)
  const occurs = usable.filter((f) => !DOES_NOT_OCCUR.test(f.summary))
  const absent = usable.filter((f) => DOES_NOT_OCCUR.test(f.summary))

  const lines: string[] = [
    'TECH PACKET — numbers first, prose last. No price series.',
    `Proposition: ${args.round.proposition_text}`,
    `Subject: ${subject}`,
    `Object: ${objectLabel}`,
    `Deadline: ${args.round.resolves_at.slice(0, 10)}`,
    `Window: events dated before the round open date do not count; count only after open and by ${args.round.resolves_at.slice(0, 10)}.`,
    `Resolution rule: ${args.round.resolution_rule}`,
    '',
    'BASE RATE (catalog prior when the subject is known; not a short-window trend)',
  ]
  if (base) {
    lines.push(`Official posts last 12 months: ${base.officialPostsLast12m} (as of ${base.asOf})`)
    lines.push(formatSameClassOfficialPostsLine(base.sameClassOfficialPostsLast12m, base.asOf))
  } else {
    lines.push('Official posts last 12 months: none measured')
    lines.push('Same-class official posts last 12 months: none measured')
  }

  lines.push('', 'RELATED COMPANY SIGNALS')
  if (related.length === 0) {
    lines.push('Related: none measured')
  } else {
    for (const rel of related) {
      const peer = companyById(rel.id)
      const peerBase = TECH_BASE_RATES[rel.id]
      const count = peerBase ? String(peerBase.officialPostsLast12m) : 'UNAVAILABLE'
      lines.push(`${peer?.label_en ?? rel.id} (${rel.role}): official posts last 12m = ${count}`)
    }
  }

  lines.push('', 'SOURCED FINDINGS (https URL plus a parsed date, or a reputable domain; dates are never invented)')
  if (!args.research.available) {
    lines.push(`Research: UNAVAILABLE${args.research.error ? ` (${args.research.error})` : ''}`)
  } else if (usable.length === 0) {
    lines.push('Usable findings: 0')
  } else {
    for (const f of usable) {
      lines.push(`${f.date ?? 'date unavailable'} | ${f.url} | ${f.summary.slice(0, 220)}`)
    }
  }
  if (dropped.length) {
    lines.push(`Dropped (missing url, or url without a date on an unknown domain): ${dropped.length}`)
  }
  lines.push(
    '',
    'BOTH SIDES — evidence for occurs / does not occur. Do not invent balance.',
    `  argues occurs: ${sideLine(occurs)}`,
    `  argues does not occur: ${sideLine(absent)}`,
  )
  if (args.research.multiSourceBlock) {
    lines.push('', args.research.multiSourceBlock)
  }
  return lines.join('\n')
}

export async function buildTechPacket(ctx: PacketBuildContext, io: TechPacketIo): Promise<CategoryPacket> {
  const research = await io.getResearchPacket({
    round: ctx.round,
    budgetRemainingUsd: ctx.costCapUsd,
    tier: 'normal',
  })
  const injection = assembleTechInjection({ round: ctx.round, research })
  return {
    injection,
    researchCacheKey: research.cacheKey,
    researchCostUsd: research.costUsd,
    dataPacket: { available: false, error: 'tech has no numeric feed' },
    research: {
      available: research.available,
      cached: research.cached,
      costUsd: Number(research.costUsd.toFixed(6)),
      queries: research.queries,
      tier: research.tier,
      tierSignal: 'tech: no price dispersion — fixed normal research tier (~$0.03 fresh, $0 cache)',
      error: research.error,
    },
    relatedCreditsSpent: 0,
  }
}
