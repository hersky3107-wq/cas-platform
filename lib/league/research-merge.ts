/**
 * Normalize, de-duplicate, tier, and format PACKET-stage research findings.
 * Pure — no I/O. Dates are kept only when the source stated them.
 */

export const RESEARCH_SIDES = ['occurs', 'does_not_occur', 'neutral'] as const
export type ResearchSide = (typeof RESEARCH_SIDES)[number]

export const SOURCE_TIERS = ['official', 'regulator', 'major_outlet', 'rumor', 'other'] as const
export type SourceTier = (typeof SOURCE_TIERS)[number]

export type RawResearchFinding = {
  provider: string
  claim: string
  date: string | null
  url: string | null
  side: ResearchSide
  rumor: boolean
}

export type MergedResearchFact = {
  claim: string
  date: string | null
  urls: string[]
  side: ResearchSide
  rumor: boolean
  tier: SourceTier
  providers: string[]
  providerCount: number
}

export type ResearchDisagreement = {
  topic: string
  facts: MergedResearchFact[]
}

export type MergedResearch = {
  facts: MergedResearchFact[]
  disagreements: ResearchDisagreement[]
}

export type MultiSourceLog = {
  providersUsed: string[]
  providersFailed: Array<{ provider: string; error: string }>
  findingsPerProvider: Record<string, number>
  mergedCount: number
  costUsd: number
  wallMs: number
}

const TIER_RANK: Record<SourceTier, number> = {
  official: 0,
  regulator: 1,
  major_outlet: 2,
  rumor: 3,
  other: 4,
}

const OFFICIAL_HOSTS = [
  'apple.com',
  'news.samsung.com',
  'samsung.com',
  'nvidia.com',
  'openai.com',
  'anthropic.com',
  'deepmind.google',
  'ai.google',
  'blog.google',
  'microsoft.com',
  'news.microsoft.com',
  'meta.com',
  'about.fb.com',
  'sec.gov',
  'dart.fss.or.kr',
  'investor.apple.com',
  'blogs.nvidia.com',
]

const REGULATOR_HOSTS = [
  'fcc.gov',
  'fccid.io',
  'rra.go.kr',
  'radio.go.kr',
  'tenaa.com.cn',
  'tenaa.org.cn',
  'miit.gov.cn',
  'europa.eu',
  'ec.europa.eu',
  'bluetooth.com',
  'bluetooth.org',
]

const MAJOR_HOSTS = [
  'reuters.com',
  'bloomberg.com',
  'wsj.com',
  'ft.com',
  'nytimes.com',
  'washingtonpost.com',
  'apnews.com',
  'bbc.com',
  'bbc.co.uk',
  'theverge.com',
  'wired.com',
  'arstechnica.com',
  'techcrunch.com',
  'cnet.com',
  'theinformation.com',
  'cnbc.com',
  'nikkei.com',
  'asia.nikkei.com',
]

const RUMOR_HOSTS = [
  'macrumors.com',
  '9to5mac.com',
  '9to5google.com',
  'androidauthority.com',
  'sammobile.com',
  'wccftech.com',
  'videocardz.com',
  'semianalysis.com',
]

const DATE_ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/
const DATE_SLASH = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/
const DATE_MDY = /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})$/i
const MONTHS: Record<string, string> = {
  january: '01',
  february: '02',
  march: '03',
  april: '04',
  may: '05',
  june: '06',
  july: '07',
  august: '08',
  september: '09',
  october: '10',
  november: '11',
  december: '12',
}

export function parseStatedDate(raw: string | null | undefined): string | null {
  if (!raw) return null
  const text = raw.trim()
  if (!text) return null
  const iso = text.match(DATE_ISO)
  if (iso) return validYmd(iso[1], iso[2], iso[3])
  const slash = text.match(DATE_SLASH)
  if (slash) return validYmd(slash[1], slash[2].padStart(2, '0'), slash[3].padStart(2, '0'))
  const mdy = text.match(DATE_MDY)
  if (mdy) return validYmd(mdy[3], MONTHS[mdy[1].toLowerCase()], mdy[2].padStart(2, '0'))
  return null
}

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
    return host || null
  } catch {
    return null
  }
}

export function tierForUrl(url: string | null | undefined, rumor = false): SourceTier {
  const host = hostOf(url)
  if (!host) return rumor ? 'rumor' : 'other'
  if (hostMatches(host, OFFICIAL_HOSTS) || host.startsWith('investor.') || host.startsWith('ir.')) {
    return 'official'
  }
  if (hostMatches(host, REGULATOR_HOSTS)) return 'regulator'
  if (rumor) return 'rumor'
  if (hostMatches(host, MAJOR_HOSTS)) return 'major_outlet'
  if (hostMatches(host, RUMOR_HOSTS)) return 'rumor'
  return 'other'
}

