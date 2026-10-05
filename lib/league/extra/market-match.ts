/**
 * Pure market-match rules for the consensus extra seat.
 * Official packets never import this. Relevance and the date window are
 * decided here so tests do not need a venue or an LLM.
 */
import { resolveAirankBrand } from '../ai-ranking/instrument'

export const MARKET_RELEVANCE_MIN = 0.7
export const MARKET_DATE_WINDOW_MS = 7 * 86_400_000

export type MarketVenue = 'kalshi' | 'polymarket'
export type ConsensusSource = MarketVenue | 'search' | 'none'

export type OpenMarketCandidate = {
  venue: MarketVenue
  id: string
  title: string
  outcome: string
  impliedYes: number
  resolvesAt: string | null
}

export type LlmMarketPick = {
  venue: MarketVenue
  id: string
  outcome: string
  relevance: number
  sameEvent: boolean
}

export type AcceptedMarketMatch = {
  venue: MarketVenue
  id: string
  title: string
  outcome: string
  impliedYes: number
  relevance: number
  resolvesAt: string | null
  sameEvent: boolean
  brand: string | null
}

export type ConsensusMarketRecord = {
  consensus_source: ConsensusSource
  consensus_market_id: string | null
  consensus_market_outcome: string | null
  consensus_implied_probability: number | null
  consensus_relevance: number | null
}

const QUERY_STOP = new Set([
  'the', 'a', 'an', 'of', 'to', 'and', 'or', 'for', 'will', 'be', 'by', 'on', 'in', 'at', 'end', 'this', 'that', 'with', 'from',
])

export function consensusMarketEligible(category: string | null | undefined, instrument: string | null | undefined): boolean {
  if (category === 'tech' || category === 'ai_models') return true
  const id = instrument ?? ''
  return id.startsWith('TECH:OPEN') || id.startsWith('AIRANK')
}

export function marketSearchQuery(args: {
  proposition: string
  deadline: string | null
  brandTable: boolean
}): string {
  if (args.brandTable) {
    const month = utcMonthName(args.deadline)
    return month
      ? `which company has the best AI model end of ${month}`
      : 'which company has the best AI model'
  }
  const tokens: string[] = []
  for (const raw of args.proposition.replace(/[^A-Za-z0-9가-힣.+/-]+/g, ' ').split(/\s+/)) {
    const token = raw.trim()
    if (token.length < 3 || QUERY_STOP.has(token.toLowerCase())) continue
    if (tokens.some((t) => t.toLowerCase() === token.toLowerCase())) continue
    tokens.push(token)
    if (tokens.length >= 8) break
  }
  const query = tokens.join(' ')
  return (query || args.proposition).slice(0, 160)
}

export function acceptMarketPick(args: {
  relevance: number
  marketResolvesAt: string | null
  deadline: string | null
  sameEvent: boolean
}): boolean {
  if (!Number.isFinite(args.relevance) || args.relevance < MARKET_RELEVANCE_MIN || args.relevance > 1) return false
  if (args.sameEvent) return true
  const marketMs = args.marketResolvesAt ? Date.parse(args.marketResolvesAt) : NaN
  const deadlineMs = args.deadline ? Date.parse(args.deadline) : NaN
  if (!Number.isFinite(marketMs) || !Number.isFinite(deadlineMs)) return false
  return Math.abs(marketMs - deadlineMs) <= MARKET_DATE_WINDOW_MS
}

export function mapOutcomeToBrand(outcome: string, candidates: readonly string[]): string | null {
  const resolved = resolveAirankBrand(outcome)
  const names = [outcome.trim(), resolved ?? ''].filter(Boolean)
  if (candidates.length === 0) return resolved
  for (const name of names) {
    const hit = candidates.find((c) => c.toLowerCase() === name.toLowerCase())
    if (hit) return hit
    if (resolved && candidates.some((c) => c.toLowerCase() === resolved.toLowerCase())) {
      return candidates.find((c) => c.toLowerCase() === resolved.toLowerCase()) ?? resolved
    }
  }
  return null
}

export function finalizeMarketPick(args: {
  pick: LlmMarketPick
  candidate: OpenMarketCandidate
  deadline: string | null
  brandTable: boolean
  brandCandidates: readonly string[]
}): AcceptedMarketMatch | null {
  if (args.pick.venue !== args.candidate.venue || args.pick.id !== args.candidate.id) return null
  if (!Number.isFinite(args.candidate.impliedYes) || args.candidate.impliedYes < 0 || args.candidate.impliedYes > 1) {
    return null
  }
  const accepted = acceptMarketPick({
    relevance: args.pick.relevance,
    marketResolvesAt: args.candidate.resolvesAt,
    deadline: args.deadline,
    sameEvent: args.pick.sameEvent,
  })
  if (!accepted) return null
  const brand = args.brandTable ? mapOutcomeToBrand(args.pick.outcome || args.candidate.outcome, args.brandCandidates) : null
  if (args.brandTable && !brand) return null
  return {
    venue: args.candidate.venue,
    id: args.candidate.id,
    title: args.candidate.title,
    outcome: args.pick.outcome || args.candidate.outcome,
    impliedYes: args.candidate.impliedYes,
    relevance: args.pick.relevance,
    resolvesAt: args.candidate.resolvesAt,
    sameEvent: args.pick.sameEvent,
    brand,
  }
}

