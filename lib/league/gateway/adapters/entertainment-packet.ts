/**
 * Entertainment closed-book packet.
 * Money line is a prediction-market percent or a studio-tracking note.
 * Missing both stays UNAVAILABLE — never a made-up gross.
 */

import type { CategoryPacket, PacketBuildContext, PacketRound } from '../types'
import type { ResearchPacket } from '../../research'
import type { ShowMetric } from '../../entertainment/slate'
import {
  decodeEntertainmentInstrument,
  formatShowProposition,
  showEventLabel,
  type ShowParts,
} from './entertainment-catalog'

export type EntertainmentBaseline = {
  marketPct: number | null
  trackingNote: string | null
}

export type EntertainmentPacketIo = {
  listUpcoming(now?: Date): Promise<ShowMetric[]>
  readBaseline(parts: ShowParts): Promise<EntertainmentBaseline | null>
  getResearchPacket(args: {
    round: PacketRound
    budgetRemainingUsd: number
    tier: 'high'
    forcedQueries: Array<{ q: string; lang: string }>
  }): Promise<ResearchPacket>
}

export function entertainmentSearchQueries(parts: ShowParts): Array<{ q: string; lang: string }> {
  const event = showEventLabel(parts, 'en')
  const day = new Date(parts.resolvesAtMs).toISOString().slice(0, 10)
  return [
    { q: `${parts.subject} ${event} buzz reviews festival trailer ${day}`, lang: 'en' },
    { q: `${parts.subject} comparable opening director franchise genre`, lang: 'en' },
    { q: `${parts.subject} ${event} 예매 반응 흥행 전망 ${day}`, lang: 'ko' },
    { q: `${parts.subject} ${event} competition counter-programming weak tracking flop or upset risk ${day}`, lang: 'en' },
  ]
}

export function formatEntertainmentCrowBrief(parts: ShowParts, baseline: EntertainmentBaseline | null): string {
  const market = baseline?.marketPct
  return [
    `Subject: ${parts.subject}`,
    `Metric: ${showEventLabel(parts, 'en')}`,
    `Resolves: ${new Date(parts.resolvesAtMs).toISOString()}`,
    'MARKET BASELINE',
    market != null ? `Prediction-market implied: ${market.toFixed(1)}%` : 'Prediction-market: UNAVAILABLE',
    baseline?.trackingNote ? `Studio tracking: ${baseline.trackingNote}` : 'Studio tracking: UNAVAILABLE',
    'Flop / upset / counter-programming only if this brief states a reason. Do not invent grosses or odds.',
  ].join('\n')
}

function assembleInjection(parts: ShowParts, baseline: EntertainmentBaseline | null, research: ResearchPacket): string {
  const findings = research.findings.map((f) => `- ${f.summary}`).join('\n') || '- none'
  return [
    `PROPOSITION: ${formatShowProposition(parts)}`,
    formatEntertainmentCrowBrief(parts, baseline),
    '',
    'BOTH SIDES — real factors only. Do not invent balance.',
    baseline?.marketPct != null
      ? `Priced: yes ${baseline.marketPct.toFixed(1)}% · no ${(100 - baseline.marketPct).toFixed(1)}% — the smaller side still happens about that often.`
      : 'Priced yes / no: UNAVAILABLE. Do not invent odds.',
    'Weigh buzz, reviews, and comps against competition, counter-programming, and weak tracking — only those the BUZZ section states. A clear favorite with no stated risk can still be the call.',
    '',
    'COMPS',
    'Same director, franchise, or genre opening is context only. Do not invent a historical hit rate.',
    '',
    'BUZZ',
    findings,
  ].join('\n')
}

export async function buildEntertainmentPacket(ctx: PacketBuildContext, io: EntertainmentPacketIo): Promise<CategoryPacket> {
  const parts = decodeEntertainmentInstrument(ctx.round.instrument)
  const queries = parts ? entertainmentSearchQueries(parts) : []
  const [baseline, research] = await Promise.all([
    parts ? io.readBaseline(parts).catch(() => null) : Promise.resolve(null),
    io.getResearchPacket({
      round: ctx.round,
      budgetRemainingUsd: ctx.costCapUsd,
      tier: 'high',
      forcedQueries: queries,
    }),
  ])
  const hasMoney = Boolean(baseline && (baseline.marketPct != null || baseline.trackingNote))
  const injection = parts
    ? assembleInjection(parts, baseline, research)
    : `ENTERTAINMENT PACKET — UNAVAILABLE (instrument ${ctx.round.instrument})`
  return {
    injection,
    researchCacheKey: research.cacheKey,
    researchCostUsd: research.costUsd,
    dataPacket: {
      available: hasMoney,
      symbol: ctx.round.instrument,
      error: hasMoney ? undefined : 'no market baseline',
    },
    research: {
      available: research.available,
      cached: research.cached,
      costUsd: Number(research.costUsd.toFixed(6)),
      queries: research.queries,
      tier: research.tier,
      tierSignal: `entertainment: buzz/comps ${queries.length} queries; money baseline separate`,
      error: research.error,
    },
    relatedCreditsSpent: 0,
  }
}
