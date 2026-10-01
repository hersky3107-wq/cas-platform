/**
 * Housing-index packet. Money signal is 실거래 거래량 + 실거래가 trend
 * (not a futures book). Rates / supply / policy stay in the research block.
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
  const ko = parts.region.nameKo
  const tx =
    parts.country === 'KR'
      ? [
          { q: `${ko} 실거래가 거래량 국토교통부 중위 ${parts.refMonth}`, lang: 'ko' },
          { q: `${ko} apartment transaction volume median price MOLIT ${parts.refMonth}`, lang: 'en' },
        ]
      : parts.country === 'US'
        ? [
            { q: `${name} existing home sales volume median price NAR ${parts.refMonth}`, lang: 'en' },
            { q: `${ko} 기존주택 거래량 실거래 중위가 ${parts.refMonth}`, lang: 'ko' },
          ]
        : [
            { q: `${name} housing transaction volume sales count median price ${parts.refMonth}`, lang: 'en' },
            { q: `${ko} 주택 거래량 실거래가 추이 ${parts.refMonth}`, lang: 'ko' },
          ]
  return [
    ...tx,
    { q: `${name} housing policy mortgage rate supply permits ${parts.refMonth}`, lang: 'en' },
    { q: `${ko} 주택 금리 입주 인허가 규제 ${parts.refMonth}`, lang: 'ko' },
    { q: `30 year mortgage rate housing supply ${name}`, lang: 'en' },
    { q: `${name} housing correction risk falling transactions supply overhang affordability ${parts.refMonth}`, lang: 'en' },
  ]
}

export function formatPropertyCrowBrief(parts: PropertyParts): string {
  return [
    `Region: ${parts.region.nameEn} (${parts.region.country} ${parts.region.code})`,
    `Index: ${parts.region.seriesEn}`,
    `Reference period: ${parts.refMonth}`,
    `Publication: ${new Date(parts.resolvesAtMs).toISOString().slice(0, 10)}`,
    'MONEY / ACTIVITY: 실거래 거래량 and 실거래가 (transacted-price) trend for this region. Not REIT ETFs. Not thin housing futures.',
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
        'TRANSACTION VOLUME / 실거래가',
        'Use published 거래량 and transacted-price trend as the market-activity input.',
        'POLICY / RATES / SUPPLY',
        findings,
        'BOTH SIDES — real factors only. Do not invent balance.',
        'Weigh upside drivers (rate cuts, tight supply, rising 거래량) against downside drivers (rate pressure, 입주 supply overhang, falling 거래량, tightening policy, stretched affordability) — only those the findings state. A one-way index trend with no stated counter-factor can still be the call.',
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
      error: 'no housing-index futures book; use 거래량/실거래가 research',
    },
    research: {
      available: research.available,
      cached: research.cached,
      costUsd: Number(research.costUsd.toFixed(6)),
      queries: research.queries,
      tier: research.tier,
      tierSignal: `real_estate: 거래량/실거래가 + rates/supply/policy ${queries.length} queries`,
      error: research.error,
    },
    relatedCreditsSpent: 0,
  }
}
