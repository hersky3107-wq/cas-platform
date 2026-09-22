import type { CombinedMethodTrack, ConsensusSummary, DirectionTally, ModelSide } from './card-types'
import { mentionsSixSystems } from './extra/copy'
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

export type ConsensusHeroCounts = {
  countLine: string
  upCount: number
  downCount: number
  noDirectionCount: number
  upWord: string
  downWord: string
}

export type ConsensusHeroPayload =
  | ({
      kind: 'answer'
      line1: string
      line2: string
      diverged: boolean
      conclusionLine: string
      conclusionVerb: string
      signedMagnitude: string | null
      horizonLabel: string | null
      confidencePct: number | null
    } & ConsensusHeroCounts)
  | ({ kind: 'fallback'; message: string } & Partial<ConsensusHeroCounts>)

function binarySlot(direction: ConsensusSummary['majorityDirection']): 'up' | 'down' | null {
  const slot = tallySlotOfToken(direction)
  return slot === 'up' || slot === 'down' ? slot : null
}

/** Head-count leader used for "most models". Majority first; else the larger side. */
function headCountSlot(consensus: ConsensusSummary): 'up' | 'down' {
  const fromMajority = binarySlot(consensus.majorityDirection)
  if (fromMajority) return fromMajority
  return consensus.tally.up >= consensus.tally.down ? 'up' : 'down'
}

function tokenForBinarySlot(slot: 'up' | 'down', labels?: SideLabels) {
  if (!labels) return slot
  return slot === 'up' ? labels.sides[0] : labels.sides[1]
}

/** Side-A / side-B answer words. Head-count chrome only — never a verdict. */
export function heroSideWords(
  t: LeagueUiPack,
  labels?: SideLabels,
): { upWord: string; downWord: string } {
  if (labels && labels.kind !== 'binary_close_higher') {
    return { upWord: labels.answer(labels.sides[0]), downWord: labels.answer(labels.sides[1]) }
  }
  return { upWord: t.hero.answerVerb.up, downWord: t.hero.answerVerb.down }
}

/**
 * Two-line card hero. Field map (for audit — no surface may substitute):
 *
 *  Line 1 verb          ← consensus.aggregateDirection
 *                          price: answerVerb, or weightedCallVerb when diverged
 *                          other kinds: labels.answer (prefix when diverged)
 *  Line 1 magnitude     ← consensus.aggregateMagnitudePct → formatSignedPercent
 *                          + t.magnitude.headlineQualifier(horizon) — price rounds
 *                          only; non-price rounds carry no aggregate magnitude
 *  Line 2 sides         ← head-count majority vs the other binary side (· joined)
 *  Line 2 confidence    ← consensus.aggregateProbability ONLY
 *
 * NEVER reads avgProbability for rendered copy. majorityDirection IS read so
 * the hero can name a head-count vs weighted-call split.
 *
 * `labels` omitted = legacy price-round call sites (scripts, frozen fixtures).
 * Live components always pass the round's labels.
 */
