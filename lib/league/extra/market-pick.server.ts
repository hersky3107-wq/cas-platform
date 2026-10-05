/**
 * Live consensus market match. Cheap normalizer model picks one open market.
 * Only the consensus extra seat calls this. Official packets stay odds-free.
 */
import 'server-only'

import { runSingleAiProvider } from '@/lib/ai/router'
import { supabaseAdmin } from '@/lib/supabase/server'
import { extractBrandTableCandidates, isBrandTableInstrument } from '../ai-ranking/brand-table'
import { NORMALIZER_MODEL } from '../gateway/normalize-prompt'
import {
  assembleConsensusMarket,
  consensusMarketEligible,
  parseMarketPickJson,
  type AcceptedMarketMatch,
  type LlmMarketPick,
  type OpenMarketCandidate,
} from './market-match'
import { searchConsensusMarkets } from './market-search'

export type ConsensusMarketRound = {
  proposition_text: string
  category: string
  instrument: string
  resolves_at?: string | null
  closed_book_packet_text?: string | null
}

export async function matchConsensusMarket(round: ConsensusMarketRound): Promise<AcceptedMarketMatch | null> {
  if (!consensusMarketEligible(round.category, round.instrument)) return null
  const brandTable = isBrandTableInstrument(round.instrument)
  const brandCandidates = brandTable ? extractBrandTableCandidates(round.closed_book_packet_text) : []
  return assembleConsensusMarket({
    proposition: round.proposition_text,
    deadline: round.resolves_at ?? null,
    brandTable,
    brandCandidates,
    search: (query) => searchConsensusMarkets(query),
    pick: (candidates) => pickMarket(round.proposition_text, round.resolves_at ?? null, candidates, brandTable),
  }).catch(() => null)
}

async function pickMarket(
  proposition: string,
  deadline: string | null,
  candidates: OpenMarketCandidate[],
  brandTable: boolean,
): Promise<LlmMarketPick | null> {
  const listed = candidates
    .map(
      (c, i) =>
        `${i + 1}. venue=${c.venue} id=${c.id} resolves=${c.resolvesAt ?? 'unknown'} outcome=${c.outcome} title=${c.title}`,
    )
    .join('\n')
  const res = await runSingleAiProvider({
    supabase: supabaseAdmin,
    authSupabase: supabaseAdmin,
    sessionId: null,
    userId: null,
    provider: 'google',
    modelOverride: NORMALIZER_MODEL,
    skipLanguageInjection: true,
    maxCompletionTokens: 220,
    allowGeminiThinking: true,
    geminiThinkingLevel: 'minimal',
    timeoutMs: 20_000,
    systemPrompt: [
      'Pick the single most relevant OPEN prediction market for the proposition.',
      'Return one JSON object and nothing else:',
      '{"venue":"kalshi"|"polymarket","id":"...","outcome":"...","relevance":0-1,"same_event":false}',
      'relevance is 0 when nothing fits. same_event is true only when the market settles the same underlying event as the proposition.',
      brandTable
        ? 'Prefer a market of the form "which company has the best AI model" at the end of the proposition month. outcome must be the company or brand name.'
        : 'outcome is the YES side the price refers to.',
    ].join('\n'),
    prompt: [`PROPOSITION: ${proposition}`, `DEADLINE: ${deadline ?? 'unknown'}`, 'MARKETS:', listed].join('\n'),
  })
  if (res.error || !res.text) return null
  return parseMarketPickJson(res.text, candidates)
}
