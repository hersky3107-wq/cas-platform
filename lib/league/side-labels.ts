import { isPropositionKind, sidePairForKind, type AnswerSide } from './answer-contract'
import type { PropositionKind } from './gateway/types'
import type { LeagueUiPack, SubjectOutcomeFamilyKey } from './i18n/dictionary'
import type { ModelSide, SideToken } from './card-types'

/**
 * AI Prediction League — THE side-label resolver (pure, client-safe).
 *
 * Every rendered side WORD and GLYPH derives from the round's
 * (proposition_kind, subject_label, side) through this module — never from
 * the stored token alone, and never from per-surface word tables. This is the
 * ONE place the three contracts' vocabularies meet the eight locales:
 *
 *   binary_close_higher    up|down      오른다/내린다, ▲/▼  (byte-identical to
 *                                       the pre-resolver dictionary fields —
 *                                       proven by the 71aedfd3 frozen-fixture
 *                                       parity test)
 *   binary_subject_outcome yes|no       "{subject} 승" / "{subject} 승 실패",
 *                                       domain pair from the round's category
 *                                       (승/패, 당선/낙선, 수상/불발), glyphs Y/N
 *   binary_threshold       above|below  상회/하회 (+ threshold when the round
 *                                       carries one), glyphs >/<
 *
 * GLYPH LAW (2026-08-24, extended 2026-08-31): a number on screen must be
 * unambiguously a SIDE count or a HIT count from its glyph alone. Hit counts
 * always carry ✓ and a total; side counts never use a slash-over-total and
 * never use ✓/✗. Each kind gets its own glyph pair so a side glyph can also
 * never impersonate another contract's answer: ▲▼ are price-only, Y/N are the
 * yes|no token initials (language-neutral by the same convention that keeps
 * ▲▼ untranslated), >/< read as above/below the stated line. '■' stays the
 * legacy-flat glyph and '–' the no-answer glyph, kind-independent.
 *
 * The QUALIFIER stays out of this module entirely: magnitude/scoreline/margin
 * rendering lives with the surfaces (as decoration next to a side badge) and
 * never enters a side label, a hit fraction, or a ✓/✗ mark.
 */

/** Legacy-flat and no-answer glyphs — kind-independent, historical. */
const FLAT_GLYPH = '\u25a0' // ■
const NO_CALL_GLYPH = '\u2013' // –

/** Per-kind side-A/side-B glyph pairs. ▲▼ byte-identical for price rounds. */
export const KIND_GLYPHS: Record<PropositionKind, readonly [string, string]> = {
  binary_close_higher: ['\u25b2', '\u25bc'], // ▲ ▼
  binary_subject_outcome: ['Y', 'N'],
  binary_threshold: ['>', '<'],
}

/**
 * Outcome-word family for binary_subject_outcome, derived from the round's
 * own persisted category — the adapter picked that category, so the pair is
 * still round-supplied, resolved per locale as an i18n key (never stored as
 * display text on the round).
 */
export type SubjectOutcomeFamily = SubjectOutcomeFamilyKey

export function subjectOutcomeFamily(category: string | null | undefined): SubjectOutcomeFamily {
  switch (category) {
    case 'sports':
      return 'win'
    case 'politics_election':
      return 'elected'
    case 'entertainment':
      return 'awarded'
    default:
      return 'achieved'
  }
}

/**
 * THE token gate every read path uses (replaces the four per-file
 * `toDirection` copies that narrowed yes/no/above/below to null — which is
 * what made a subject-outcome round render as 40 abstentions). Passes every
 * valid contract side token through; keeps legacy 'flat' as its own value;
 * null ONLY for null/garbage — i.e. only a genuine no-answer is a no-answer.
 */
export function toSideToken(raw: string | null | undefined): ModelSide | null {
  switch (raw) {
    case 'up':
    case 'down':
    case 'yes':
    case 'no':
    case 'above':
    case 'below':
    case 'flat':
      return raw
    default:
      return null
  }
}

/**
 * Token → tally slot WITHOUT round context. Sound because side tokens are
 * contract-exclusive and side A is always the pair's first token (up / yes /
 * above — see `answer-contract.ts`). This is what lets `DirectionTally`
 * (whose field names are the historical up/down slots) stay wire-compatible
 * while counting any contract's rows. null = no answer.
 */
export function tallySlotOfToken(side: ModelSide | null): 'up' | 'down' | 'flat' | null {
  switch (side) {
    case 'up':
    case 'yes':
    case 'above':
      return 'up'
    case 'down':
    case 'no':
    case 'below':
      return 'down'
    case 'flat':
      return 'flat'
    default:
      return null
  }
}

/** The round fields the resolver reads. Subset of `CardRoundMeta` — also satisfied by raw DB rows. */
export type SideRoundContext = {
  proposition_kind?: string | null
  subject_label?: string | null
  category?: string | null
}

