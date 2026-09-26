/**
 * 부적 calculation layer. Engines in, SVG-facing shape out. No drawing.
 */

export { TALISMAN_CALC_VERSION, TALISMAN_LAYER_KIND, FUDAN_GLYPH, FORM_ONLY_LAYERS, independenceCensus } from './types'
export type {
  TalismanComputation,
  TalismanCharts,
  TalismanCentre,
  TalismanAccessInput,
  TalismanPurpose,
  NativeFindings,
  SealTarget,
  FudanSpec,
  PurposeBundle,
  CentreMode,
  CentreSource,
  IndependenceCensus,
} from './types'

export { canComputeTalisman } from './access'
export { resolveCentre, pickDeficiencyLeader } from './centre'
export { describeCentre, describeCentreFromDeficiency, ELEMENT_KO } from './copy'
export { extractNativeFindings } from './native'
export { collectSeals, subtractSealed } from './seals'
export { purposeBundle, fudanSpec } from './purpose'

import { canComputeTalisman } from './access'
import { resolveCentre } from './centre'
import { extractNativeFindings } from './native'
import { collectSeals, subtractSealed } from './seals'
import { fudanSpec, purposeBundle } from './purpose'
import { independenceCensus } from './types'
import type { AxisConsensus } from '../axes/types'
import type { TalismanAccessInput, TalismanCharts, TalismanComputation, TalismanPurpose } from './types'

export function computeTalisman(input: {
  access: TalismanAccessInput
  charts: TalismanCharts
  consensus: Pick<AxisConsensus, 'elements'> | null
  purpose?: TalismanPurpose | null
}): TalismanComputation | null {
  if (!canComputeTalisman(input.access)) return null

  const centre = resolveCentre({
    eokbu: input.charts.saju?.eokbu,
    deficiency: input.consensus?.elements.deficiency,
  })
  const raw = extractNativeFindings(input.charts)
  const seals = collectSeals(input.charts, raw)
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
  }
}