export function normalizeClaim(claim: string): string {
  return claim
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9가-힣\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function mergeResearchFindings(raw: readonly RawResearchFinding[]): MergedResearch {
  const buckets = new Map<string, RawResearchFinding[]>()
  for (const finding of raw) {
    const claim = finding.claim.trim()
    if (!claim) continue
    const key = `${normalizeClaim(claim).slice(0, 96)}|${finding.side}`
    const list = buckets.get(key)
    if (list) list.push(finding)
    else buckets.set(key, [finding])
  }

  const facts: MergedResearchFact[] = []
  for (const group of buckets.values()) {
    const urls = unique(group.map((f) => f.url).filter((u): u is string => Boolean(u)))
    const providers = unique(group.map((f) => f.provider))
    const dates = unique(group.map((f) => parseStatedDate(f.date)).filter((d): d is string => Boolean(d)))
    const rumor = group.some((f) => f.rumor) || urls.some((u) => tierForUrl(u) === 'rumor')
    const tiers = (urls.length ? urls : [null]).map((u) => tierForUrl(u, rumor && !urls.length))
    const tier = bestTier(tiers)
    facts.push({
      claim: group[0]!.claim.trim(),
      date: dates[0] ?? null,
      urls,
      side: group[0]!.side,
      rumor: rumor && tier !== 'official' && tier !== 'regulator',
      tier,
      providers,
      providerCount: providers.length,
    })
  }

  facts.sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || b.providerCount - a.providerCount)

  const byTopic = new Map<string, MergedResearchFact[]>()
  for (const fact of facts) {
    const topic = topicKey(fact.claim)
    if (!topic) continue
    const list = byTopic.get(topic)
    if (list) list.push(fact)
    else byTopic.set(topic, [fact])
  }
  const disagreements: ResearchDisagreement[] = []
  for (const [topic, group] of byTopic) {
    const sides = new Set(group.map((f) => f.side).filter((s) => s !== 'neutral'))
    if (sides.has('occurs') && sides.has('does_not_occur')) {
      disagreements.push({ topic, facts: group })
    }
  }

  return { facts, disagreements }
}

export function formatMultiSourceSection(args: {
  merged: MergedResearch
  log: MultiSourceLog
}): string {
  const { merged, log } = args
  const used = log.providersUsed.length ? log.providersUsed.join(', ') : 'none measured'
  const failed = log.providersFailed.length
    ? log.providersFailed.map((f) => `${f.provider} (${f.error})`).join(', ')
    : 'none measured'
  const perProvider =
    Object.keys(log.findingsPerProvider).length === 0
      ? 'none measured'
      : Object.entries(log.findingsPerProvider)
          .map(([p, n]) => `${p}=${n}`)
          .join(' ')

  const lines = [
    'RESEARCH (MULTI-SOURCE)',
    `Providers used: ${used}`,
    `Providers failed: ${failed}`,
    `Findings per provider: ${perProvider}`,
    `Merged facts: ${log.mergedCount}`,
    `Cost: $${log.costUsd.toFixed(4)}  wall: ${log.wallMs}ms`,
    '',
  ]

  for (const tier of SOURCE_TIERS) {
    lines.push(tierHeading(tier))
    const rows = merged.facts.filter((f) => f.tier === tier)
    if (!rows.length) {
      lines.push('- none measured')
    } else {
      for (const fact of rows) lines.push(`- ${formatFactLine(fact)}`)
    }
  }

  lines.push('', 'AGREEMENT')
  const agreed = merged.facts.filter((f) => f.providerCount >= 2)
  if (!agreed.length) {
    lines.push('- none measured')
  } else {
    for (const fact of agreed) {
      lines.push(`- ${truncate(fact.claim, 140)} — ${fact.providerCount} providers`)
    }
  }

  lines.push('', 'SOURCES DISAGREE')
  if (!merged.disagreements.length) {
    lines.push('- none measured')
  } else {
    for (const row of merged.disagreements) {
      const bits = row.facts.map((f) => {
        const src = f.urls[0] ?? 'url not stated'
        return `${f.side} — ${f.date ?? 'date not stated'} ${src}`
      })
      lines.push(`- ${row.topic}: sources disagree; ${bits.join(' | ')}`)
    }
  }

  const occurs = merged.facts.filter((f) => f.side === 'occurs')
  const absent = merged.facts.filter((f) => f.side === 'does_not_occur')
  lines.push(
    '',
    'BOTH SIDES',
    `  argues occurs: ${occurs.length ? occurs.map((f) => formatFactLine(f)).join(' ; ') : 'none measured'}`,
    `  argues does not occur: ${absent.length ? absent.map((f) => formatFactLine(f)).join(' ; ') : 'none measured'}`,
  )
  return lines.join('\n')
}

