import { hasNumericFact } from './closed-book-packet'
import type {
  ConsensusSnapshot,
  CryptoSnapshot,
  RelatedInstrumentStat,
  SlowDataSnapshot,
} from './closed-book-packet'
import type { ResearchTier } from './research-tier'
import type { ResearchLang } from './relations'

/**
 * Two-stage research director (pure). Category-agnostic: it never ships a
 * gold list / crypto list. Stage 1 lists what a competent analyst would want
 * for THIS proposition (inventory-blind). Stage 2 marks each need against
 * the packet inventory and emits search queries only for MISSING needs.
 */

export const TIGHT_QUERY_BUDGET = 2
export const NORMAL_QUERY_BUDGET = 4
export const HIGH_QUERY_BUDGET = 12

export const QUERY_BUDGET: Record<ResearchTier, number> = {
  tight: TIGHT_QUERY_BUDGET,
  normal: NORMAL_QUERY_BUDGET,
  high: HIGH_QUERY_BUDGET,
}

const LANG_NAMES: Record<ResearchLang, string> = { ko: 'Korean', ja: 'Japanese', zh: 'Chinese' }

export type NeedGroup = 'structural_drivers' | 'near_term_catalysts'

export type DirectorNeed = { need: string; why: string; group?: NeedGroup }

export type DirectorCoverage = {
  need: string
  status: 'already_present' | 'missing'
  query: string | null
  lang?: string
}

export type DirectorQuery = { q: string; lang: string }

export type ParsedDirector = {
  needs: DirectorNeed[]
  coverage: DirectorCoverage[]
  queries: DirectorQuery[]
}

export type PacketInventoryInput = {
  instrument: string
  category: string
  horizon: string
  seriesLength: number
  seriesAsOf: string | null
  anchorClose: number | null
  consensus: ConsensusSnapshot | null
  crypto: CryptoSnapshot | null
  related: readonly RelatedInstrumentStat[] | null | undefined
  slow: SlowDataSnapshot | null | undefined
}

function avail(label: string, value: string): string {
  return `${label}: ${value}`
}

function snapLine(label: string, field: { unavailable: string } | object | null | undefined): string | null {
  if (field == null) return null
  if ('unavailable' in field) return avail(label, `UNAVAILABLE (${(field as { unavailable: string }).unavailable})`)
  return avail(label, JSON.stringify(field))
}

