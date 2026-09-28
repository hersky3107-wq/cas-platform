/**
 * Politics closed-book packet.
 * Hard telemetry = prediction-market implied % + polls.
 * Narrative = news / media / sentiment (Perplexity).
 * Base rate = incumbency / historical.
 * KR races never print 지지율 figures. During that race's D-6 window, poll
 * citations are stripped from news while factual events stay.
 */

import type { CategoryPacket, PacketBuildContext, PacketRound } from '../types'
import { raceBlackoutActive } from '../../politics/kr-calendar'
import { subjectImpliedPct, type ElectionCandidateLite } from '../../politics/markets'
import { redactPollFigures } from '../../politics/poll-redact'
import {
  decodePoliticsInstrument,
  raceTitle,
  type PoliticsInstrumentParts,
} from './politics-catalog'

export const POLITICS_SEARCH_QUERY_MAX = 6

export type PoliticsResearchFinding = {
  query: string
  summary: string
  citations?: string[]
}

export type PoliticsResearchPacket = {
  available: boolean
  cached: boolean
  cacheKey: string
  queries: string[]
  findings: PoliticsResearchFinding[]
  costUsd: number
  tier: string
  error?: string
}

export type PoliticsPollSnippet = { source: string; summary: string }

export type PoliticsPacketIo = {
  listUpcoming(now?: Date): Promise<ElectionCandidateLite[]>
  readBaseline(parts: PoliticsInstrumentParts): Promise<Pick<ElectionCandidateLite, 'kalshiPct' | 'polymarketPct'> | null>
  readPolls(parts: PoliticsInstrumentParts): Promise<PoliticsPollSnippet[]>
  getResearchPacket(args: {
    round: PacketRound
    budgetRemainingUsd: number
    tier: 'high'
    forcedQueries: Array<{ q: string; lang: string }>
  }): Promise<PoliticsResearchPacket>
}

export function politicsSearchQueries(
  parts: PoliticsInstrumentParts,
  krBlackout: boolean,
): Array<{ q: string; lang: string }> {
  const race = raceTitle(parts)
  const day = new Date(parts.pollCloseMs).toISOString().slice(0, 10)
  const queries: Array<{ q: string; lang: string }> = [
    {
      q: `${parts.candidate} ${race} scandal withdrawal endorsement replacement ballot news ${day}`,
      lang: 'en',
    },
    {
      q: `${parts.candidate} debate performance media narrative momentum favorable coverage ${day}`,
      lang: 'en',
    },
    {
      q: `${race} turnout undecided voters enthusiasm ${day}`,
      lang: 'en',
    },
    krBlackout
      ? {
          q: `${parts.candidate} ${race} factual campaign events only. Do not quote poll percentages or 지지율.`,
          lang: 'en',
        }
      : {
          q: `${parts.candidate} ${race} latest polls context ${day}`,
          lang: 'en',
        },
    {
      q: `${parts.candidate} ${race} 스캔들 사퇴 지지 선언 토론 반응 모멘텀 ${day}`,
      lang: 'ko',
    },
    {
      q: `${race} incumbency historical baseline previous election ${parts.cycle}`,
      lang: 'en',
    },
  ]
  return queries.slice(0, POLITICS_SEARCH_QUERY_MAX)
}

export function formatPoliticsCrowBrief(
  parts: PoliticsInstrumentParts,
  baseline: Pick<ElectionCandidateLite, 'kalshiPct' | 'polymarketPct'> | null,
): string {
  const implied = subjectImpliedPct({
    kalshiPct: baseline?.kalshiPct ?? null,
    polymarketPct: baseline?.polymarketPct ?? null,
  })
  return [
    `Subject: ${parts.candidate}`,
    `Race: ${raceTitle(parts)}`,
    `Poll close: ${new Date(parts.pollCloseMs).toISOString()}`,
    'MARKET BASELINE (prediction-market implied probability — informational)',
    baseline?.polymarketPct != null ? `Polymarket (해외 예측시장 데이터): ${baseline.polymarketPct.toFixed(1)}%` : 'Polymarket: UNAVAILABLE',
    baseline?.kalshiPct != null ? `Kalshi: ${baseline.kalshiPct.toFixed(1)}%` : 'Kalshi: UNAVAILABLE',
    `Subject implied: ${implied == null ? 'UNAVAILABLE' : `${implied.toFixed(1)}%`}`,
    'Do not invent scandals, poll numbers, or odds that are not in this brief.',
  ].join('\n')
}

function formatBaseline(baseline: Pick<ElectionCandidateLite, 'kalshiPct' | 'polymarketPct'> | null, candidate: string): string[] {
  const lines = [
    'MARKET BASELINE (prediction-market implied probability — a price, not a required vote, not a wager)',
    'Polymarket is 해외 예측시장 데이터. Kalshi is a US-regulated prediction market.',
  ]
  if (!baseline || (baseline.kalshiPct == null && baseline.polymarketPct == null)) {
    lines.push('UNAVAILABLE')
    return lines
  }
  if (baseline.polymarketPct != null) lines.push(`Polymarket (해외 예측시장 데이터): ${baseline.polymarketPct.toFixed(1)}%`)
  if (baseline.kalshiPct != null) lines.push(`Kalshi: ${baseline.kalshiPct.toFixed(1)}%`)
  const implied = subjectImpliedPct(baseline)
  lines.push(`Subject implied (yes = ${candidate} wins): ${implied == null ? 'UNAVAILABLE' : `${implied.toFixed(1)}%`}`)
  return lines
}

