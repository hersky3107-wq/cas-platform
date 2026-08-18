import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import { fetchDataPacket, formatDataPacketForPrompt } from '@/lib/league/market-data'
import { getResearchPacket } from '@/lib/league/research'
import type { JejuSnapshot } from '@/lib/motie/brief'
import type { LeagueLocale } from '@/lib/league/i18n/locales'

/**
 * Server-side context for a league deep-analysis run. Built ONLY from the
 * round row + the existing research/price packets — never from client text.
 */

export type LeagueDeepContext = {
  roundId: string
  instrument: string
  category: string
  horizon: string
  proposition: string
  resolutionRule: string
  /** The engine "question" — the already-normalized proposition, plus a citation-voice frame. */
  question: string
  context: string
  availableDataSummary: string
  snapshot: JejuSnapshot
}

const LANGUAGE_NAME: Record<LeagueLocale, string> = {
  en: 'English',
  ko: 'Korean',
  ja: 'Japanese',
  'zh-TW': 'Traditional Chinese',
  fr: 'French',
  ar: 'Arabic',
  es: 'Spanish',
  pt: 'Portuguese',
}

export async function loadRoundRow(roundId: string): Promise<{
  id: string
  instrument: string
  category: string
  horizon: string
  proposition_text: string
  resolution_rule: string
  resolves_at: string
} | null> {
  const { data, error } = await supabaseAdmin
    .from('prediction_rounds')
    .select('id, instrument, category, horizon, proposition_text, resolution_rule, resolves_at')
    .eq('id', roundId)
    .maybeSingle()
  if (error || !data) return null
  return data as {
    id: string
    instrument: string
    category: string
    horizon: string
    proposition_text: string
    resolution_rule: string
    resolves_at: string
  }
}

export async function buildLeagueDeepContext(
  roundId: string,
  locale: LeagueLocale | null
): Promise<LeagueDeepContext | null> {
  const round = await loadRoundRow(roundId)
  if (!round) return null

  const [packet, research] = await Promise.all([
    fetchDataPacket(round.instrument),
    getResearchPacket({
      round: {
        instrument: round.instrument,
        category: round.category,
        proposition_text: round.proposition_text,
        horizon: round.horizon,
        resolution_rule: round.resolution_rule,
        resolves_at: round.resolves_at,
      },
      budgetRemainingUsd: 2,
    }),
  ])

  const language = locale ? LANGUAGE_NAME[locale] : 'English'
  const question = [
    `Write in ${language}.`,
    'This is UNSCORED COMMENTARY on an already-opened AI Prediction League proposition — not a new prediction, not a scored league call, and not investment advice.',
    'Grammatical subject = the analysis / the models. Never instruct the reader to buy, sell, or place a bet.',
    '',
    `Proposition: ${round.proposition_text}`,
  ].join('\n')

  const priceBlock = packet.available ? formatDataPacketForPrompt(packet) : `Price packet unavailable${packet.error ? `: ${packet.error}` : ''}.`
  const researchBlock = research.available && research.promptBlock ? research.promptBlock : 'Research packet unavailable for this round.'

  const context = [
    `Instrument: ${round.instrument}`,
    `Category: ${round.category}`,
    `Horizon: ${round.horizon}`,
    `Resolution rule: ${round.resolution_rule}`,
    `Resolves at (UTC): ${round.resolves_at}`,
    '',
    priceBlock,
    '',
    researchBlock,
  ].join('\n')

  const snapshot: JejuSnapshot = {
    ok: packet.available || research.available,
    sources: [
      { id: 'proposition', label: 'League proposition', ok: true, text: round.proposition_text },
      { id: 'price', label: 'Market packet', ok: !!packet.available, text: priceBlock },
      { id: 'research', label: 'Research packet', ok: research.available, text: researchBlock },
    ],
  }

  return {
    roundId: round.id,
    instrument: round.instrument,
    category: round.category,
    horizon: round.horizon,
    proposition: round.proposition_text,
    resolutionRule: round.resolution_rule,
    question,
    context,
    availableDataSummary: [
      `Instrument ${round.instrument} (${round.category}, ${round.horizon}).`,
      packet.available ? `Latest close available (${packet.symbol ?? round.instrument}).` : 'No live price packet.',
      research.available ? `Research packet: ${research.queries.length} queries.` : 'No research packet.',
    ].join(' '),
    snapshot,
  }
}

/** Deep analysis is only valid on a round that already has league cards. */
export async function roundHasCards(roundId: string): Promise<boolean> {
  const { count, error } = await supabaseAdmin
    .from('model_predictions')
    .select('id', { count: 'exact', head: true })
    .eq('round_id', roundId)
  if (error) return false
  return (count ?? 0) > 0
}
