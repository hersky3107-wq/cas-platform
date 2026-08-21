import type { CardRoundMeta, HitRateSummary } from './card-types'
import type { LeagueUiPack } from './i18n/dictionary'

/**
 * ONE status the card header is allowed to show. Hit-rate and grading used to
 * render as two pills ("sample collecting" + "grading…") for the same
 * ungraded round. That is the same fact twice, and it is why a stuck grade
 * looked like two independent pending processes.
 */
export type CardStatusKind = 'hit_rate' | 'grading' | 'unresolvable' | 'pending' | 'stalled'

export function cardStatusKind(
  round: Pick<CardRoundMeta, 'gradingState'>,
  hitRate: Pick<HitRateSummary, 'graded'>,
  stalled: boolean
): CardStatusKind {
  if (round.gradingState === 'graded') return 'hit_rate'
  if (round.gradingState === 'unresolvable') return 'unresolvable'
  if (round.gradingState === 'grading') return stalled ? 'stalled' : 'grading'
  if (round.gradingState === 'due_ungraded') return 'pending'
  // not_due: no grade to talk about — the hit-rate badge (usually "pending")
  // is the only status, and it is honest because nothing has been scored yet.
  void hitRate
  return 'hit_rate'
}

const KNOWN_REASONS = [
  'missing_anchor',
  'invalid_window',
  'series_unavailable',
  'no_series_data',
  'no_session_in_window',
  'equal_close',
  'not_price_instrument',
] as const

export type KnownUnresolvableReason = (typeof KNOWN_REASONS)[number]

export function unresolvableReasonCopy(reason: string | null, t: LeagueUiPack): string {
  if (reason && (KNOWN_REASONS as readonly string[]).includes(reason)) {
    return t.grading.reason[reason as KnownUnresolvableReason]
  }
  return t.grading.reason.unknown
}

/**
 * The single status line the header renders. An unresolvable round MUST NOT
 * return the in-progress string — that is the contract the stuck-card bug
 * violated.
 */
export function cardStatusCopy(
  kind: CardStatusKind,
  reason: string | null,
  t: LeagueUiPack
): { badge: string; note: string | null } {
  if (kind === 'unresolvable') {
    return { badge: t.grading.unresolvable, note: unresolvableReasonCopy(reason, t) }
  }
  if (kind === 'grading') return { badge: t.grading.inProgress, note: null }
  if (kind === 'stalled') return { badge: t.grading.stalled, note: t.grading.stalledNote }
  if (kind === 'pending') return { badge: t.grading.pending, note: null }
  return { badge: '', note: null }
}

/** Client poll cadence while a genuine grade is in flight. */
export const GRADING_POLL_MS = 5_000
export const GRADING_POLL_GIVE_UP_MS = 60_000