export function parseResearchModeOutput(args: {
  provider: string
  text: string | null | undefined
  citations?: readonly string[]
  searchResults?: ReadonlyArray<{ url?: string; title?: string; date?: string; snippet?: string }>
}): RawResearchFinding[] {
  const fromJson = parseFindingsJson(args.provider, args.text)
  const extras: RawResearchFinding[] = []
  for (const row of args.searchResults ?? []) {
    const url = cleanUrl(row.url)
    if (!url) continue
    extras.push({
      provider: args.provider,
      claim: [row.title, row.snippet].filter(Boolean).join(' — ').trim() || url,
      date: parseStatedDate(row.date) ?? parseStatedDate(row.snippet) ?? parseStatedDate(row.title),
      url,
      side: 'neutral',
      rumor: false,
    })
  }
  if (fromJson.length) {
    const seen = new Set(fromJson.map((f) => `${normalizeClaim(f.claim)}|${f.url ?? ''}`))
    for (const extra of extras) {
      const key = `${normalizeClaim(extra.claim)}|${extra.url ?? ''}`
      if (!seen.has(key)) fromJson.push(extra)
    }
    return fromJson
  }
  if (extras.length) return extras
  for (const citation of args.citations ?? []) {
    const url = cleanUrl(citation)
    if (!url) continue
    extras.push({
      provider: args.provider,
      claim: url,
      date: parseStatedDate(url),
      url,
      side: 'neutral',
      rumor: false,
    })
  }
  return extras
}

function parseFindingsJson(provider: string, text: string | null | undefined): RawResearchFinding[] {
  if (!text) return []
  const parsed = extractJson(text)
  if (!parsed) return []
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { findings?: unknown }).findings)
      ? (parsed as { findings: unknown[] }).findings
      : []
  const out: RawResearchFinding[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const rec = row as Record<string, unknown>
    const claim = typeof rec.claim === 'string' ? rec.claim.trim() : ''
    const url = cleanUrl(typeof rec.url === 'string' ? rec.url : null)
    if (!claim || !url) continue
    const side = RESEARCH_SIDES.includes(rec.side as ResearchSide) ? (rec.side as ResearchSide) : 'neutral'
    out.push({
      provider,
      claim,
      date: parseStatedDate(typeof rec.date === 'string' ? rec.date : null),
      url,
      side,
      rumor: rec.rumor === true,
    })
  }
  return out
}

function extractJson(text: string): unknown | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const raw = (fenced?.[1] ?? text).trim()
  const start = raw.search(/[\[{]/)
  if (start < 0) return null
  const slice = raw.slice(start)
  try {
    return JSON.parse(slice)
  } catch {
    const endObj = slice.lastIndexOf('}')
    const endArr = slice.lastIndexOf(']')
    const end = Math.max(endObj, endArr)
    if (end <= 0) return null
    try {
      return JSON.parse(slice.slice(0, end + 1))
    } catch {
      return null
    }
  }
}

function cleanUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  const m = raw.trim().match(/https:\/\/[^\s)>"']+/i)
  if (!m) return null
  try {
    const url = new URL(m[0].replace(/[.,;]+$/, ''))
    if (url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

function formatFactLine(fact: MergedResearchFact): string {
  const date = fact.date ?? 'date not stated'
  const url = fact.urls[0] ?? 'url not stated'
  const rumor = fact.rumor || fact.tier === 'rumor' ? 'RUMOR ' : ''
  return `${rumor}${date} | ${url} | ${truncate(fact.claim, 180)} [${fact.providerCount} providers]`
}

function tierHeading(tier: SourceTier): string {
  switch (tier) {
    case 'official':
      return 'TIER official (newsroom / filing)'
    case 'regulator':
      return 'TIER regulator / certification'
    case 'major_outlet':
      return 'TIER major outlet'
    case 'rumor':
      return 'TIER rumor (reputable leaker / report — labeled RUMOR)'
    default:
      return 'TIER other'
  }
}

function topicKey(claim: string): string {
  return normalizeClaim(claim)
    .replace(/\b(not|no|never|denied|unannounced|announced|released|delayed|postponed|will|has|have|did|does)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

function bestTier(tiers: SourceTier[]): SourceTier {
  return tiers.reduce((best, t) => (TIER_RANK[t] < TIER_RANK[best] ? t : best), 'other')
}

function hostMatches(host: string, list: readonly string[]): boolean {
  return list.some((h) => host === h || host.endsWith(`.${h}`))
}

function unique(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of values) {
    if (seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}

function validYmd(y: string, m: string, d: string): string | null {
  const year = Number(y)
  const month = Number(m)
  const day = Number(d)
  const dt = new Date(Date.UTC(year, month - 1, day))
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null
  return `${y}-${m}-${d}`
}

function truncate(text: string, n: number): string {
  return text.length <= n ? text : `${text.slice(0, n - 1)}…`
}

/** Official seats in these categories must not see third-party tips or odds. */
export const PREDICTION_FILTER_CATEGORIES = new Set([
  'sports',
  'politics_election',
  'entertainment',
  'entertainment_awards',
])

const THIRD_PARTY_PREDICTION_RE =
  /prediction|predicted|win probability|\btips?\b|\bodds\b|\bbetting\b|\bpicks?\b|예측|승률\s*추정|배당|픽|scorebase|\d+\s*%\s*추정/i

export function isThirdPartyPredictionClaim(text: string): boolean {
  return THIRD_PARTY_PREDICTION_RE.test(text)
}

/** True when this text must be dropped from the official research packet. */
export function omitThirdPartyPredictionText(text: string, category: string | null | undefined): boolean {
  if (!category || !PREDICTION_FILTER_CATEGORIES.has(category)) return false
  return isThirdPartyPredictionClaim(text)
}
