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
  TalismanPrismColors,
  NativeFindings,
  SealTarget,
  FudanSpec,
  PurposeBundle,
  CentreMode,
  CentreSource,
  CentreIntensity,
  IndependenceCensus,
} from './types'

export { canComputeTalisman } from './access'
export { resolveCentre, pickDeficiencyLeader, centrePathLabel } from './centre'
export { describeCentre, describeCentreFromDeficiency, ELEMENT_KO } from './copy'
export { extractNativeFindings } from './native'
export { collectSeals, subtractSealed } from './seals'
export { purposeBundle, fudanSpec } from './purpose'
export { computeTalisman } from './compute'
export { talismanSerial, talismanSerialFromEnv, FAKE_TALISMAN_SERIAL } from './serial'
export {
  TALISMAN_HANJA,
  TALISMAN_GLYPHS,
  TALISMAN_GLYPH_FONT,
  TALISMAN_GLYPH_VERSION,
  TALISMAN_GLYPH_LICENCE,
  talismanGlyph,
} from './glyphs'
export { composeBindrune, bindruneCenterY, mergeSegments, stoneSegments } from './bindrune'
export type { BindruneStone } from './bindrune'
export { resolveSecondary, absentFromPillars, SAJU_ABSENT_ORDER } from './secondary'
export type { TalismanSecondary } from './secondary'
export { chartsFromComputations } from './charts'
export type { ArrivalReport, FieldArrival, ComputationRow } from './charts'
export { talismanFromStoredSession } from './from-session'
export type { TalismanSessionResult } from './from-session'
export {
  canDownloadTalismanFormat,
  formatTalismanReadingDate,
  parseTalismanBuyPurpose,
  shouldShowFreePhoneHint,
  talismanPriceFor,
} from './entitlement'
export type { TalismanBuyPurpose } from './entitlement'
export { isIntegratedTalismanSource } from './source-session'
export { purchaseTalismanUnlock } from './purchase'
export type { PurchaseTalismanResult } from './purchase'
