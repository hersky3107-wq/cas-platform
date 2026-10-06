/**
 * Admin comparison of AI 종합 hit rate and majority-share spread before vs
 * after analysis lenses. A round is "after" when any official seat stored a
 * lens. Pure — the loader lives next to the track-record query.
 */

export type LensEra = 'before' | 'after'

export type LensEraDirection = 'up' | 'down' | 'yes' | 'no' | 'above' | 'below' | 'flat' | null

export type LensEraRound = {
  category: string
  consensusCorrect: boolean | null
  directions: readonly LensEraDirection[]
  hasLens: boolean
}

export type LensEraCell = {
  category: string
  era: LensEra
  consensusHitRatePct: number | null
  consensusN: number
  /** Mean of each round's majority share, in percent. */
  meanMajoritySharePct: number | null
  spreadN: number
}

function pct(correct: number, n: number): number | null {
  if (n <= 0) return null
  return Math.round((1000 * correct) / n) / 10
}

/** max(side) / answered. Null when nobody took a side. */
export function majorityShare(directions: readonly LensEraDirection[]): number | null {
  let a = 0
  let b = 0
  for (const direction of directions) {
    if (direction === 'up' || direction === 'yes' || direction === 'above') a += 1
    else if (direction === 'down' || direction === 'no' || direction === 'below') b += 1
  }
  const n = a + b
  if (n <= 0) return null
  return Math.max(a, b) / n
}

export function compareLensEras(rounds: readonly LensEraRound[]): LensEraCell[] {
  const categories = [...new Set(rounds.map((round) => round.category))].sort()
  const cells: LensEraCell[] = []
  for (const category of categories) {
    for (const era of ['before', 'after'] as const) {
      const rows = rounds.filter((round) => round.category === category && round.hasLens === (era === 'after'))
      const graded = rows.filter((round) => round.consensusCorrect !== null)
      let hits = 0
      for (const row of graded) if (row.consensusCorrect) hits += 1
      const shares: number[] = []
      for (const row of rows) {
        const share = majorityShare(row.directions)
        if (share != null) shares.push(share)
      }
      const mean =
        shares.length === 0 ? null : Math.round((1000 * shares.reduce((sum, share) => sum + share, 0)) / shares.length) / 10
      if (graded.length === 0 && shares.length === 0) continue
      cells.push({
        category,
        era,
        consensusHitRatePct: pct(hits, graded.length),
        consensusN: graded.length,
        meanMajoritySharePct: mean,
        spreadN: shares.length,
      })
    }
  }
  return cells
}
