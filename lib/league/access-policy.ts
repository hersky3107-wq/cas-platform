import type { PredictionCategory } from '@/lib/prediction/categories'
import type { LeagueTier } from '@/lib/league/roster'
import type { RateLimitRule } from '@/lib/rate-limit'
import { isCategoryAllowed, type JurisdictionInput } from './jurisdiction/resolve'

/**
 * AI Prediction League — PUBLIC ACCESS POLICY (pure).
 *
 * This is the "what may a logged-in non-admin user reach" layer, kept pure and
 * dependency-light on purpose:
 *  - no DB, no auth, no headers (see `public-access.ts` for the server wiring),
 *  - no `server-only` import, so every rule below is unit-testable.
 *
 * The three rules that actually protect the public path:
 *  1. VISIBILITY — a category the user's jurisdiction denies is not readable
 *     and not generatable. Enforced from the same pure `isCategoryAllowed`
 *     the UI uses, so API and UI can never disagree.
 *  2. CURATED-ONLY — public users reach the curated ranked instrument set and
 *     nothing else. On-demand / arbitrary-instrument requests stay admin-only
 *     (that product surface is a later piece; until then an open endpoint
 *     would be an arbitrary-prompt, arbitrary-cost hole).
 *  3. NO CALLER-SUPPLIED COST KNOBS — the roster subset, concurrency, timeout,
 *     token ceiling and USD cost cap are cost levers. A non-admin caller does
 *     not get to set them, no matter what they put in the body.
 */

/**
 * Every category the ledger knows about. Written as a `Record<PredictionCategory, true>`
 * rather than an array so TypeScript fails the build if a category is added to
 * the union without being classified here (an array would silently stay stale,
 * and a category missing from this list would be invisible to the jurisdiction
 * filter — i.e. silently unreadable — instead of loudly wrong).
 */
const CATEGORY_UNIVERSE: Record<PredictionCategory, true> = {
  stock: true,
  etf_index: true,
  bond_rate: true,
  gold_metal: true,
  macro_econ: true,
  commodity_energy: true,
  crypto_spot: true,
  fx: true,
  futures_derivatives: true,
  crypto_perps: true,
  politics_election: true,
  sports: true,
  entertainment_awards: true,
  memecoin: true,
  real_estate: true,
}

export const ALL_PREDICTION_CATEGORIES = Object.keys(CATEGORY_UNIVERSE) as PredictionCategory[]

/**
 * The categories this viewer may see, for list/aggregate endpoints that span
 * many categories (leaderboard, record room) and therefore need an allow-list
 * to filter rows by, not a single yes/no.
 *
 * Default-deny falls out of `isCategoryAllowed`: a viewer with no resolvable
 * jurisdiction signal at all gets an EMPTY array, and the caller must render
 * that as "nothing available" rather than "no filter".
 */
export function visibleCategoriesFor(input: JurisdictionInput, atMs: number = Date.now()): PredictionCategory[] {
  return ALL_PREDICTION_CATEGORIES.filter((category) => isCategoryAllowed(category, input, atMs))
}

/** Is `instrument` part of the curated ranked set a public user may reach? */
export function isCuratedInstrument(instrument: string, curated: readonly string[]): boolean {
  const needle = instrument.trim()
  if (!needle) return false
  return curated.includes(needle)
}

/**
 * Optional cost/shape knobs on `POST /api/league/generate-stream`. Admin-only:
 * they exist for operational testing (run one tier, cap spend, shorten the
 * timeout), and every one of them can be turned into either extra provider
 * spend or a longer-held serverless function by a hostile caller.
 */
export type GenerateTuning = {
  tiers?: LeagueTier[]
  concurrency?: number
  timeoutMs?: number
  maxCompletionTokens?: number
  costCapUsd?: number
}

/**
 * Non-admin callers get the orchestrator's own server-side defaults for every
 * knob — their request body cannot influence fan-out size or spend ceiling.
 * The 7-credit price is only honest if the work behind it is fixed.
 */
export function tuningForViewer(raw: GenerateTuning, isAdmin: boolean): GenerateTuning {
  return isAdmin ? raw : {}
}

/**
 * Per-user burst guards on the paid endpoints, sized well above any real human
 * pace and well below a runaway retry loop. Credits remain the primary cost
 * control; these only blunt bursts (and are per-process — see `lib/rate-limit.ts`).
 */
export const LEAGUE_GENERATE_RATE_RULE: RateLimitRule = { limit: 5, windowMs: 60_000 }

/** Deep modes cost 50/70 credits and run long multi-model pipelines — tighter. */
export const LEAGUE_DEEP_RATE_RULE: RateLimitRule = { limit: 3, windowMs: 60_000 }

/** Deep archive is a paid query, not a model fan-out — slightly looser than generate. */
export const LEAGUE_ARCHIVE_RATE_RULE: RateLimitRule = { limit: 8, windowMs: 60_000 }

/** Free record-room window: page 1, at most this many recent resolved rounds. */
export const RECORD_ROOM_FREE_PAGE_SIZE = 5
export const RECORD_ROOM_FREE_MAX_PAGE = 1

export type ArchiveQuery = {
  page: number
  pageSize: number
  modelId?: string
  from?: string
  to?: string
  format?: 'json' | 'csv'
}

/**
 * A query is FREE only when it is the recent-summary view: first page, small
 * page size, no model filter, no date range, no CSV export. Anything else is
 * a deep-archive operation and must go through the paid endpoint.
 */
export function isFreeArchiveQuery(q: ArchiveQuery): boolean {
  if (q.modelId && q.modelId.trim()) return false
  if (q.from && q.from.trim()) return false
  if (q.to && q.to.trim()) return false
  if (q.format === 'csv') return false
  if (q.page > RECORD_ROOM_FREE_MAX_PAGE) return false
  if (q.pageSize > RECORD_ROOM_FREE_PAGE_SIZE) return false
  return true
}
