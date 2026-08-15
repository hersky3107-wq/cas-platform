/**
 * 십신 (Ten Gods): each pillar's stem/branch labeled relative to the day stem.
 *
 * Simplification (유파 note): branches are labeled using their own principal
 * five-element (地支本氣) directly, e.g. 巳 -> fire. Some schools instead
 * decompose each branch into its 지장간 (hidden stems) and weight the ten-god
 * label by which hidden stem is dominant. That weighted approach is NOT
 * implemented here — flagged as an open convention choice.
 */
import type { BranchInfo, FourPillars, StemInfo, TenGodName } from './types'
import { TEN_GOD_MATRIX, overcomes, producedBy } from './tables'

function tenGodFor(dayStem: StemInfo, target: StemInfo | BranchInfo): TenGodName {
  const same = target.yinYang === dayStem.yinYang
  if (target.element === dayStem.element) return TEN_GOD_MATRIX.same[same ? 'same' : 'diff'] as TenGodName
  if (target.element === producedBy(dayStem.element)) return TEN_GOD_MATRIX.produces[same ? 'same' : 'diff'] as TenGodName
  if (target.element === overcomes(dayStem.element)) return TEN_GOD_MATRIX.dominates[same ? 'same' : 'diff'] as TenGodName
  if (dayStem.element === overcomes(target.element)) return TEN_GOD_MATRIX.dominatedBy[same ? 'same' : 'diff'] as TenGodName
  // Only remaining case: target produces dayStem's element (producedBy dayStem).
  return TEN_GOD_MATRIX.producedBy[same ? 'same' : 'diff'] as TenGodName
}

export function tenGods(dayStem: StemInfo, pillars: FourPillars) {
  return {
    year: { stem: tenGodFor(dayStem, pillars.year.stem), branch: tenGodFor(dayStem, pillars.year.branch) },
    month: { stem: tenGodFor(dayStem, pillars.month.stem), branch: tenGodFor(dayStem, pillars.month.branch) },
    day: { stem: '일간' as const, branch: tenGodFor(dayStem, pillars.day.branch) },
    hour: pillars.hour
      ? { stem: tenGodFor(dayStem, pillars.hour.stem), branch: tenGodFor(dayStem, pillars.hour.branch) }
      : null,
  }
}