export function parseMarketPickJson(text: string | null, candidates: readonly OpenMarketCandidate[]): LlmMarketPick | null {
  if (!text) return null
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let raw: unknown
  try {
    raw = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const venue = row.venue === 'kalshi' || row.venue === 'polymarket' ? row.venue : null
  const id = typeof row.id === 'string' ? row.id.trim() : ''
  if (!venue || !id) return null
  const candidate = candidates.find((c) => c.venue === venue && c.id === id)
  if (!candidate) return null
  const relevance = typeof row.relevance === 'number' ? row.relevance : Number(row.relevance)
  if (!Number.isFinite(relevance)) return null
  const outcome = typeof row.outcome === 'string' && row.outcome.trim() ? row.outcome.trim() : candidate.outcome
  return {
    venue,
    id,
    outcome,
    relevance: Math.max(0, Math.min(1, relevance)),
    sameEvent: row.same_event === true || row.sameEvent === true,
  }
}

export function marketSide(impliedYes: number): { verdict: 'up' | 'down'; probability: number } {
  const yes = Math.min(1, Math.max(0, impliedYes))
  if (yes >= 0.5) return { verdict: 'up', probability: Math.round(yes * 100) }
  return { verdict: 'down', probability: Math.round((1 - yes) * 100) }
}

export function marketRationale(match: AcceptedMarketMatch): string {
  if (match.brand) {
    const pct = Math.round(match.impliedYes * 100)
    return `예측시장 내재 확률은 ${match.brand}를 이 기간 1위로 ${pct}% 반영하고 있다.`.slice(0, 400)
  }
  const side = marketSide(match.impliedYes)
  const lean = side.verdict === 'up' ? '긍정' : '부정'
  return `예측시장 내재 확률은 이 명제의 ${lean} 쪽에 ${side.probability}%를 반영하고 있다.`.slice(0, 400)
}

export function recordForMatch(match: AcceptedMarketMatch): ConsensusMarketRecord {
  return {
    consensus_source: match.venue,
    consensus_market_id: match.id,
    consensus_market_outcome: match.outcome,
    consensus_implied_probability: Math.round(match.impliedYes * 10000) / 10000,
    consensus_relevance: Math.round(match.relevance * 1000) / 1000,
  }
}

export function recordForSearch(): ConsensusMarketRecord {
  return {
    consensus_source: 'search',
    consensus_market_id: null,
    consensus_market_outcome: null,
    consensus_implied_probability: null,
    consensus_relevance: null,
  }
}

export function recordForNone(): ConsensusMarketRecord {
  return {
    consensus_source: 'none',
    consensus_market_id: null,
    consensus_market_outcome: null,
    consensus_implied_probability: null,
    consensus_relevance: null,
  }
}

/** What the consensus seat does after the market pass. */
export function planConsensusAfterMarkets(args: {
  match: AcceptedMarketMatch | null
  search: 'verdict' | 'abstain' | 'none'
}): 'market' | 'search' | 'abstain' {
  if (args.match) return 'market'
  if (args.search === 'verdict') return 'search'
  return 'abstain'
}

export async function assembleConsensusMarket(args: {
  proposition: string
  deadline: string | null
  brandTable: boolean
  brandCandidates: readonly string[]
  search: (query: string) => Promise<OpenMarketCandidate[]>
  pick: (candidates: OpenMarketCandidate[]) => Promise<LlmMarketPick | null>
}): Promise<AcceptedMarketMatch | null> {
  const query = marketSearchQuery({
    proposition: args.proposition,
    deadline: args.deadline,
    brandTable: args.brandTable,
  })
  const candidates = await args.search(query)
  if (candidates.length === 0) return null
  const pick = await args.pick(candidates)
  if (!pick) return null
  const candidate = candidates.find((c) => c.venue === pick.venue && c.id === pick.id)
  if (!candidate) return null
  return finalizeMarketPick({
    pick,
    candidate,
    deadline: args.deadline,
    brandTable: args.brandTable,
    brandCandidates: args.brandCandidates,
  })
}

function utcMonthName(iso: string | null): string | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return null
  return new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(new Date(ms))
}
