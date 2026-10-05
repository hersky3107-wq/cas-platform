/**
 * Admin-grade line for a housing round. Values come from stored first prints
 * when the caller has them. The line never invents a number.
 */

import { decodePropertyInstrument, publicationYmd } from '../gateway/adapters/real-estate-catalog'
import { ESTAT_PAGE, FRED_SERIES_PAGE, fredSeriesForRegion, RONE_MONTHLY_STATBL, RONE_PORTAL, UK_HPI_PAGE } from './clients'
import { priorPeriod } from './vintage'

export type HousingEvidencePrint = { refPeriod: string; value: number; firstPublishedAt?: string | null }

export function housingEvidenceFromInstrument(
  instrument: string,
  prints: readonly HousingEvidencePrint[] = [],
): string | null {
  const parts = decodePropertyInstrument(instrument)
  if (!parts || parts.region.country === 'AU' || parts.region.tier === 'zillow') return null
  const series = seriesLabel(parts.region.country, parts.region.code, parts.region.tier)
  const release = publicationYmd(parts.region, parts.refMonth)
  const prior = priorPeriod(parts.refMonth, parts.region.cadence)
  const current = prints.find((row) => row.refPeriod === parts.refMonth)
  const previous = prior ? prints.find((row) => row.refPeriod === prior) : undefined
  const bits = [
    `source ${sourceName(parts.region.country)}`,
    `series ${series.id}`,
    `region ${parts.regionCode}`,
    `ref ${parts.refMonth}`,
    `release ${release}`,
  ]
  if (current) {
    bits.push(`value ${current.value}`)
    if (current.firstPublishedAt) bits.push(`first ${current.firstPublishedAt.slice(0, 10)}`)
  } else {
    bits.push('referenced print not stored')
  }
  if (previous) bits.push(`prior ${previous.refPeriod} ${previous.value}`)
  else if (prior) bits.push(`prior ${prior} not stored`)
  bits.push(series.url)
  return bits.join(' · ').slice(0, 500)
}

function sourceName(country: string): string {
  if (country === 'US') return 'FRED'
  if (country === 'UK') return 'UK HPI'
  if (country === 'KR') return 'R-ONE'
  if (country === 'JP') return 'e-Stat'
  return country
}

function seriesLabel(
  country: string,
  code: string,
  tier: 'official' | 'fhfa' | 'zillow',
): { id: string; url: string } {
  if (country === 'US') {
    const id = fredSeriesForRegion({ country: 'US', code, tier }) ?? code
    return { id, url: FRED_SERIES_PAGE(id) }
  }
  if (country === 'UK') return { id: 'UK-HPI', url: UK_HPI_PAGE }
  if (country === 'KR') return { id: RONE_MONTHLY_STATBL, url: RONE_PORTAL }
  return { id: '不動産価格指数（住宅）', url: ESTAT_PAGE }
}
