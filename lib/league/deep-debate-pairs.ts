/**
 * After openings, each debater is paired with one opponent. Pure: no I/O.
 * Final sides are used when they split evenly; a lopsided final vote falls
 * back to the assigned sides, which are always 3 vs 3.
 */
import type { DebateSide } from './deep-report-policy'

export type PairSeat = {
  provider: string
  model: string
  assignedSide: DebateSide
  finalSide: DebateSide | null
}

export type DebatePair = { yes: PairSeat; no: PairSeat }

export function pairOffset(roundId: string, size: number): number {
  if (size <= 1) return 0
  let hash = 0
  for (const ch of roundId) hash = (hash * 33 + ch.charCodeAt(0)) >>> 0
  return hash % size
}

function splitBy(seats: readonly PairSeat[], sideOf: (seat: PairSeat) => DebateSide | null): { yes: PairSeat[]; no: PairSeat[] } {
  return {
    yes: seats.filter((seat) => sideOf(seat) === 'yes'),
    no: seats.filter((seat) => sideOf(seat) === 'no'),
  }
}

function evenSplit(groups: { yes: PairSeat[]; no: PairSeat[] }, total: number): boolean {
  return groups.yes.length > 0 && groups.yes.length === groups.no.length && groups.yes.length + groups.no.length === total
}

/** Three pairs when both sides have the same count. Opponent index rotates with the round id. */
export function pairDebaters(roundId: string, seats: readonly PairSeat[]): DebatePair[] {
  const usable = seats.filter((seat) => seat.provider && seat.model)
  const byFinal = splitBy(usable, (seat) => seat.finalSide)
  const groups = evenSplit(byFinal, usable.length) ? byFinal : splitBy(usable, (seat) => seat.assignedSide)
  const n = Math.min(groups.yes.length, groups.no.length)
  if (n === 0) return []
  const offset = pairOffset(roundId, n)
  const pairs: DebatePair[] = []
  for (let i = 0; i < n; i++) {
    pairs.push({ yes: groups.yes[i]!, no: groups.no[(i + offset) % n]! })
  }
  return pairs
}

export function opponentOf(pairs: readonly DebatePair[], provider: string): PairSeat | null {
  for (const pair of pairs) {
    if (pair.yes.provider === provider) return pair.no
    if (pair.no.provider === provider) return pair.yes
  }
  return null
}

/** A quote counts when it is copied from the opponent's headline or a point. */
export function quoteMatchesOpening(
  quote: string,
  opening: { headline?: string | null; points?: readonly { text?: string | null }[] | null },
): boolean {
  const q = normalizeClaim(quote)
  if (q.length < 12) return false
  const sources = [opening.headline, ...(opening.points ?? []).map((point) => point?.text)]
  return sources.some((text) => {
    const src = normalizeClaim(text ?? '')
    return src.length > 0 && (src.includes(q) || q.includes(src))
  })
}

export function normalizeClaim(text: string): string {
  return text
    .replace(/[“”「」『』"'`]/g, '')
    .replace(/…+$/u, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** True when one judgment line names both sides of a pair. */
export function chairCitesExchange(lines: readonly string[], pairs: readonly { left: string; right: string }[]): boolean {
  return lines.some((line) => {
    const blob = line.toLowerCase()
    return pairs.some((pair) => blob.includes(pair.left.toLowerCase()) && blob.includes(pair.right.toLowerCase()))
  })
}

/** New rebuttals carry a quote and wait for the counter-reply. Older rebuttals already include a final call. */
export function rebuttalsAwaitCounter(rebuttals: unknown): boolean {
  if (!Array.isArray(rebuttals)) return false
  return rebuttals.some((row) => {
    if (!row || typeof row !== 'object') return false
    const turn = row as { ok?: unknown; quotedClaim?: unknown; finalSide?: unknown }
    return turn.ok === true && typeof turn.quotedClaim === 'string' && turn.quotedClaim.length > 0 && turn.finalSide == null
  })
}
