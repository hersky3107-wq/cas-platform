import type { CombinedMethodTrack, ConsensusSummary, ModelSide } from './card-types'
import type { LeagueUiPack } from './i18n/dictionary'
import { tallySlotOfToken, type SideLabels } from './side-labels'
import { formatWinRatePct } from './win-rate'
import { isUiHorizon } from './horizon'
import { formatSignedPercent } from './magnitude'

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

/**
 * Neutral badge word for a single model's row. Never "BUY"/"SELL".
 * Pass the round's `labels` (from `sideLabelsFor`) so the word matches the
 * round's contract — 상승 · 승 · 상회. Without `labels` this is the legacy
 * price-round path (scripts, old tests): identical bytes for up/down/flat,
 * and any non-price token falls back to its slot's price word rather than
 * crashing (those callers only ever see price rounds).
 */
export function directionBadgeLabel(direction: ModelSide | null, t: LeagueUiPack, labels?: SideLabels): string {
  if (labels) return labels.badge(direction)
  const slot = tallySlotOfToken(direction)
  return slot ? t.direction.badge[slot] : t.direction.noCallBadge
}

/**
 * Legacy single-line headline (e.g. "6 of 8 AI models lean UP · 58% avg
 * confidence"). Kept for scripts and retrospective tooling — the live card
 * hero uses `buildConsensusHero` instead. When called, confidence still
 * prefers `aggregateProbability` over `avgProbability`.
 */
export function consensusHeadline(consensus: ConsensusSummary, t: LeagueUiPack): string {
  const { tally, majorityDirection, totalModels, respondedModels, avgProbability, aggregateDirection, aggregateProbability } =
    consensus

  if (totalModels === 0) return t.headline.none
  if (respondedModels === 0) return t.headline.allAbstain(totalModels)

  // Slot-based so a yes/above majority counts its own side instead of reading
  // an undefined tally key. The WORD stays the slot's price verb — acceptable
  // only because this template no longer renders on cards (scripts/tooling,
  // price rounds); live surfaces use buildConsensusHero with SideLabels.
  const majoritySlot = tallySlotOfToken(majorityDirection)
  const slot =
    tallySlotOfToken(aggregateDirection) ?? (majoritySlot === 'up' || majoritySlot === 'down' ? majoritySlot : null)
  const probability = aggregateDirection != null ? aggregateProbability : avgProbability

  if (!slot || slot === 'flat') return t.headline.split(respondedModels, totalModels)

  const leanCount = tally[slot]
  return t.headline.majority(leanCount, totalModels, slot, probability)
}

export type ConsensusHeroPayload =
  | { kind: 'answer'; line1: string; line2: string }
  | { kind: 'fallback'; message: string }

/**
 * Two-line card hero. Field map (for audit — no surface may substitute):
 *
 *  Line 1 verb          ← consensus.aggregateDirection → labels.answer
 *                          (round's own contract: 오른다 · "맨유 승" · "3.4% 상회")
 *  Line 1 magnitude     ← consensus.aggregateMagnitudePct → formatSignedPercent
 *                          + t.magnitude.headlineQualifier(horizon) — price rounds
 *                          only; non-price rounds carry no aggregate magnitude
 *  Line 2 lean count    ← consensus.tally[slot of aggregateDirection]
 *  Line 2 total         ← consensus.totalModels
 *  Line 2 confidence    ← consensus.aggregateProbability ONLY (log-odds aggregate)
 *
 * NEVER reads avgProbability or majorityDirection for rendered copy.
 * majorityDirection / avgProbability stay on ConsensusSummary for retrospective
 * comparison elsewhere — they do not appear in the hero.
 *
 * `labels` omitted = legacy price-round call sites (scripts, frozen-fixture
 * baselines): verb comes straight from t.hero.answerVerb, byte-identical to
 * the pre-resolver hero. Live components always pass the round's labels.
 */
export function buildConsensusHero(
  consensus: ConsensusSummary,
  horizon: string,
  t: LeagueUiPack,
  labels?: SideLabels,
): ConsensusHeroPayload | null {
  const { totalModels, respondedModels, tally, aggregateDirection, aggregateProbability, aggregateMagnitudePct } = consensus

  if (totalModels === 0) return { kind: 'fallback', message: t.hero.none }
  if (respondedModels === 0) return { kind: 'fallback', message: t.hero.allAbstain(totalModels) }
  if (!aggregateDirection) return { kind: 'fallback', message: t.hero.split(respondedModels, totalModels) }

  const verb = labels
    ? labels.answer(aggregateDirection)
    : t.hero.answerVerb[aggregateDirection === 'up' ? 'up' : 'down']
  const magnitudePart =
    aggregateMagnitudePct !== null
      ? t.magnitude.headlineQualifier(
          t.catalog.horizons[isUiHorizon(horizon) ? horizon : '1d'],
          formatSignedPercent(aggregateMagnitudePct),
        )
      : null
  const line1 = magnitudePart ? `${verb} · ${magnitudePart}` : verb

  const slot = tallySlotOfToken(aggregateDirection)
  const leanCount = slot === 'up' || slot === 'down' ? tally[slot] : 0
  const line2 =
    aggregateProbability !== null
      ? t.hero.supportLine(leanCount, totalModels, Math.round(aggregateProbability))
      : t.hero.supportLineNoConfidence(leanCount, totalModels)

  return { kind: 'answer', line1, line2 }
}

/** Magnitude qualifier fragment only — used by tests and legacy callers. */
export function magnitudeHeadlineQualifier(consensus: ConsensusSummary, horizon: string, t: LeagueUiPack): string | null {
  if (consensus.aggregateMagnitudePct === null) return null
  const horizonLabel = t.catalog.horizons[isUiHorizon(horizon) ? horizon : '1d']
  return t.magnitude.headlineQualifier(horizonLabel, formatSignedPercent(consensus.aggregateMagnitudePct))
}

/**
 * Post-grading "predicted vs actual" comparison line, e.g.
 * "predicted +2.4% → actual +1.4%" (or its translation) — DISPLAY ONLY. Never
 * feeds `is_correct`, a hit count, or a win rate (see
 * `lib/league/__tests__/round-hit.test.ts`'s magnitude-exclusion assertion).
 * Used both at the round level (predicted = the aggregate) and per-model
 * (predicted = that model's own magnitude) — same template either way.
 */
export function magnitudeCompareLine(predictedPct: number, actualPct: number, t: LeagueUiPack): string {
  return t.magnitude.predictedVsActual(formatSignedPercent(predictedPct), formatSignedPercent(actualPct))
}

/** Approved one-line group summary, e.g. "US: 3 up · 1 down". Used for camp/tier rows. */
export function groupTallyLine(label: string, tally: ConsensusSummary['tally'], t: LeagueUiPack): string {
  return t.groupTallyLine(label, tally)
}

/**
 * Citation-style past accuracy of the 40-model majority-vote method. Never
 * advice, and never a percentage below the minimum sample: with too few resolved
 * rounds `winRatePct` is null by construction (see `lib/league/win-rate.ts`) and
 * this line states the raw record instead — "still collecting a track record
 * (1W 0L, sample too small)" — rather than "100% accurate so far".
 */
export function combinedTrackLine(track: CombinedMethodTrack, t: LeagueUiPack): string {
  if (track.winRatePct === null) {
    if (track.n === 0) return t.bracket.combinedTrackPending
    const losses = Math.max(0, track.resolved - track.correct)
    return `${t.bracket.combinedTrackPending} (${t.winRate.insufficient(track.correct, losses)})`
  }
  return t.bracket.combinedTrack(formatWinRatePct(track.winRatePct), track.n)
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
