import 'server-only'

import { getResearchPacket } from '../../research'
import { brandRankingFromStore, listLeaderboardPublishDates, LMARENA_SOURCE } from '../../ai-ranking/ingest'
import type { AirankAdapterIo } from './ai-models-packet'

export const LIVE_AIRANK_IO: AirankAdapterIo = {
  listPublishDates: (arena, category) => listLeaderboardPublishDates(arena, category),
  loadBrandRanking: (arena, category, date) => brandRankingFromStore(LMARENA_SOURCE, arena, category, date),
  getResearchPacket: ({ round, budgetRemainingUsd, forcedQueries }) =>
    getResearchPacket({
      round,
      budgetRemainingUsd,
      tier: 'normal',
      forcedQueries,
      querySetVersion: 'airank-news-v1',
    }),
}
