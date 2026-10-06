/**
 * Structured research findings for the deep report. Pure: no I/O.
 *
 * Every research seat returns JSON findings. This module parses them,
 * drops anything that is not a substantive claim (headings, query tags,
 * "none found", table fragments, empty source stubs), merges duplicates
 * across providers with an agreement count, and assigns evidence refs
 * (E1, E2, …) that debaters and the chair cite.
 */
import { admitEvidenceClaim, classifySourceTier, type SourceTier } from './deep-report-dossier'
import { RESEARCH_ANGLES, type ResearchAngle } from './deep-report-policy'
import { parseJsonObject } from './json-object'

export type FindingSide = 'yes' | 'no' | 'context'

export type ResearchFinding = {
  claim: string
  date: string | null
  sourceTitle: string | null
  sourceUrl: string | null
  tier: SourceTier
  side: FindingSide
  queryKey: ResearchAngle
  providers: string[]
  ref?: string
}

const TIERS: readonly SourceTier[] = ['official', 'regulator', 'major_outlet', 'rumor', 'other']
const SIDES: readonly FindingSide[] = ['yes', 'no', 'context']

const TIER_RANK: Record<SourceTier, number> = {
  official: 0,
  regulator: 1,
  major_outlet: 2,
  other: 3,
  rumor: 4,
}

/** JSON schema every research seat must follow (also sent to Perplexity as response_format). */
export const RESEARCH_FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          claim: { type: 'string' },
          date: { type: ['string', 'null'] },
          source_title: { type: 'string' },
          source_url: { type: ['string', 'null'] },
          tier: { type: 'string', enum: [...TIERS] },
          side: { type: 'string', enum: [...SIDES] },
          query_key: { type: 'string', enum: [...RESEARCH_ANGLES] },
        },
        required: ['claim', 'date', 'source_title', 'source_url', 'tier', 'side', 'query_key'],
      },
    },
  },
  required: ['findings'],
} as const

const QUERY_TAG_SRC = String.raw`\[\s*(?:[a-z]{2}(?:-[A-Za-z]{2})?)\s*\/\s*[a-z_0-9]+\s*\]`
const QUERY_TAG = new RegExp(QUERY_TAG_SRC, 'gi')
const HAS_QUERY_TAG = new RegExp(QUERY_TAG_SRC, 'i')
const NONE_FOUND =
  /^(?:none(?: found)?|no (?:results?|evidence|data)(?: found)?|not found|n\/?a|nothing found|없음|해당 ?없음|자료 ?없음|확인되지 않음|該当なし|なし|未找到|無|rien trouvé|aucun|no se encontró|ninguno|nada encontrado|لا يوجد)[.。!]?$/i
const EMPTY_SOURCE_SRC = String.raw`[(（]\s*(?:출처|source|sources|출전|来源|來源|出典|fuente|fonte|المصدر)\s*[:：]?\s*[)）]`
const EMPTY_SOURCE = new RegExp(EMPTY_SOURCE_SRC, 'gi')
const HAS_EMPTY_SOURCE = new RegExp(EMPTY_SOURCE_SRC, 'i')
const SOURCE_STUB = /[(（]\s*(?:출처|source|sources|出典|來源|fuente|fonte)\s*[:：][^)）]*[)）]/gi
const CITATION = /\[(?:web|news|src|source)?:?\s*\d+(?:\s*[,–-]\s*\d+)*\]|【[^】]*】/gi

