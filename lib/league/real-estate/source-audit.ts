/**
 * What the housing catalog can actually grade today.
 * There is no live index client (no R-ONE, FRED, UK HPI, MLIT, or ABS fetch),
 * so lastSuccessfulFetch stays null. Do not invent a timestamp.
 */

import { PROPERTY_REGIONS, type PropertyCountry, type PropertyRegion } from '../gateway/adapters/real-estate-regions'

export type PropertySourceRow = {
  country: PropertyCountry
  publisher: string
  series: string
  metric: PropertyRegion['metric']
  cadence: PropertyRegion['cadence']
  pubRule: PropertyRegion['pubRule']
  lagMonths: number
  regionCount: number
  auth: 'no dedicated fetch client'
  lastSuccessfulFetch: null
  packet: 'search-based'
  grading: 'operator_manual'
}

const COUNTRIES: readonly PropertyCountry[] = ['KR', 'US', 'UK', 'JP', 'AU']

export function propertySourceAudit(regions: readonly PropertyRegion[] = PROPERTY_REGIONS): PropertySourceRow[] {
  const rows: PropertySourceRow[] = []
  for (const country of COUNTRIES) {
    const mine = regions.filter((region) => region.country === country)
    const publishers = [...new Set(mine.map((region) => region.publisherKo))]
    for (const publisher of publishers) {
      const group = mine.filter((region) => region.publisherKo === publisher)
      const sample = group[0]
      if (!sample) continue
      rows.push({
        country,
        publisher,
        series: sample.seriesEn,
        metric: sample.metric,
        cadence: sample.cadence,
        pubRule: sample.pubRule,
        lagMonths: sample.lagMonths,
        regionCount: group.length,
        auth: 'no dedicated fetch client',
        lastSuccessfulFetch: null,
        packet: 'search-based',
        grading: 'operator_manual',
      })
    }
  }
  return rows
}
