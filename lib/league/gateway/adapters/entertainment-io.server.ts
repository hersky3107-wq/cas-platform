import 'server-only'

import { getResearchPacket } from '../../research'
import { ENTERTAINMENT_SLATE, withinShowHorizon, type ShowMetric } from '../../entertainment/slate'
import type { ShowParts } from './entertainment-catalog'
import type { EntertainmentPacketIo } from './entertainment-packet'

function inWindow(now: Date): ShowMetric[] {
  return ENTERTAINMENT_SLATE.filter((row) => withinShowHorizon(Date.parse(row.resolvesAtIso), now))
}

export const LIVE_ENTERTAINMENT_IO: EntertainmentPacketIo = {
  listUpcoming: async (now = new Date()) => inWindow(now),
  readBaseline: async (parts: ShowParts) => {
    const hit = ENTERTAINMENT_SLATE.find(
      (row) =>
        row.kind === parts.kind &&
        row.venue === parts.venue &&
        row.event === parts.event &&
        row.subject.toLowerCase() === parts.subject.toLowerCase(),
    )
    return { marketPct: hit?.marketPct ?? null, trackingNote: null }
  },
  getResearchPacket: ({ round, budgetRemainingUsd, tier, forcedQueries }) =>
    getResearchPacket({ round, budgetRemainingUsd, tier, forcedQueries }),
}
