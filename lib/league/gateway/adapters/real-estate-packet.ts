/**
 * Housing-index packet. Consensus has no usable market (CME housing futures
 * are too thin, and most regions have none) — the money line stays unavailable.
 */

import type { CategoryPacket, PacketBuildContext, PacketRound } from '../types'
import type { ResearchPacket } from '../../research'
import { decodePropertyInstrument, formatPropertyProposition, type PropertyParts } from './real-estate-catalog'

export type RealEstatePacketIo = {
  getResearchPacket(args: {
    round: PacketRound
    budgetRemainingUsd: number
    tier: 'high'
    forcedQueries: Array<{ q: string; lang: string }>
  }): Promise<ResearchPacket>
}

export function propertySearchQueries(parts: PropertyParts): Array<{ q: string; lang: string }> {
  const name = parts.region.nameEn
  return [
    { q: `${name} housing policy mortgage rate supply permits ${parts.refMonth}`, lang: 'en' },
    { q: `${parts.region.nameKo} 주택 금리 입주 인허가 규제 ${parts.refMonth}`, lang: 'ko' },
    { q: `30 year mortgage rate housing supply ${name}`, lang: 'en' },
  ]
}

export function formatPropertyCrowBrief(parts: PropertyParts): string {
  return [
    `Region: ${parts.region.nameEn} (${parts.region.country} ${parts.region.code})`,
    `Index: ${parts.region.seriesEn}`,
    `Reference period: ${parts.refMonth}`,
    `Publication: ${new Date(parts.resolvesAtMs).toISOString().slice(0, 10)}`,
    'MONEY BASELINE: UNAVAILABLE. CME Case-Shiller futures are too thin to be a probability, and this region has no housing-index market.',
    'Crow lens: regional overheating or correction risk on this official index. Do not name a complex, address, or unit.',
  ].join('\n')
}

export async function buildRealEstatePacket(ctx: PacketBuildContext, io: RealEstatePacketIo): Promise<CategoryPacket> {
  const parts = decodePropertyInstrument(ctx.round.instrument)
  const queries = parts ? propertySearchQueries(parts) : []
  const research = await io.getResearchPacket({
    round: ctx.round,
    budgetRemainingUsd: ctx.costCapUsd,
    tier: 'high',
    forcedQueries: queries,
  })
  const findings = research.findings.map((f) => `- ${f.summary}`).join('\n') || '- none'
  const injection = parts
    ? [
        `PROPOSITION: ${formatPropertyProposition(parts)}`,
        formatPropertyCrowBrief(parts),
        '',
        'POLICY / RATES / SUPPLY',
        findings,
        'Do not cite a named apartment complex or a street address.',
      ].join('\n')
    : `REAL ESTATE PACKET — UNAVAILABLE (instrument ${ctx.round.instrument})`
  return {
    injection,
    researchCacheKey: research.cacheKey,
    researchCostUsd: research.costUsd,
    dataPacket: {
      available: false,
      symbol: ctx.round.instrument,
      error: 'no housing-index futures baseline',
    },
    research: {
      available: research.available,
      cached: research.cached,
      costUsd: Number(research.costUsd.toFixed(6)),
      queries: research.queries,
      tier: research.tier,
      tierSignal: `real_estate: rates/supply/policy ${queries.length} queries; consensus abstains`,
      error: research.error,
    },
    relatedCreditsSpent: 0,
  }
}