/** Strip markdown, tags, and citation residue from one claim. */
export function cleanClaimText(raw: string): string {
  return raw
    .replace(QUERY_TAG, ' ')
    .replace(CITATION, ' ')
    .replace(EMPTY_SOURCE, ' ')
    .replace(/\*\*|__|`/g, '')
    .replace(/^[\s>*#\-•·|]+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/[\s*#|]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function letterCount(text: string): number {
  return (text.match(/[\p{L}\p{N}]/gu) ?? []).length
}

/**
 * Why a raw claim line is NOT a finding, or null when it is substantive.
 * Applied to the raw text before cleaning so heading/tag/table shapes are visible.
 */
export function nonFindingReason(raw: string): string | null {
  const text = raw.trim()
  if (!text) return 'empty'
  if (/^#{1,6}\s/.test(text)) return 'heading'
  if ((text.match(/\|/g) ?? []).length >= 2) return 'table_fragment'
  if (/^\s*[|:\-\s]+$/.test(text)) return 'table_rule'
  const hadTag = HAS_QUERY_TAG.test(text)
  if (/^\*[^*].*\*\*$/.test(text) || /^\*\*[^*]+\*\*:?$/.test(text)) return 'heading'
  const withoutStub = text.replace(SOURCE_STUB, ' ')
  const cleaned = cleanClaimText(withoutStub)
  if (!cleaned) return HAS_EMPTY_SOURCE.test(text) ? 'empty_source' : 'empty'
  if (NONE_FOUND.test(cleaned)) return 'none_found'
  if (/\bnone found\b/i.test(cleaned) && letterCount(cleaned) < 40) return 'none_found'
  if (hadTag && letterCount(cleaned) < 30) return 'query_tag'
  if (/^[.,;:)\]]/.test(text)) return 'fragment'
  if (/[?？]$/.test(cleaned)) return 'question'
  if (letterCount(cleaned) < 15) return 'too_short'
  return null
}

const ISO_DATE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/

function normalizeDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  const m = text.match(ISO_DATE)
  if (!m) return null
  const year = Number(m[1])
  if (year < 1990 || year > 2100) return null
  if (m[2] && (Number(m[2]) < 1 || Number(m[2]) > 12)) return null
  if (m[3] && (Number(m[3]) < 1 || Number(m[3]) > 31)) return null
  return text
}

function normalizeUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const text = raw.trim().replace(/[),.;\]]+$/, '')
  if (!/^https?:\/\/[^\s/]+\.[^\s]+/i.test(text)) return null
  return text
}

function normalizeTitle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const text = cleanClaimText(raw).replace(/^(?:출처|source)\s*[:：]\s*/i, '').trim()
  if (!text || NONE_FOUND.test(text) || letterCount(text) < 2) return null
  return text.slice(0, 120)
}

function hostOf(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

function asAngle(raw: unknown): ResearchAngle {
  if (typeof raw === 'string') {
    const key = raw.replace(QUERY_TAG, '').trim().toLowerCase().split('/').pop() ?? ''
    const hit = RESEARCH_ANGLES.find((angle) => angle === key)
    if (hit) return hit
  }
  return 'changed_30d'
}

const RUMOR = /\b(rumou?r|unconfirmed|leak(?:ed|s)?|tipster)\b|카더라|찌라시|소문|루머|유출/i

/** URL/title evidence may lift a secondary tier to a primary one; it never swaps official ↔ regulator. */
function upgradeTier(tier: SourceTier, classified: SourceTier): SourceTier {
  if (classified === 'other' || TIER_RANK[tier] < TIER_RANK.major_outlet) return tier
  return TIER_RANK[classified] < TIER_RANK[tier] ? classified : tier
}

/**
 * One raw finding object → a clean finding, or null when it is not substantive.
 * Requires a claim and at least one source (title or URL).
 */
export function admitFinding(
  raw: Record<string, unknown>,
  provider: string,
  category: string | null | undefined,
): ResearchFinding | null {
  const rawClaim = typeof raw.claim === 'string' ? raw.claim : ''
  if (nonFindingReason(rawClaim)) return null
  const admitted = admitEvidenceClaim(cleanClaimText(rawClaim.replace(SOURCE_STUB, ' ')), category)
  if (!admitted) return null
  const claim = admitted.length > 280 ? `${admitted.slice(0, 277).trimEnd()}…` : admitted
  const sourceUrl = normalizeUrl(raw.source_url ?? raw.url)
  const sourceTitle = normalizeTitle(raw.source_title ?? raw.source) ?? hostOf(sourceUrl)
  if (!sourceTitle && !sourceUrl) return null
  const modelTier = typeof raw.tier === 'string' ? (raw.tier.trim().toLowerCase() as SourceTier) : null
  const classified = classifySourceTier(sourceUrl, `${sourceTitle ?? ''} ${claim}`)
  const declared: SourceTier = modelTier && TIERS.includes(modelTier) ? modelTier : classified
  const tier: SourceTier = RUMOR.test(claim) ? 'rumor' : upgradeTier(declared, classified)
  const sideRaw = typeof raw.side === 'string' ? raw.side.trim().toLowerCase() : ''
  const side: FindingSide = SIDES.includes(sideRaw as FindingSide) ? (sideRaw as FindingSide) : 'context'
  return {
    claim,
    date: normalizeDate(raw.date),
    sourceTitle,
    sourceUrl,
    tier,
    side,
    queryKey: asAngle(raw.query_key ?? raw.queryKey ?? raw.angle),
    providers: [provider],
  }
}

export type ParsedFindings = {
  /** False when the text was not a JSON findings object (or was truncated). */
  parsed: boolean
  findings: ResearchFinding[]
  dropped: number
}

/** A seat's raw text → clean findings. Truncated or non-JSON text parses as `parsed: false`. */
export function parseResearchFindings(
  text: string | null | undefined,
  provider: string,
  category: string | null | undefined,
): ParsedFindings {
  const obj = text ? parseJsonObject(text) : null
  const list = obj && Array.isArray(obj.findings) ? obj.findings : null
  if (!list) return { parsed: false, findings: [], dropped: 0 }
  const findings: ResearchFinding[] = []
  let dropped = 0
  for (const item of list) {
    if (!item || typeof item !== 'object') {
      dropped += 1
      continue
    }
    const finding = admitFinding(item as Record<string, unknown>, provider, category)
    if (finding) findings.push(finding)
    else dropped += 1
  }
  return { parsed: true, findings, dropped }
}

function claimKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .slice(0, 400)
}

function bigrams(text: string): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i < text.length - 1; i += 1) out.add(text.slice(i, i + 2))
  return out
}

/** Dice coefficient on character bigrams — language-agnostic (works for Hangul and Latin). */
export function claimSimilarity(a: string, b: string): number {
  const ka = claimKey(a)
  const kb = claimKey(b)
  if (!ka || !kb) return 0
  if (ka === kb) return 1
  if (ka.length > 24 && kb.length > 24 && (ka.includes(kb) || kb.includes(ka))) return 0.95
  const ba = bigrams(ka)
  const bb = bigrams(kb)
  let overlap = 0
  for (const gram of ba) if (bb.has(gram)) overlap += 1
  return (2 * overlap) / (ba.size + bb.size || 1)
}

const MERGE_THRESHOLD = 0.58
const CROSS_SECTION_THRESHOLD = 0.8

function numberTokens(text: string): Set<string> {
  return new Set((text.match(/\d+/g) ?? []).map((n) => String(Number(n))))
}

/** Same facts: similar wording AND compatible numbers (dates, counts). */
export function sameFinding(a: Pick<ResearchFinding, 'claim' | 'queryKey'>, b: Pick<ResearchFinding, 'claim' | 'queryKey'>): boolean {
  const sim = claimSimilarity(a.claim, b.claim)
  if (sim < (a.queryKey === b.queryKey ? MERGE_THRESHOLD : CROSS_SECTION_THRESHOLD)) return false
  const na = numberTokens(a.claim)
  const nb = numberTokens(b.claim)
  if (na.size === 0 || nb.size === 0) return true
  let shared = 0
  for (const n of na) if (nb.has(n)) shared += 1
  return shared / new Set([...na, ...nb]).size >= 0.5
}

function betterOf(a: ResearchFinding, b: ResearchFinding): ResearchFinding {
  if (TIER_RANK[b.tier] < TIER_RANK[a.tier]) return b
  if (TIER_RANK[b.tier] > TIER_RANK[a.tier]) return a
  if (!a.sourceUrl && b.sourceUrl) return b
  return a
}

/**
 * Merge per-provider lists. Near-duplicate claims collapse into one row whose
 * `providers` lists every provider that found it (agreement = providers.length).
 */
export function mergeFindings(lists: ResearchFinding[][]): ResearchFinding[] {
  const merged: ResearchFinding[] = []
  for (const list of lists) {
    for (const finding of list) {
      const hit = merged.findIndex((row) => sameFinding(row, finding))
      if (hit === -1) {
        merged.push({ ...finding, providers: [...finding.providers] })
        continue
      }
      const prev = merged[hit]!
      const keep = betterOf(prev, finding)
      merged[hit] = {
        ...keep,
        date: keep.date ?? prev.date ?? finding.date,
        sourceUrl: keep.sourceUrl ?? prev.sourceUrl ?? finding.sourceUrl,
        sourceTitle: keep.sourceTitle ?? prev.sourceTitle ?? finding.sourceTitle,
        providers: [...new Set([...prev.providers, ...finding.providers])],
      }
    }
  }
  return merged
}

export type SearchResultRef = { title: string | null; url: string | null; date: string | null }

function urlKey(url: string): string {
  try {
    const u = new URL(url)
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`.toLowerCase()
  } catch {
    return url.toLowerCase()
  }
}

