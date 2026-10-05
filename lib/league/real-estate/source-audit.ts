/**
 * What each housing publisher can grade.
 * lastSuccessfulFetch stays null until a backfill records a row.
 * Do not invent a timestamp.
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
  auth: string
  license: string
  lastSuccessfulFetch: null
  packet: 'official-index' | 'search-based' | 'unsupported'
  grading: 'housing_index' | 'operator_manual' | 'unsupported'
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
      const mode = modeFor(sample)
      rows.push({
        country,
        publisher,
        series: sample.seriesEn,
        metric: sample.metric,
        cadence: sample.cadence,
        pubRule: sample.pubRule,
        lagMonths: sample.lagMonths,
        regionCount: group.length,
        auth: mode.auth,
        license: mode.license,
        lastSuccessfulFetch: null,
        packet: mode.packet,
        grading: mode.grading,
      })
    }
  }
  return rows
}

function modeFor(region: PropertyRegion): Pick<PropertySourceRow, 'auth' | 'license' | 'packet' | 'grading'> {
  if (region.country === 'AU') {
    return {
      auth: 'no client — ABS 6416.0 ceased after December quarter 2021',
      license: 'ABS Total Value of Dwellings is free but is a median price and dwelling-stock value, not the discontinued index',
      packet: 'unsupported',
      grading: 'unsupported',
    }
  }
  if (region.tier === 'zillow') {
    return {
      auth: 'no official client',
      license: 'Zillow ZHVI is a private modeled index',
      packet: 'search-based',
      grading: 'operator_manual',
    }
  }
  if (region.country === 'US') {
    return {
      auth: 'FRED_API_KEY',
      license: 'FRED API terms; Case-Shiller and FHFA copyright stays with the series owner',
      packet: 'official-index',
      grading: 'housing_index',
    }
  }
  if (region.country === 'UK') {
    return {
      auth: 'no key — public CSV',
      license: 'Open Government Licence v3.0',
      packet: 'official-index',
      grading: 'housing_index',
    }
  }
  if (region.country === 'KR') {
    return {
      auth: 'RONE_API_KEY',
      license: '한국부동산원 R-ONE Open API, free, 이용허락범위 제한 없음 on data.go.kr 15134761',
      packet: 'official-index',
      grading: 'housing_index',
    }
  }
  return {
    auth: 'MLIT workbook 001473668; ESTAT_HOUSING_STATS_DATA_ID overrides',
    license: 'MLIT 不動産価格指数（住宅） NSA 住宅総合. e-Stat has no table for this index.',
    packet: 'official-index',
    grading: 'housing_index',
  }
}