function formatPolls(polls: PoliticsPollSnippet[], hide: boolean): string[] {
  if (hide) {
    return [
      'POLLS',
      'OMITTED for this Korean race. Do not cite 지지율 or survey percentages. Use 예측시장 내재 확률 and factual events.',
    ]
  }
  const lines = ['POLLS (supplement — not the market baseline)']
  if (!polls.length) {
    lines.push('UNAVAILABLE')
    return lines
  }
  for (const poll of polls.slice(0, 4)) {
    lines.push(`${poll.source}: ${poll.summary.slice(0, 280)}`)
  }
  return lines
}

function formatFindings(research: PoliticsResearchPacket, redact: boolean): string[] {
  const lines = ['NEWS / MEDIA / PUBLIC SENTIMENT (search — scandals, debates, momentum, turnout)']
  if (!research.available) {
    lines.push(`Research: UNAVAILABLE${research.error ? ` (${research.error})` : ''}`)
    return lines
  }
  if (!research.findings.length) {
    lines.push('Usable findings: 0')
    return lines
  }
  for (const f of research.findings) {
    const summary = redact ? redactPollFigures(f.summary) : f.summary
    lines.push(`[news] ${f.query}`)
    lines.push(`  ${summary.slice(0, 400)}`)
  }
  return lines
}

export function assemblePoliticsInjection(args: {
  round: PacketRound
  parts: PoliticsInstrumentParts
  baseline: Pick<ElectionCandidateLite, 'kalshiPct' | 'polymarketPct'> | null
  polls: PoliticsPollSnippet[]
  research: PoliticsResearchPacket
  nowMs: number
}): string {
  const { parts } = args
  const kr = parts.jurisdiction === 'KR'
  const blackout = kr && raceBlackoutActive(new Date(parts.pollCloseMs).toISOString(), args.nowMs)
  const hidePolls = kr
  const lines = [
    'POLITICS PACKET — closed book. Informational analysis of 당선 가능성. Not a poll publication and not a bet.',
    `Proposition: ${args.round.proposition_text}`,
    `Subject: ${parts.candidate}`,
    `Race: ${raceTitle(parts)}`,
    `Poll close: ${new Date(parts.pollCloseMs).toISOString()}`,
    'Frame the call as AI 앙상블 당선 가능성 and 예측시장 내재 확률. Never as 지지율.',
  ]
  if (blackout) {
    lines.push(
      'KOREA BLACKOUT: factual news (scandals, withdrawals, events) is allowed. Poll percentages and 지지율 citations are forbidden.',
    )
  }
  lines.push(
    '',
    ...formatBaseline(args.baseline, parts.candidate),
    '',
    ...formatPolls(args.polls, hidePolls),
    '',
    'BASE RATE',
    'Incumbency and the previous comparable election are context only. Do not invent a historical win rate.',
    '',
    ...formatFindings(args.research, kr),
  )
  return lines.join('\n')
}

export async function buildPoliticsPacket(
  ctx: PacketBuildContext,
  io: PoliticsPacketIo,
  now: Date = new Date(),
): Promise<CategoryPacket> {
  const parts = decodePoliticsInstrument(ctx.round.instrument)
  const kr = parts?.jurisdiction === 'KR'
  const blackout = Boolean(parts && kr && raceBlackoutActive(new Date(parts.pollCloseMs).toISOString(), now.getTime()))
  const queries = parts ? politicsSearchQueries(parts, blackout) : []
  const [baseline, polls, research] = await Promise.all([
    parts ? io.readBaseline(parts).catch(() => null) : Promise.resolve(null),
    parts && !kr ? io.readPolls(parts).catch(() => []) : Promise.resolve([]),
    io.getResearchPacket({
      round: ctx.round,
      budgetRemainingUsd: ctx.costCapUsd,
      tier: 'high',
      forcedQueries: queries,
    }),
  ])
  const injection = parts
    ? assemblePoliticsInjection({ round: ctx.round, parts, baseline, polls, research, nowMs: now.getTime() })
    : `POLITICS PACKET — UNAVAILABLE (instrument ${ctx.round.instrument})`
  return {
    injection,
    researchCacheKey: research.cacheKey,
    researchCostUsd: research.costUsd,
    dataPacket: {
      available: Boolean(baseline && (baseline.kalshiPct != null || baseline.polymarketPct != null)),
      symbol: ctx.round.instrument,
      error: baseline && (baseline.kalshiPct != null || baseline.polymarketPct != null) ? undefined : 'no market baseline',
    },
    research: {
      available: research.available,
      cached: research.cached,
      costUsd: Number(research.costUsd.toFixed(6)),
      queries: research.queries,
      tier: research.tier,
      tierSignal: `politics: news/sentiment ${queries.length} queries; market baseline separate`,
      error: research.error,
    },
    relatedCreditsSpent: 0,
  }
}