function hostLabel(host: string): string {
  const parts = host.split('.')
  return (parts.length > 2 ? parts[parts.length - 3]! : parts[0]!).toLowerCase()
}

/**
 * URLs a model writes inside structured JSON can be fabricated; the pages it
 * actually searched come back separately as `search_results`. Keep a finding's
 * URL only when it is one of those pages, otherwise attach the searched page
 * whose title / host best matches the cited source, or drop the link.
 * With no search results to check against, findings are returned unchanged.
 */
export function groundFindingUrls(findings: ResearchFinding[], results: readonly SearchResultRef[]): ResearchFinding[] {
  const pages = results
    .map((row) => ({ url: normalizeUrl(row.url), title: row.title ?? '', date: normalizeDate(row.date?.slice(0, 10)) }))
    .filter((row): row is { url: string; title: string; date: string | null } => Boolean(row.url))
  if (pages.length === 0) return findings
  const byKey = new Map(pages.map((page) => [urlKey(page.url), page]))
  return findings.map((finding) => {
    const exact = finding.sourceUrl ? byKey.get(urlKey(finding.sourceUrl)) : undefined
    let page = exact ?? null
    if (!page) {
      const citedHost = hostOf(finding.sourceUrl)
      const title = finding.sourceTitle ?? ''
      let best = 0
      for (const candidate of pages) {
        const host = hostOf(candidate.url) ?? ''
        const sameHost = (citedHost && host === citedHost) || (host && title.toLowerCase().includes(hostLabel(host)))
        const score = claimSimilarity(title, candidate.title) + (sameHost ? 0.5 : 0)
        if (score > best) {
          best = score
          page = candidate
        }
      }
      if (best < 0.6) page = null
    }
    if (!page) return { ...finding, sourceUrl: null }
    const classified = classifySourceTier(page.url, `${finding.sourceTitle ?? ''} ${finding.claim}`)
    const tier = finding.tier === 'rumor' ? 'rumor' : upgradeTier(finding.tier, classified)
    return { ...finding, sourceUrl: page.url, date: finding.date ?? page.date, tier }
  })
}

