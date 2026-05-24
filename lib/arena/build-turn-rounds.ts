import type { ArenaAI, ArenaRound } from '@/lib/ai/arena-types'
import type { ArenaShareRoundRow } from '@/lib/arena/session-types'

export function buildArenaTurnRoundRows(
  rounds: ArenaRound[],
  turnNumber: 1 | 2 | 3,
  displayNames: Record<ArenaAI, string>,
  formatContent: (s: string) => string
): ArenaShareRoundRow[] {
  const minR = turnNumber === 1 ? 1 : turnNumber === 2 ? 4 : 7
  const maxR = turnNumber === 1 ? 3 : turnNumber === 2 ? 6 : 9
  const out: ArenaShareRoundRow[] = []

  for (const round of rounds) {
    const rn = Number(round.roundNumber)
    if (rn < minR || rn > maxR) continue
    for (const r of round.responses) {
      out.push({
        ai_name: displayNames[r.ai],
        content: formatContent(r.content),
        round_number: rn,
      })
    }
  }

  return out
}
