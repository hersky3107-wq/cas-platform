import 'server-only'

import type { OfficialOutcomeResolution } from '@/lib/prediction/grading-core'
import { decodePropertyInstrument } from '../gateway/adapters/real-estate-catalog'
import { housingEvidenceFromInstrument } from './evidence'
import { decideHousingGrade, housingGradeToOfficial } from './grade'
import { loadHousingForPacket } from './load.server'
import { storedIndexMetric } from './support'
import { readFirstPrints } from './store.server'
import { priorPeriod } from './vintage'

export async function gradeHousingInstrument(
  instrument: string,
  now = new Date(),
): Promise<OfficialOutcomeResolution | null> {
  const parts = decodePropertyInstrument(instrument)
  if (!parts) return null
  if (parts.region.country === 'AU' || parts.region.tier === 'zillow') return null
  const metric = storedIndexMetric(parts.region.tier, parts.metric)
  if (!metric || metric === 'apt_jeonse') return null
  let prints = await readFirstPrints(parts.country, parts.regionCode, metric).catch(() => [])
  const prior = priorPeriod(parts.refMonth, parts.region.cadence)
  const hasCurrent = prints.some((row) => row.refPeriod === parts.refMonth)
  if (!hasCurrent) {
    await loadHousingForPacket(parts).catch(() => null)
    prints = await readFirstPrints(parts.country, parts.regionCode, metric).catch(() => prints)
  }
  const current = prints.find((row) => row.refPeriod === parts.refMonth) ?? null
  const previous = prior ? prints.find((row) => row.refPeriod === prior) ?? null : null
  const evidence = housingEvidenceFromInstrument(
    instrument,
    prints.map((row) => ({ refPeriod: row.refPeriod, value: row.value, firstPublishedAt: row.firstPublishedAt })),
  ) ?? instrument
  const decision = decideHousingGrade({
    current: current?.value ?? null,
    prior: previous?.value ?? null,
    thresholdBp: parts.thresholdBp,
    nowMs: now.getTime(),
    expectedReleaseMs: parts.resolvesAtMs,
    evidence,
  })
  return housingGradeToOfficial(decision, {
    current: current?.value ?? null,
    prior: previous?.value ?? null,
    refPeriod: parts.refMonth,
    seenAt: current?.firstPublishedAt ?? now.toISOString(),
  })
}