export function agreementOf(finding: Pick<ResearchFinding, 'providers'>): number {
  return finding.providers.length
}

/** Order by tier, then agreement, then recency; stamp E1…En. */
export function assignEvidenceRefs(findings: ResearchFinding[], limit = 40): ResearchFinding[] {
  return [...findings]
    .sort(
      (a, b) =>
        TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
        agreementOf(b) - agreementOf(a) ||
        (b.date ?? '').localeCompare(a.date ?? ''),
    )
    .slice(0, limit)
    .map((finding, index) => ({ ...finding, ref: `E${index + 1}` }))
}

/** Model-facing evidence list. Never shown to users. */
export function evidenceBlockForPrompt(findings: ResearchFinding[]): string {
  if (findings.length === 0) return '(no external evidence found — rely on the packet)'
  return findings
    .map((row) => {
      const meta = [row.tier, row.date ?? 'undated', row.sourceTitle ?? hostOf(row.sourceUrl) ?? 'source', `side=${row.side}`]
      return `${row.ref ?? '-'} [${meta.join(' · ')}] ${row.claim}`
    })
    .join('\n')
}

export function findingByRef(findings: ResearchFinding[], ref: string | null | undefined): ResearchFinding | null {
  if (!ref) return null
  const key = ref.trim().toUpperCase().replace(/[^E0-9]/g, '')
  return findings.find((row) => row.ref === key) ?? null
}

export type DossierSection = {
  key: ResearchAngle
  items: ResearchFinding[]
}

/** Clean dossier: findings grouped by query section, in the fixed angle order. Empty sections are omitted. */
export function dossierSections(findings: ResearchFinding[]): DossierSection[] {
  return RESEARCH_ANGLES.map((key) => ({ key, items: findings.filter((row) => row.queryKey === key) })).filter(
    (section) => section.items.length > 0,
  )
}