export function buildConsensusHero(
  consensus: ConsensusSummary,
  horizon: string,
  t: LeagueUiPack,
  labels?: SideLabels,
): ConsensusHeroPayload | null {
  const { totalModels, respondedModels, tally, aggregateDirection, aggregateProbability, aggregateMagnitudePct } = consensus

  const priceLike = !labels || labels.kind === 'binary_close_higher'
  const upWord =
    labels && labels.kind !== 'binary_close_higher' ? labels.answer(labels.sides[0]) : t.hero.answerVerb.up
  const downWord =
    labels && labels.kind !== 'binary_close_higher' ? labels.answer(labels.sides[1]) : t.hero.answerVerb.down
  const counts: ConsensusHeroCounts = {
    countLine: t.hero.countLine(totalModels, tally.up, upWord, tally.down, downWord),
    upCount: tally.up,
    downCount: tally.down,
    noDirectionCount: tally.flat + tally.abstain,
    upWord,
    downWord,
  }

  if (totalModels === 0) return { kind: 'fallback', message: t.hero.none }
  if (respondedModels === 0) return { kind: 'fallback', message: t.hero.allAbstain(totalModels), ...counts }
  if (!aggregateDirection) {
    return { kind: 'fallback', message: t.hero.split(respondedModels, totalModels), ...counts }
  }

  const aggregateSlot = binarySlot(aggregateDirection) ?? 'down'
  const majoritySlot = headCountSlot(consensus)
  const otherSlot: 'up' | 'down' = majoritySlot === 'up' ? 'down' : 'up'
  const diverged = majoritySlot !== aggregateSlot

  const verb = priceLike
    ? diverged
      ? t.hero.weightedCallVerb[aggregateSlot]
      : t.hero.answerVerb[aggregateSlot]
    : labels!.answer(aggregateDirection)
  const conclusionVerb =
    labels && labels.kind !== 'binary_close_higher'
      ? labels.answer(aggregateDirection)
      : t.hero.answerVerb[aggregateSlot]
  const prefix = diverged ? t.hero.weightedCallPrefix : ''
  const magnitudePart =
    aggregateMagnitudePct !== null
      ? t.magnitude.headlineQualifier(
          t.catalog.horizons[isUiHorizon(horizon) ? horizon : '1d'],
          formatSignedPercent(aggregateMagnitudePct, 1, aggregateSlot),
        )
      : null
  const line1 = prefix + (magnitudePart ? `${verb} · ${magnitudePart}` : verb)

  const majorityToken = tokenForBinarySlot(majoritySlot, labels)
  const otherToken = tokenForBinarySlot(otherSlot, labels)
  const aggregateToken = tokenForBinarySlot(aggregateSlot, labels)
  const majorityWord = labels ? labels.tallyWord(majorityToken) : t.direction.tally[majoritySlot]
  const otherWord = labels ? labels.tallyWord(otherToken) : t.direction.tally[otherSlot]
  const aggregateWord = labels ? labels.tallyWord(aggregateToken) : t.direction.tally[aggregateSlot]
  const saidWord = priceLike ? t.hero.majoritySaid[majoritySlot] : majorityWord
  const majorityCount = tally[majoritySlot]
  const otherCount = tally[otherSlot]
  const conf = aggregateProbability !== null ? Math.round(aggregateProbability) : null

  let line2: string
  if (diverged) {
    line2 =
      conf !== null
        ? t.hero.divergeLine(saidWord, majorityWord, majorityCount, otherWord, otherCount, aggregateWord, conf)
        : t.hero.divergeLineNoConfidence(saidWord, majorityWord, majorityCount, otherWord, otherCount, aggregateWord)
  } else {
    line2 =
      conf !== null
        ? t.hero.supportLine(majorityWord, majorityCount, otherWord, otherCount, conf)
        : t.hero.supportLineNoConfidence(majorityWord, majorityCount, otherWord, otherCount)
  }

  return {
    kind: 'answer',
    line1,
    line2,
    diverged,
    conclusionLine: diverged ? prefix + (priceLike ? t.hero.weightedCallVerb[aggregateSlot] : conclusionVerb) : t.hero.conclusion(conclusionVerb),
    conclusionVerb,
    signedMagnitude: aggregateMagnitudePct !== null ? formatSignedPercent(aggregateMagnitudePct, 1, aggregateSlot) : null,
    horizonLabel: aggregateMagnitudePct !== null ? t.catalog.horizons[isUiHorizon(horizon) ? horizon : '1d'] : null,
    confidencePct: conf,
    ...counts,
  }
}

/** Magnitude qualifier fragment only — used by tests and legacy callers. */
export function magnitudeHeadlineQualifier(consensus: ConsensusSummary, horizon: string, t: LeagueUiPack): string | null {
  if (consensus.aggregateMagnitudePct === null) return null
  const horizonLabel = t.catalog.horizons[isUiHorizon(horizon) ? horizon : '1d']
  const signDir =
    consensus.aggregateDirection === 'up' || consensus.aggregateDirection === 'down'
      ? consensus.aggregateDirection
      : null
  return t.magnitude.headlineQualifier(horizonLabel, formatSignedPercent(consensus.aggregateMagnitudePct, 1, signDir))
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
 * Pre-grading axis line. PREDICTION counts, never hits.
 * Uses the round's `labels.tallyWord` so sports/threshold cards don't say "up".
 * Never a slash-over-total, never ✓/✗.
 */
export function predictionAxisLine(
  label: string,
  tally: DirectionTally,
  t: LeagueUiPack,
  labels: SideLabels,
): string {
  const n = tally.up + tally.down + tally.flat + tally.abstain
  const parts: string[] = []
  if (tally.up) parts.push(t.predictions.axisPart(tally.up, labels.tallyWord(labels.sides[0])))
  if (tally.down) parts.push(t.predictions.axisPart(tally.down, labels.tallyWord(labels.sides[1])))
  if (tally.flat) parts.push(t.predictions.axisPart(tally.flat, labels.tallyWord('flat')))
  if (tally.abstain) parts.push(t.predictions.axisPart(tally.abstain, labels.tallyWord(null)))
  return t.predictions.axisLine(label, n, parts.length ? parts.join(' \u00b7 ') : t.predictions.noCalls)
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

export function extraExperimentalDisclaimer(t: LeagueUiPack): string {
  return t.disclaimer.extraExperimental
}

export function assertApprovedCopy(text: string): void {
  const lower = text.toLowerCase()
  const hit = BANNED_TOKENS.find((t) => lower.includes(t))
  if (hit) {
    throw new Error(`league compliance: banned phrase "${hit}" in card copy: "${text}"`)
  }
  const six = mentionsSixSystems(text)
  if (six) {
    throw new Error(`league compliance: banned extra-tier phrase "${six}" in card copy: "${text}"`)
  }
}

export function assertExtraExperimentalDisclaimer(text: string): void {
  if (!text.trim()) {
    throw new Error('league compliance: extra-tier experimental disclaimer missing')
  }
}
