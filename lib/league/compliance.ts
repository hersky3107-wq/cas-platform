import type { ConsensusSummary, Direction } from './card-types'
import type { LeagueUiPack } from './i18n/dictionary'

/**
 * AI Prediction League — REGULATORY / COMPLIANCE LAYER (Layer 2).
 *
 * WHY THIS FILE EXISTS (regulatory lifeline):
 * This product shows what AI MODELS predict about market direction. The
 * instant any copy on a card reads as an instruction to the user — "BUY",
 * "this will go up", odds/payout framing — the product stops being "AI
 * commentary" and starts looking like unlicensed investment advice or a
 * betting product in most jurisdictions. That is an existential legal risk,
 * not a style preference.
 *
 * The fix is architectural, not a style guide: every user-facing string that
 * talks about direction MUST be produced by one of the approved templates
 * below. Components import these functions; they never hand-assemble
 * directional sentences themselves. See `components/league/CardCompliance.tsx`
 * for the second half of the boundary (the disclaimer that can never be
 * omitted, and the type-level guarantee that card content cannot render
 * without it).
 *
 * Rule of thumb embedded in every template: subject = "N of M AI models",
 * verb = "predict / lean", never an imperative aimed at the user.
 *
 * LOCALIZATION (Layer A): every function below takes a `LeagueUiPack` (see
 * `lib/league/i18n/dictionary.ts`) instead of hard-coding English. This is
 * intentional and load-bearing for compliance, not just i18n convenience —
 * it means a locale CANNOT ship without its own translated disclaimer and
 * headline template, because there is no English-language fallback baked
 * into this file for those fields; `getLeagueUiPack` is where a missing
 * locale falls back (to English), and that is a conscious, visible choice
 * made in one place, not an accident of this file forgetting to translate.
 */

/** Neutral badge word for a single model's row. Never "BUY"/"SELL". */
export function directionBadgeLabel(direction: Direction | null, t: LeagueUiPack): string {
  return direction ? t.direction.badge[direction] : t.direction.noCallBadge
}

/**
 * The one approved consensus headline template, e.g.
 * "6 of 8 AI models lean UP · 58% avg confidence" (or its translation).
 * This is the ONLY place a "lean" sentence is assembled — do not
 * string-concatenate direction words anywhere else in the UI.
 */
export function consensusHeadline(consensus: ConsensusSummary, t: LeagueUiPack): string {
  const { tally, majorityDirection, totalModels, respondedModels, avgProbability } = consensus

  if (totalModels === 0) return t.headline.none
  if (respondedModels === 0) return t.headline.allAbstain(totalModels)
  if (!majorityDirection) return t.headline.split(respondedModels, totalModels)

  const majorityCount = tally[majorityDirection]
  return t.headline.majority(majorityCount, totalModels, majorityDirection, avgProbability)
}

/** Approved one-line group summary, e.g. "US: 3 up · 1 down". Used for camp/tier rows. */
export function groupTallyLine(label: string, tally: ConsensusSummary['tally'], t: LeagueUiPack): string {
  return t.groupTallyLine(label, tally)
}

/**
 * Lightweight dev-time safety net for the phrases this module itself
 * produces (NOT a sanitizer for a model's free-text `reasoning_snippet` —
 * that is the model's own attributed quote, rendered as reported speech, and
 * scanning arbitrary LLM prose for every possible advice-like phrasing is a
 * separate, larger effort. TODO: revisit if `reasoning_snippet` display
 * needs its own filter). English-only by design — it checks OUR templates'
 * output, and English is always one of the languages we can mechanically
 * verify against known banned tokens; non-English packs are reviewed by a
 * human translator instead (see `dictionary.ts`).
 */
const BANNED_TOKENS = ['buy now', 'sell now', 'price target', 'you should buy', 'you should sell', 'place a bet', 'odds of winning']

export function assertApprovedCopy(text: string): void {
  const lower = text.toLowerCase()
  const hit = BANNED_TOKENS.find((t) => lower.includes(t))
  if (hit) {
    throw new Error(`league compliance: banned phrase "${hit}" in card copy: "${text}"`)
  }
}