/** Compact field-name inventory the director Stage 2 matches against. */
export function buildPacketInventory(input: PacketInventoryInput): string {
  const lines: string[] = [
    `instrument: ${input.instrument}`,
    `category: ${input.category}`,
    `horizon: ${input.horizon}`,
    `series_bars: ${input.seriesLength}`,
    `anchor_close: ${input.anchorClose == null ? 'UNAVAILABLE' : String(input.anchorClose)}`,
    `series_as_of: ${input.seriesAsOf ?? 'unknown'}`,
    `base_rate: computed locally from the series (see BASE RATE block)`,
    `realized_vol: computed locally from the series`,
    `sma20_sma50_52w: computed locally from the series`,
  ]
  if (!input.consensus) {
    lines.push('consensus: not fetched for this category')
  } else {
    lines.push(snapLine('consensus.price_target', input.consensus.priceTarget) ?? 'consensus.price_target: n/a')
    lines.push(snapLine('consensus.recommendations', input.consensus.recommendations) ?? 'consensus.recommendations: n/a')
    lines.push(snapLine('consensus.last_earnings', input.consensus.lastEarnings) ?? 'consensus.last_earnings: n/a')
    lines.push(snapLine('consensus.latest_rating', input.consensus.latestRating) ?? 'consensus.latest_rating: n/a')
    lines.push(snapLine('consensus.eps_trend', input.consensus.epsTrend) ?? 'consensus.eps_trend: n/a')
  }
  if (input.crypto) {
    lines.push(snapLine('crypto.funding', input.crypto.funding) ?? 'crypto.funding: n/a')
    lines.push(snapLine('crypto.open_interest', input.crypto.openInterest) ?? 'crypto.open_interest: n/a')
    lines.push(snapLine('crypto.mark_iv', input.crypto.markIv) ?? 'crypto.mark_iv: n/a')
  }
  if (input.related?.length) {
    for (const s of input.related) {
      if ('unavailable' in s) {
        lines.push(`related.${s.symbol}: UNAVAILABLE (${s.unavailable})`)
      } else {
        lines.push(
          `related.${s.symbol} [${s.role}]: last ${s.lastClose} on ${s.lastDate}; 1d ${s.move1dPct ?? 'n/a'}%; corr20 ${s.corr?.r ?? 'n/a'}`,
        )
      }
    }
  } else {
    lines.push('related_instruments: none')
  }
  const slow = input.slow
  if (!slow) {
    lines.push('slow_public_data: none for this category')
  } else {
    for (const [key, field] of [
      ['short_volume', slow.shortVolume],
      ['put_call', slow.putCall],
      ['btc_etf_flow', slow.btcEtfFlow],
      ['insider_form4', slow.insider],
      ['real_yield_10y_tips', slow.realYield10y],
      ['cot_gold', slow.cotGold],
      ['cot_silver', slow.cotSilver],
      ['gld_holdings_tonnes', slow.gldHoldings],
      ['slv_holdings_tonnes', slow.slvHoldings],
      ['gold_silver_ratio', slow.goldSilverRatio],
    ] as const) {
      const line = snapLine(key, field)
      if (line) lines.push(line)
    }
  }
  return lines.join('\n')
}

/** Stage 1 is inventory-blind and must not name any asset-class shopping list. */
export function buildStage1Prompt(): string {
  return [
    'You are the research director for a prediction league. Stage 1 only.',
    '',
    'A competent analyst is judging this proposition. The Category field names the asset class of the instrument — a fact about the proposition, not a shopping list of data feeds. Use it to recall how that class is driven. Do not output a canned feed list.',
    '',
    'List INFORMATION NEEDS in TWO groups. List structural_drivers first, then near_term_catalysts.',
    '1) structural_drivers — what systematically moves this instrument class, even on a quiet day. These are the persistent drivers a specialist in this asset would name regardless of how soon the deadline is.',
    '2) near_term_catalysts — what could move the price between now and the resolution deadline (scheduled prints, event risk, positioning flushes, calendar effects).',
    '',
    'A short horizon must NOT collapse the list to gap, open, or weekend-headline items. Structural drivers still belong. A long horizon still needs near-term catalysts that are live now.',
    'Category-agnostic: do not emit a canned list for any bucket. Derive both groups from the instrument class and the proposition (what would change the forecast if it were known).',
    'Each need is one concrete fact-class (a number, a positioning print, a scheduled event, a flow, a policy decision) — not a vague theme.',
    'Aim for 6–10 needs total, mixing both groups. Include at least four structural_drivers.',
    '',
    'Output ONLY a JSON object, no markdown:',
    '{"needs":[{"need":"...","why":"...","group":"structural_drivers"|"near_term_catalysts"}]}',
    '',
    'Rules:',
    '- Do not mention any packet, inventory, or data feed.',
    '- Do not write search queries yet.',
    '- Do not name specific data vendors or file formats.',
  ].join('\n')
}

