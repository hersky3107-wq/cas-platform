/**
 * Door-opening choreography for the `/league` landing. No React, no DOM:
 * the component injects timers and side effects so the one rule that
 * matters — a click always ends in exactly one navigation — is testable.
 */

export type DoorMotion = 'swing' | 'fade'

export const DOOR_SWING_MS = 760
export const DOOR_FADE_MS = 200
/** How long past the CSS duration to wait for `animationend` before navigating anyway. */
export const DOOR_FALLBACK_GRACE_MS = 250
/** Soft navigation that has not left the page by now gets a hard `location.assign`. */
export const DOOR_HARD_NAV_MS = 5000

export function doorMotionFor(reducedMotion: boolean): { motion: DoorMotion; durationMs: number } {
  return reducedMotion
    ? { motion: 'fade', durationMs: DOOR_FADE_MS }
    : { motion: 'swing', durationMs: DOOR_SWING_MS }
}

export type DoorClickLike = {
  button: number
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  defaultPrevented: boolean
}

/** Plain primary click or Enter. Modified clicks keep the browser's new-tab / download behavior. */
export function shouldAnimateDoorClick(event: DoorClickLike): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  )
}

type MatchMediaHost = { matchMedia?: (query: string) => { matches: boolean } }

export function prefersReducedMotion(
  host: MatchMediaHost | undefined = typeof window === 'undefined' ? undefined : window,
): boolean {
  try {
    return Boolean(host?.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  } catch {
    return false
  }
}

export type DoorEntryDeps<Handle> = {
  reducedMotion: boolean
  /** Kicks off the CSS animation. If it throws, navigation happens immediately. */
  start: (motion: DoorMotion) => void
  navigate: (href: string) => void
  setTimer: (run: () => void, ms: number) => Handle
  clearTimer: (handle: Handle) => void
}

export type DoorEntry = {
  motion: DoorMotion
  /** Call from `animationend`. Safe to call more than once and alongside the timeout. */
  finish: () => void
  /** Drops the pending navigation (unmount, or the page came back from the bfcache). */
  cancel: () => void
}

export function beginDoorEntry<Handle>(href: string, deps: DoorEntryDeps<Handle>): DoorEntry {
  const { motion, durationMs } = doorMotionFor(deps.reducedMotion)
  let settled = false

  const settle = (): boolean => {
    if (settled) return false
    settled = true
    deps.clearTimer(timer)
    return true
  }
  const finish = () => {
    if (settle()) deps.navigate(href)
  }
  const cancel = () => {
    settle()
  }

  const timer = deps.setTimer(finish, durationMs + DOOR_FALLBACK_GRACE_MS)
  try {
    deps.start(motion)
  } catch {
    finish()
  }
  return { motion, finish, cancel }
}

export function financeRoomLabels(
  copy: { financeRooms: readonly string[]; memecoinRoom: string },
  hideMemecoin: boolean,
): readonly string[] {
  return hideMemecoin ? copy.financeRooms : [...copy.financeRooms, copy.memecoinRoom]
}
