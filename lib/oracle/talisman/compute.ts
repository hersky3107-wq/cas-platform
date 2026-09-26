import { canComputeTalisman } from './access'
import { resolveCentre } from './centre'
import { extractNativeFindings } from './native'
import { collectSeals, subtractSealed } from './seals'
import { fudanSpec, purposeBundle } from './purpose'
import { independenceCensus } from './types'
import type { AxisConsensus } from '../axes/types'
import type { TalismanAccessInput, TalismanCharts, TalismanComputation, TalismanPrismColors, TalismanPurpose } from './types'

export function computeTalisman(input: {
  access: TalismanAccessInput
  charts: TalismanCharts
  consensus: Pick<AxisConsensus, 'elements'> | null
  purpose?: TalismanPurpose | null
  prismColors?: TalismanPrismColors | null
}): TalismanComputation | null {
  if (!canComputeTalisman(input.access)) return null

  const centre = resolveCentre({
    eokbu: input.charts.saju?.eokbu,
    deficiency: input.consensus?.elements.deficiency,
    dayElement: input.charts.saju?.pillars?.day.stem.element ?? null,
  })
  const raw = extractNativeFindings(input.charts)
  const seals = collectSeals(raw)
  const layers = subtractSealed(raw, seals)
  const purpose = purposeBundle(raw, {
    active: input.purpose ?? null,
    prismScores: input.charts.prism?.domainScores,
  })

  return {
    centre,
    layers,
    seals,
    purpose,
    fudan: fudanSpec(input.purpose ?? null),
    independence: independenceCensus(),
    prismColors: input.prismColors ?? null,
  }
}