export function buildStage2Prompt(tier: ResearchTier, languages: readonly ResearchLang[]): string {
  const budget = QUERY_BUDGET[tier]
  const langRule = languages.length
    ? `- ADDITIONALLY include exactly one MISSING-need query per language in [${languages
        .map((l) => `${l}: ${LANG_NAMES[l]}`)
        .join(', ')}], WRITTEN IN that language, targeting native-language sources. Set coverage.lang to that 2-letter code.`
    : ''
  return [
    'You are the research director for a prediction league. Stage 2 only.',
    '',
    'You receive (1) Stage 1 INFORMATION NEEDS and (2) PACKET INVENTORY of what the packet already contains.',
    'For each Stage 1 need, mark already_present if the inventory already contains that fact-class (even if the value is UNAVAILABLE — that field was attempted), else missing.',
    `For missing needs only, emit a self-contained web-search query (include the instrument name and "latest" or the current month). Cap English missing queries at ${budget} (prefer the most forecast-relevant).`,
    'already_present needs have query null.',
    langRule,
    '',
    'Output ONLY a JSON object, no markdown:',
    '{"coverage":[{"need":"...","status":"already_present"|"missing","query":null or "...","lang":"en"}]}',
    '',
    'Rules:',
    '- Do not invent needs that Stage 1 did not list.',
    '- Each query must be self-contained.',
    '- Prefer recency.',
    '- Never ask for a number the inventory already named.',
    '- lang is the 2-letter code of the language the query is written in (default en).',
  ].join('\n')
}

function asNeed(raw: unknown): DirectorNeed | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as { need?: unknown; why?: unknown; group?: unknown }
  const need = typeof obj.need === 'string' ? obj.need.trim() : ''
  if (!need) return null
  const why = typeof obj.why === 'string' ? obj.why.trim() : ''
  const group: NeedGroup | undefined =
    obj.group === 'structural_drivers' || obj.group === 'near_term_catalysts' ? obj.group : undefined
  return { need: need.slice(0, 240), why: why.slice(0, 400), ...(group ? { group } : {}) }
}

export function parseStage1Needs(rawText: string): DirectorNeed[] | { error: string } {
  const match = rawText.match(/\{[\s\S]*\}/)
  if (!match) return { error: 'director stage 1 output was not JSON' }
  let obj: { needs?: unknown }
  try {
    obj = JSON.parse(match[0]) as { needs?: unknown }
  } catch {
    return { error: 'director stage 1 JSON parse failed' }
  }
  const needs: DirectorNeed[] = []
  if (Array.isArray(obj.needs)) {
    for (const item of obj.needs) {
      const n = asNeed(item)
      if (n) needs.push(n)
    }
  }
  if (!needs.length) return { error: 'director stage 1 produced zero usable needs' }
  return needs
}

export function parseStage2Coverage(rawText: string): DirectorCoverage[] | { error: string } {
  const match = rawText.match(/\{[\s\S]*\}/)
  if (!match) return { error: 'director stage 2 output was not JSON' }
  let obj: { coverage?: unknown; queries?: unknown }
  try {
    obj = JSON.parse(match[0]) as { coverage?: unknown; queries?: unknown }
  } catch {
    return { error: 'director stage 2 JSON parse failed' }
  }
  const coverage: DirectorCoverage[] = []
  if (Array.isArray(obj.coverage)) {
    for (const item of obj.coverage) {
      if (!item || typeof item !== 'object') continue
      const row = item as { need?: unknown; status?: unknown; query?: unknown; lang?: unknown }
      const need = typeof row.need === 'string' ? row.need.trim() : ''
      if (!need) continue
      const status = row.status === 'already_present' ? 'already_present' : 'missing'
      const query = typeof row.query === 'string' && row.query.trim() ? row.query.trim().slice(0, 300) : null
      const lang = typeof row.lang === 'string' ? row.lang.trim().toLowerCase() : undefined
      coverage.push({
        need: need.slice(0, 240),
        status,
        query: status === 'missing' ? query : null,
        lang,
      })
    }
  }
  // Legacy {"queries":[...]} — treat as all-missing.
  if (!coverage.length && Array.isArray(obj.queries)) {
    for (const item of obj.queries) {
      let q: string | null = null
      let lang = 'en'
      if (typeof item === 'string') q = item
      else if (item && typeof item === 'object') {
        const rec = item as { q?: unknown; lang?: unknown }
        if (typeof rec.q === 'string') q = rec.q
        if (typeof rec.lang === 'string') lang = rec.lang
      }
      if (q && q.trim()) {
        coverage.push({ need: q.trim().slice(0, 240), status: 'missing', query: q.trim().slice(0, 300), lang })
      }
    }
  }
  if (!coverage.length) return { error: 'director stage 2 produced zero coverage rows' }
  return coverage
}

