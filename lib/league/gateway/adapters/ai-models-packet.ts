import type { CategoryPacket, PacketBuildContext, PacketRound } from '../types'
import {
  airankNewsQueries,
  assembleAirankInjection,
  loadAirankPacketData,
  type AirankNewsFinding,
  type AirankPacketIo,
} from '../../ai-ranking/packet'
import {
  decodeAirankInstrument,
  isAirankHorizon,
  type AirankHorizon,
} from '../../ai-ranking/instrument'
import type { SnapshotBrandRow } from '../../ai-ranking/grade'

export type AirankResearchPacket = {
  available: boolean
  cached: boolean
  cacheKey: string
  queries: string[]
  findings: AirankNewsFinding[]
  costUsd: number
  tier: string
  error?: string
}

export type AirankAdapterIo = {
  listPublishDates(arena: string, category: string): Promise<string[]>
  loadBrandRanking(arena: string, category: string, date: string): Promise<SnapshotBrandRow[]>
  getResearchPacket(args: {
    round: PacketRound
    budgetRemainingUsd: number
    forcedQueries: readonly { q: string; lang: string }[]
  }): Promise<AirankResearchPacket>
}

function asOfFromRound(_round: PacketRound): string {
  return new Date().toISOString().slice(0, 10)
}

export async function buildAirankPacket(ctx: PacketBuildContext, io: AirankAdapterIo): Promise<CategoryPacket> {
  const parts = decodeAirankInstrument(ctx.round.instrument)
  const horizon: AirankHorizon = isAirankHorizon(ctx.round.horizon) ? ctx.round.horizon : '1m'
  if (!parts) {
    return {
      injection: null,
      researchCacheKey: `airank|invalid|${ctx.round.instrument}`,
      researchCostUsd: 0,
      dataPacket: { available: false, error: 'AIRANK instrument not decodable' },
      research: {
        available: false,
        cached: false,
        costUsd: 0,
        queries: [],
        tier: 'none',
        tierSignal: 'airank: invalid instrument',
        error: 'invalid AIRANK instrument',
      },
      relatedCreditsSpent: 0,
    }
  }

  const asOfYmd = asOfFromRound(ctx.round)
  const packetIo: AirankPacketIo = {
    listPublishDates: io.listPublishDates,
    loadBrandRanking: io.loadBrandRanking,
  }
  const ranking = await loadAirankPacketData(packetIo, parts, horizon, asOfYmd)

  const forced = airankNewsQueries(parts)
  const research = await io.getResearchPacket({
    round: ctx.round,
    budgetRemainingUsd: ctx.costCapUsd,
    forcedQueries: forced,
  })
  const news: AirankNewsFinding[] = research.available
    ? research.findings.map((f) => ({ query: f.query, summary: f.summary }))
    : []

  const injection = assembleAirankInjection({ ...ranking, news, locale: 'ko' })
  return {
    injection,
    researchCacheKey: research.cacheKey || `airank|${ctx.round.instrument}|${asOfYmd}`,
    researchCostUsd: research.costUsd,
    dataPacket: { available: ranking.rankingsByDate.length > 0 },
    research: {
      available: research.available,
      cached: research.cached,
      costUsd: Number(research.costUsd.toFixed(6)),
      queries: research.queries,
      tier: research.tier,
      tierSignal: 'airank: ranking packet + 1–2 labeled news queries',
      error: research.error,
    },
    relatedCreditsSpent: 0,
  }
}
