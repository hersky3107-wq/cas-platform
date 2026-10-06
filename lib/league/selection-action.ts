/**
 * The one primary action on an instrument's bottom bar.
 * Pure: the hub and the tests both call this. No I/O.
 */

export type SelectionPhase =
  | { phase: 'loading' }
  | { phase: 'missing' }
  | { phase: 'locked'; roundId: string | null }
  | { phase: 'open' }
  | { phase: 'queued'; queuePosition?: number | null; etaMinutes?: number | null }
  | { phase: 'running'; queuePosition?: number | null; etaMinutes?: number | null }
  | { phase: 'unavailable'; reason: string }

export type SelectionAction =
  | { kind: 'generate' }
  | { kind: 'open' }
  | { kind: 'view' }
  | { kind: 'queued'; position: number; etaMinutes: number | null }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'loading' }

export function selectionBarAction(input: SelectionPhase): SelectionAction {
  switch (input.phase) {
    case 'missing':
      return { kind: 'generate' }
    case 'locked':
      return input.roundId ? { kind: 'open' } : { kind: 'generate' }
    case 'open':
      return { kind: 'view' }
    case 'queued':
    case 'running':
      return {
        kind: 'queued',
        position: input.queuePosition && input.queuePosition > 0 ? input.queuePosition : 1,
        etaMinutes: input.etaMinutes ?? null,
      }
    case 'unavailable':
      return { kind: 'unavailable', reason: input.reason }
    case 'loading':
      return { kind: 'loading' }
    default:
      return { kind: 'loading' }
  }
}

/** Card GET miss: a known market refusal disables the bar; a bare no_round offers generate. */
export function cardMissPhase(
  code: string | null | undefined,
  refusal: string | null,
): SelectionPhase {
  if (refusal) return { phase: 'unavailable', reason: refusal }
  if (code === 'no_round' || code == null) return { phase: 'missing' }
  return { phase: 'unavailable', reason: code }
}

export type CardPhaseInput = {
  kind: string
  text?: string | null
  lockedRoundId?: string | null
  generationStatus?: string | null
  queuePosition?: number | null
  etaMinutes?: number | null
}

export function selectionPhaseFromCard(view: CardPhaseInput): SelectionPhase {
  if (view.kind === 'none') return { phase: 'missing' }
  if (view.kind === 'locked') return { phase: 'locked', roundId: view.lockedRoundId ?? null }
  if (view.kind === 'card') {
    if (view.generationStatus === 'queued' || view.generationStatus === 'running') {
      return {
        phase: view.generationStatus,
        queuePosition: view.queuePosition,
        etaMinutes: view.etaMinutes,
      }
    }
    return { phase: 'open' }
  }
  if (
    view.kind === 'krNotice' ||
    view.kind === 'blocked' ||
    view.kind === 'electionClosed' ||
    view.kind === 'error'
  ) {
    return { phase: 'unavailable', reason: view.text?.trim() || 'unavailable' }
  }
  return { phase: 'loading' }
}

type ActionPack = {
  hub: {
    generateForty: (credits: number) => string
    openRound: (credits: number) => string
    viewCard: string
    generatingQueue: (position: number) => string
    queueLine: (position: number, minutes: number) => string
    loading: string
  }
}

export function selectionActionCopy(
  t: ActionPack,
  action: SelectionAction,
  credits: number,
): { text: string; enabled: boolean; eta: string | null } {
  switch (action.kind) {
    case 'generate':
      return { text: t.hub.generateForty(credits), enabled: true, eta: null }
    case 'open':
      return { text: t.hub.openRound(credits), enabled: true, eta: null }
    case 'view':
      return { text: t.hub.viewCard, enabled: true, eta: null }
    case 'queued':
      return {
        text: t.hub.generatingQueue(action.position),
        enabled: false,
        eta: action.etaMinutes != null ? t.hub.queueLine(action.position, action.etaMinutes) : null,
      }
    case 'unavailable':
      return { text: action.reason, enabled: false, eta: null }
    case 'loading':
      return { text: t.hub.loading, enabled: false, eta: null }
    default:
      return { text: t.hub.loading, enabled: false, eta: null }
  }
}