/**
 * English missing queries capped at `maxEnglish`. One extra query per
 * allowed non-English lang, additive. already_present rows never search.
 */
export function selectQueriesFromCoverage(
  coverage: readonly DirectorCoverage[],
  maxEnglish: number,
  allowedLangs: ReadonlySet<string>,
  fallbackNeeds: readonly DirectorNeed[] = [],
  instrument = '',
): DirectorQuery[] {
  const english: DirectorQuery[] = []
  const byLang = new Map<string, DirectorQuery>()
  const seen = new Set<string>()

  const push = (q: string, lang: string) => {
    const key = `${lang}|${q}`
    if (seen.has(key)) return
    seen.add(key)
    if (lang === 'en') {
      if (english.length < maxEnglish) english.push({ q, lang: 'en' })
      return
    }
    if (allowedLangs.has(lang) && !byLang.has(lang)) byLang.set(lang, { q, lang })
  }

  for (const row of coverage) {
    if (row.status !== 'missing') continue
    const q = row.query?.trim()
    if (!q) continue
    const lang = row.lang && allowedLangs.has(row.lang) ? row.lang : 'en'
    push(q, lang)
  }

  if (!english.length && fallbackNeeds.length) {
    for (const n of fallbackNeeds) {
      const q = instrument ? `${instrument} latest ${n.need}` : n.need
      push(q.slice(0, 300), 'en')
    }
  }

  return [...english, ...byLang.values()]
}

export function parseDirectorOutput(
  rawText: string,
  maxEnglishQueries: number,
  allowedLangs: ReadonlySet<string>,
): ParsedDirector | { error: string } {
  const needs = parseStage1Needs(rawText)
  const coverage = parseStage2Coverage(rawText)
  const needList = 'error' in needs ? [] : needs
  const covList = 'error' in coverage ? [] : coverage
  if (!needList.length && !covList.length) {
    return { error: 'error' in needs ? needs.error : 'error' in coverage ? coverage.error : 'director produced nothing' }
  }
  const queries = selectQueriesFromCoverage(covList, maxEnglishQueries, allowedLangs, needList)
  return { needs: needList, coverage: covList, queries }
}

const ISO_DATE = /\b20\d{2}-\d{2}-\d{2}\b/
const NAMED_DATE = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+20\d{2}\b/i
const DAY_MON_YEAR = /\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+20\d{2}\b/i
const URL_RE = /https?:\/\/[^\s)]+/i

export function hasAsOfDate(text: string): boolean {
  return ISO_DATE.test(text) || NAMED_DATE.test(text) || DAY_MON_YEAR.test(text)
}

export function hasSourceUrl(summary: string, citations?: readonly string[]): boolean {
  if (URL_RE.test(summary)) return true
  return Boolean(citations?.some((c) => URL_RE.test(c)))
}

/** Findings need a number, a date, and a source URL (body or citation). */
export function isAdmissibleFinding(summary: string, citations?: readonly string[]): boolean {
  const text = summary.trim()
  if (!text) return false
  if (!hasNumericFact(text)) return false
  if (!hasAsOfDate(text)) return false
  return hasSourceUrl(text, citations)
}

export function attachSourceUrl(summary: string, citations?: readonly string[]): string {
  if (URL_RE.test(summary)) return summary
  const url = citations?.find((c) => URL_RE.test(c))
  return url ? `${summary.trim()} Source: ${url}` : summary
}

/** True when every Stage 1 need was already in the packet (no web search). */
export function allNeedsPresent(coverage: readonly DirectorCoverage[]): boolean {
  return coverage.length > 0 && coverage.every((c) => c.status === 'already_present')
}
