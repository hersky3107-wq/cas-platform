/**
 * Generic freeform search → resolve → pick → generate.
 *
 * Sports is the first consumer. Politics / entertainment / real-estate
 * reuse this result shape: a named target (team, candidate, title, REIT)
 * resolves onto a public slate, or the user is asked to pick one upcoming
 * event, or the input is refused with precise guidance — never a browse list.
 *
 * Pure module — no I/O.
 */

export const TARGET_WINDOW_MS = 35 * 86_400_000
export const MAX_TARGET_PICKS = 12

export type TargetPick = { id: string; label: string }

export type TargetSearchResult =
  | { kind: 'vague' }
  | { kind: 'past' }
  | { kind: 'unsupported' }
  | { kind: 'picks'; options: TargetPick[] }
  | { kind: 'ready'; entityId: string; label: string; skipConfirm?: boolean }

/** Map a generic miss onto the gateway refusal taxonomy. Sports is first; politics / entertainment / real-estate reuse the same three. */
export function targetRefusalCode(
  kind: 'vague' | 'past' | 'unsupported',
): 'vague_target' | 'past_event' | 'non_public_fixture' {
  if (kind === 'vague') return 'vague_target'
  if (kind === 'past') return 'past_event'
  return 'non_public_fixture'
}

export function isTargetPickId(id: string, decode: (id: string) => unknown): boolean {
  return decode(id) != null
}
