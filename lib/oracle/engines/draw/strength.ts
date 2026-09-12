/**
 * 육효 왕쇠 parts and 복장 — kept as separate fields, never folded into a score.
 *
 * 월령 왕상휴수사 is the classical base (little school variance on the five
 * labels). 일건 and 동효 생극 are modifiers reported beside it. Combining
 * them into one "strong/weak" label is school-variant (empty 旺衰, 动爻
 * 生扶 weights, 月破) so this module does not invent a weighting.
 */
import {
  ELEMENT_GENERATES,
  ELEMENT_OVERCOMES,
  SIX_RELATIVES,
  type FiveElement,
  type SixRelative,
} from './tables'
import type { ChangingLineAction, DayLineRelation, MonthPhase } from './types'

/**
 * 월령 왕상휴수사 of a line vs the month's element (월건 오행).
 *
 * Cycle tables: `ELEMENT_GENERATES` / `ELEMENT_OVERCOMES` in this engine,
 * verified identical to `calendar/relations` (do not re-derive).
 *
 * 囚 vs 死 — this pair is the one books reverse. This engine follows:
 *   囚 = the MONTH overcomes the LINE (line is overcome / imprisoned)
 *        ELEMENT_OVERCOMES[month] === line
 *   死 = the LINE overcomes the MONTH (line spends itself attacking the season)
 *        ELEMENT_OVERCOMES[line] === month
 * Some 명리 primers swap those two names; 旺/相/休 are not in dispute.
 */
export function monthPhase(line: FiveElement, month: FiveElement): MonthPhase {
  if (line === month) return '旺'
  if (ELEMENT_GENERATES[month] === line) return '相'
  if (ELEMENT_GENERATES[line] === month) return '休'
  if (ELEMENT_OVERCOMES[month] === line) return '囚'
  if (ELEMENT_OVERCOMES[line] === month) return '死'
  throw new Error(`draw engine: 왕상휴수사 unreachable for line=${line} month=${month}`)
}

/**
 * 일건: 일진 지지 오행 vs this line (생/극/비화, direction preserved).
 *
 * 日建 is the day's earthly branch, parallel to 月建 for 월령. 일간 is
 * already consumed by 육수 assignment and is not reused here.
 */
export function dayRelation(day: FiveElement, line: FiveElement): DayLineRelation {
  if (day === line) return { kind: '비화', actor: 'same' }
  if (ELEMENT_GENERATES[day] === line) return { kind: '생', actor: 'day' }
  if (ELEMENT_GENERATES[line] === day) return { kind: '생', actor: 'line' }
  if (ELEMENT_OVERCOMES[day] === line) return { kind: '극', actor: 'day' }
  if (ELEMENT_OVERCOMES[line] === day) return { kind: '극', actor: 'line' }
  throw new Error(`draw engine: 일건 unreachable for day=${day} line=${line}`)
}

/**
 * 동효 생극: each changing line's outgoing 생 / 극 of every other line.
 * Same-element (비화) and the reverse (other generates/controls the 동효)
 * are not listed — the question is whether the 동효 generates or controls.
 */
export function changingActions(
  lines: readonly { position: number; element: FiveElement; changing: boolean }[],
): ChangingLineAction[] {
  const movers = lines.filter((line) => line.changing)
  const out: ChangingLineAction[] = []
  for (const from of movers) {
    for (const to of lines) {
      if (from.position === to.position) continue
      if (ELEMENT_GENERATES[from.element] === to.element) {
        out.push({ from: from.position, to: to.position, action: '생' })
      } else if (ELEMENT_OVERCOMES[from.element] === to.element) {
        out.push({ from: from.position, to: to.position, action: '극' })
      }
    }
  }
  return out
}

/**
 * 복장 inventory: 육친 names not present on any of the six lines.
 *
 * Deliberately not Jing Fang 伏神: that school also places the missing
 * relative's 납갑 from the palace's 본궁 hexagram under a line. Callers
 * asked which 육친 are absent — that one scan, not the placement.
 */
export function hiddenRelatives(lines: readonly { relative: SixRelative }[]): SixRelative[] {
  const present = new Set(lines.map((line) => line.relative))
  return SIX_RELATIVES.filter((relative) => !present.has(relative))
}
