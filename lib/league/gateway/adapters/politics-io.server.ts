import 'server-only'

import { getResearchPacket } from '../../research'
import {
  fetchKalshiElectionSlate,
  fetchPolymarketPolitics,
  mergeElectionSlate,
  type ElectionCandidateLite,
} from '../../politics/markets'
import { readPoliticsSlateCache, writePoliticsSlateCache } from '../../politics/slate-cache'
import { candidateMatches } from './politics-catalog'
import type { PoliticsInstrumentParts } from './politics-catalog'
import type { PoliticsPacketIo, PoliticsPollSnippet } from './politics-packet'

async function loadSlate(now: Date): Promise<ElectionCandidateLite[]> {
  const hit = readPoliticsSlateCache(now.getTime())
  if (hit) return hit
  const [kalshi, poly] = await Promise.all([
    fetchKalshiElectionSlate(now).catch(() => [] as ElectionCandidateLite[]),
    fetchPolymarketPolitics(now).catch(() => [] as ElectionCandidateLite[]),
  ])
  const rows = mergeElectionSlate([...kalshi, ...poly])
  writePoliticsSlateCache(rows, now.getTime())
  return rows
}

function baselineFor(parts: PoliticsInstrumentParts, slate: ElectionCandidateLite[]) {
  const row = slate.find(
    (item) =>
      item.jurisdiction === parts.jurisdiction &&
      item.office === parts.office &&
      item.district === parts.district &&
      candidateMatches(item, parts.candidate),
  )
  if (!row) return null
  return { kalshiPct: row.kalshiPct, polymarketPct: row.polymarketPct }
}

async function readPolls(parts: PoliticsInstrumentParts): Promise<PoliticsPollSnippet[]> {
  if (parts.jurisdiction !== 'US') return []
  const snippets: PoliticsPollSnippet[] = []
  try {
    const res = await fetch('https://api.votehub.com/polls?limit=3', {
      headers: { Accept: 'application/json', 'User-Agent': 'cas-platform/politics' },
    })
    if (res.ok) {
      const body = (await res.json()) as { polls?: Array<{ pollster?: string; poll_type?: string }> }
      const first = body.polls?.[0]
      if (first) {
        snippets.push({
          source: 'VoteHub',
          summary: `${first.pollster ?? 'poll'} · ${first.poll_type ?? 'us'} (supplement, not 지지율 framing)`,
        })
      }
    }
  } catch {
    /* polls are optional */
  }
  return snippets
}

export const LIVE_POLITICS_IO: PoliticsPacketIo = {
  listUpcoming: (now = new Date()) => loadSlate(now),
  readBaseline: async (parts) => baselineFor(parts, await loadSlate(new Date())),
  readPolls,
  getResearchPacket: ({ round, budgetRemainingUsd, tier, forcedQueries }) =>
    getResearchPacket({ round, budgetRemainingUsd, tier, forcedQueries }),
}
