/**
 * Extra league tier — special-character seats BELOW scout, separate from
 * the official 40-model roster. Extra seats are graded (오라클 승률) but
 * isolated from the 40-AI consensus / hero / camp-tier / book / weights math.
 *
 * CONSENSUS-ISOLATION BOUNDARY:
 *   Extra model_ids never enter `buildConsensus`, campSplit, bookSplit,
 *   weightsSplit, card hitRate, verdict payload, persisted round consensus,
 *   or the combined-method track. They may appear on the unified model
 *   leaderboard and in `tierSplit.extra` / `models[]` as their own strip.
 */

export const EXTRA_TIER = 'extra' as const
export type ExtraTier = typeof EXTRA_TIER

export const EXTRA_SEAT_IDS = ['divination', 'sentiment', 'history', 'consensus'] as const
export type ExtraSeatId = (typeof EXTRA_SEAT_IDS)[number]

export type ExtraSeatKind = ExtraSeatId

export type ExtraSeat = {
  model_id: ExtraSeatId
  /** Stored brand line — badge + Korean product name. Existing tiles render this as-is. */
  brand: string
  product_alias: string
  badge: '🔮' | '📰' | '📜' | '💰'
  kind: ExtraSeatKind
  league_tier: ExtraTier
  camp: 'other'
  weights: 'closed'
  /** Customer-facing voting-system count. 점성술/구성기학 are chart-only. */
  votingSystems?: 4
}

/**
 * Four extra seats. Official LEAGUE_ROSTER stays 40 — these are not on it.
 * Divination is wired; the other three persist stub rows until their engines land.
 */
export const LEAGUE_EXTRA_ROSTER: readonly ExtraSeat[] = [
  {
    model_id: 'divination',
    brand: '🔮 점술',
    product_alias: '엑스트라',
    badge: '🔮',
    kind: 'divination',
    league_tier: EXTRA_TIER,
    camp: 'other',
    weights: 'closed',
    votingSystems: 4,
  },
  {
    model_id: 'sentiment',
    brand: '📰 심리·내러티브',
    product_alias: '엑스트라',
    badge: '📰',
    kind: 'sentiment',
    league_tier: EXTRA_TIER,
    camp: 'other',
    weights: 'closed',
  },
  {
    model_id: 'history',
    brand: '📜 역사·패턴',
    product_alias: '엑스트라',
    badge: '📜',
    kind: 'history',
    league_tier: EXTRA_TIER,
    camp: 'other',
    weights: 'closed',
  },
  {
    model_id: 'consensus',
    brand: '💰 돈이 매긴 확률',
    product_alias: '엑스트라',
    badge: '💰',
    kind: 'consensus',
    league_tier: EXTRA_TIER,
    camp: 'other',
    weights: 'closed',
  },
] as const

const EXTRA_BY_ID = new Map(LEAGUE_EXTRA_ROSTER.map((seat) => [seat.model_id, seat]))

export function isExtraSeatId(modelId: string): modelId is ExtraSeatId {
  return EXTRA_BY_ID.has(modelId as ExtraSeatId)
}

export function isExtraTier(tier: string | null | undefined): tier is ExtraTier {
  return tier === EXTRA_TIER
}

/** True when this prediction must stay out of the 40-AI consensus math. */
export function isExtraSeat(row: { model_id?: string | null; league_tier?: string | null }): boolean {
  return isExtraSeatId(row.model_id ?? '') || isExtraTier(row.league_tier)
}

export function lookupExtraSeat(modelId: string): ExtraSeat | undefined {
  return EXTRA_BY_ID.get(modelId as ExtraSeatId)
}

export function extraSeatBadge(modelId: string): ExtraSeat['badge'] | null {
  return lookupExtraSeat(modelId)?.badge ?? null
}

export function getExtraRoster(): ExtraSeat[] {
  return [...LEAGUE_EXTRA_ROSTER]
}

export function getExtraSeatIds(): ExtraSeatId[] {
  return [...EXTRA_SEAT_IDS]
}

/** Progress / streaming denominator: official 40 + 4 extra (44). */
export function extraSeatIds(): readonly string[] {
  return EXTRA_SEAT_IDS
}

/** Official 40-AI math only — extra seats never enter this set. */
export function officialRowsForConsensus<T extends { model_id?: string | null; league_tier?: string | null }>(
  rows: readonly T[],
): T[] {
  return rows.filter((row) => !isExtraSeat(row))
}