/** The round's own side pair, [side A, side B]. Unknown/legacy kind → up/down. */
export function sidePairOf(round: SideRoundContext): readonly [AnswerSide, AnswerSide] {
  return sidePairForKind(propositionKindOf(round))
}

/**
 * Which tally slot a row's side lands in for THIS round's contract:
 * 'a' = first token of the pair (up/yes/above), 'b' = second, 'flat' = the
 * grandfathered legacy value, 'none' = no answer or a token from a different
 * contract (defensive: cross-contract tokens must never masquerade as sides).
 */
export type SideSlot = 'a' | 'b' | 'flat' | 'none'

export type SideLabels = {
  kind: PropositionKind
  /** The contract's two side tokens, in pair order [side A, side B]. */
  sides: readonly [AnswerSide, AnswerSide]
  /** Side-A/side-B glyph pair for compact tallies and distribution legends. */
  glyphs: readonly [string, string]
  /** Tally slot of a stored side value under this round's contract. */
  slot: (side: ModelSide | null) => SideSlot
  /** Short badge word for a model row / legend, e.g. 상승 · 승 · 상회. */
  badge: (side: ModelSide | null) => string
  /** Row glyph: side A/B glyph, ■ for legacy flat, – for no answer. */
  glyph: (side: ModelSide | null) => string
  /** Hero answer phrase, subject-aware, e.g. 오른다 · "맨유 승" · "3.4% 상회". */
  answer: (side: SideToken) => string
  /** Lowercase word for tally sentences (groupTallyLine style). */
  tallyWord: (side: ModelSide | null) => string
}

/** Narrow a persisted kind; unknown/legacy → close_higher (a fact — every pre-kind round is a price round). */
export function propositionKindOf(round: SideRoundContext): PropositionKind {
  return isPropositionKind(round.proposition_kind) ? round.proposition_kind : 'binary_close_higher'
}

/**
 * Build the label set every surface renders from. ONE resolver — components
 * never assemble side words themselves (same architecture as
 * `lib/league/compliance.ts` for directional sentences).
 */
export function sideLabelsFor(round: SideRoundContext, t: LeagueUiPack): SideLabels {
  const kind = propositionKindOf(round)
  const sides = sidePairForKind(kind)
  const glyphs = KIND_GLYPHS[kind]

  const slot = (side: ModelSide | null): SideSlot => {
    if (side === null) return 'none'
    if (side === 'flat') return 'flat'
    if (side === sides[0]) return 'a'
    if (side === sides[1]) return 'b'
    return 'none'
  }

  const glyph = (side: ModelSide | null): string => {
    const s = slot(side)
    if (s === 'a') return glyphs[0]
    if (s === 'b') return glyphs[1]
    if (s === 'flat') return FLAT_GLYPH
    return NO_CALL_GLYPH
  }

  if (kind === 'binary_subject_outcome') {
    const family = subjectOutcomeFamily(round.category)
    const pair = t.sides.subjectOutcome[family]
    const subject = round.subject_label?.trim() || null
    const badge = (side: ModelSide | null): string => {
      const s = slot(side)
      if (s === 'a') return pair.badge.yes
      if (s === 'b') return pair.badge.no
      return t.direction.noCallBadge
    }
    return {
      kind,
      sides,
      glyphs,
      slot,
      glyph,
      badge,
      answer: (side) =>
        subject
          ? side === 'yes'
            ? pair.answer.yes(subject)
            : pair.answer.no(subject)
          : badge(side),
      tallyWord: (side) => (slot(side) === 'none' ? t.direction.noCallTally : badge(side)),
    }
  }

  if (kind === 'binary_threshold') {
    const threshold = round.subject_label?.trim() || null
    const badge = (side: ModelSide | null): string => {
      const s = slot(side)
      if (s === 'a') return t.sides.threshold.badge.above
      if (s === 'b') return t.sides.threshold.badge.below
      return t.direction.noCallBadge
    }
    return {
      kind,
      sides,
      glyphs,
      slot,
      glyph,
      badge,
      answer: (side) =>
        side === 'above' ? t.sides.threshold.answer.above(threshold) : t.sides.threshold.answer.below(threshold),
      tallyWord: (side) => (slot(side) === 'none' ? t.direction.noCallTally : badge(side)),
    }
  }

  // binary_close_higher — the historical fields, verbatim, so every price
  // surface stays byte-identical (direction.badge/tally, hero.answerVerb).
  return {
    kind,
    sides,
    glyphs,
    slot,
    glyph,
    badge: (side) => {
      const s = slot(side)
      if (s === 'a') return t.direction.badge.up
      if (s === 'b') return t.direction.badge.down
      if (s === 'flat') return t.direction.badge.flat
      return t.direction.noCallBadge
    },
    answer: (side) => t.hero.answerVerb[side === 'up' ? 'up' : 'down'],
    tallyWord: (side) => {
      const s = slot(side)
      if (s === 'a') return t.direction.tally.up
      if (s === 'b') return t.direction.tally.down
      if (s === 'flat') return t.direction.tally.flat
      return t.direction.noCallTally
    },
  }
}

