import 'server-only'

import type { PropertyParts } from '../gateway/adapters/real-estate-catalog'
import type { HousingPacketFacts } from './packet-index'
import {
  ESTAT_PAGE,
  FRED_CONTEXT_SERIES,
  FRED_SERIES_PAGE,
  RONE_MONTHLY_STATBL,
  RONE_PORTAL,
  UK_HPI_PAGE,
  fetchEstatHousing,
  fetchFredSeries,
  fetchRoneRegion,
  fetchUkHpi,
  fredSeriesForRegion,
  pointsForArea,
} from './clients'
import { storedIndexMetric } from './support'
import { readFirstPrints, writeHousingPrints } from './store.server'

export async function loadHousingForPacket(parts: PropertyParts): Promise<HousingPacketFacts | null> {
  if (parts.region.country === 'AU' || parts.region.tier === 'zillow') return null
  const metric = storedIndexMetric(parts.region.tier, parts.metric)
  if (!metric || metric === 'apt_jeonse') return null
  const seenAt = new Date().toISOString()
  let levels = await readFirstPrints(parts.country, parts.regionCode, metric).catch(() => [])
  if (levels.length < 2) {
    const fetched = await fetchRegion(parts)
    if (fetched?.ok) {
      await writeHousingPrints({
        country: parts.country,
        regionCode: parts.regionCode,
        metric,
        seriesId: fetched.seriesId,
        source: fetched.source,
        sourceUrl: fetched.sourceUrl,
        points: fetched.points,
        seenAt,
      }).catch(() => undefined)
      levels = await readFirstPrints(parts.country, parts.regionCode, metric).catch(() => levels)
    } else if (levels.length === 0) {
      return {
        source: sourceLabel(parts),
        seriesId: seriesLabel(parts),
        sourceUrl: sourceUrl(parts),
        levels: [],
        note: fetched && !fetched.ok ? fetched.error : 'Official index is not in the store yet.',
      }
    }
  }
  const national = await nationalLevels(parts)
  return {
    source: levels[0]?.source ?? sourceLabel(parts),
    seriesId: levels[0]?.seriesId ?? seriesLabel(parts),
    sourceUrl: levels[0]?.sourceUrl ?? sourceUrl(parts),
    levels: levels.map((row) => ({ refPeriod: row.refPeriod, value: row.value })),
    national,
  }
}

async function fetchRegion(parts: PropertyParts) {
  if (parts.country === 'US') {
    const seriesId = fredSeriesForRegion(parts.region)
    if (!seriesId) return { ok: false as const, error: 'no FRED series for this region' }
    return fetchFredSeries(seriesId, process.env.FRED_API_KEY)
  }
  if (parts.country === 'UK') {
    const file = await fetchUkHpi(new Date())
    if (!file.ok) return file
    const points = pointsForArea(file.points, parts.regionCode)
    if (points.length === 0) return { ok: false as const, error: `UK HPI has no rows for ${parts.regionCode}` }
    return { ...file, points }
  }
  if (parts.country === 'KR') {
    const statbl = process.env.RONE_APT_SALE_STATBL_ID?.trim() || RONE_MONTHLY_STATBL
    return fetchRoneRegion(parts.regionCode, process.env.RONE_API_KEY, fetch, new Date(), statbl)
  }
  if (parts.country === 'JP') {
    return fetchEstatHousing(parts.regionCode, process.env.ESTAT_APP_ID, process.env.ESTAT_HOUSING_STATS_DATA_ID)
  }
  return { ok: false as const, error: 'no official index client' }
}

async function nationalLevels(parts: PropertyParts): Promise<HousingPacketFacts['national']> {
  const spec = nationalSpec(parts)
  if (!spec) return null
  const rows = await readFirstPrints(spec.country, spec.regionCode, spec.metric).catch(() => [])
  if (rows.length < 2) return null
  return {
    seriesId: rows[0]?.seriesId ?? spec.regionCode,
    levels: rows.map((row) => ({ refPeriod: row.refPeriod, value: row.value })),
  }
}

function nationalSpec(parts: PropertyParts): { country: string; regionCode: string; metric: string } | null {
  if (parts.country === 'US' && parts.regionCode !== 'CSUSHPINSA') {
    return { country: 'US', regionCode: 'CSUSHPINSA', metric: 'hpi' }
  }
  if (parts.country === 'UK' && parts.regionCode !== 'K02000001') {
    return { country: 'UK', regionCode: 'K02000001', metric: 'hpi' }
  }
  if (parts.country === 'KR' && parts.regionCode !== 'NAT') {
    return { country: 'KR', regionCode: 'NAT', metric: 'apt_sale' }
  }
  if (parts.country === 'JP' && parts.regionCode !== 'NAT') {
    return { country: 'JP', regionCode: 'NAT', metric: 'hpi' }
  }
  return null
}

function sourceLabel(parts: PropertyParts): string {
  if (parts.country === 'US') return 'FRED'
  if (parts.country === 'UK') return 'UK HPI'
  if (parts.country === 'KR') return 'R-ONE'
  return 'e-Stat'
}

function seriesLabel(parts: PropertyParts): string {
  if (parts.country === 'US') return fredSeriesForRegion(parts.region) ?? parts.regionCode
  if (parts.country === 'KR') return process.env.RONE_APT_SALE_STATBL_ID?.trim() || RONE_MONTHLY_STATBL
  if (parts.country === 'JP') return process.env.ESTAT_HOUSING_STATS_DATA_ID?.trim() || '不動産価格指数（住宅）'
  return 'UK-HPI'
}

function sourceUrl(parts: PropertyParts): string {
  if (parts.country === 'US') return FRED_SERIES_PAGE(fredSeriesForRegion(parts.region) ?? parts.regionCode)
  if (parts.country === 'UK') return UK_HPI_PAGE
  if (parts.country === 'KR') return RONE_PORTAL
  return ESTAT_PAGE
}

export async function refreshHousingContextSeries(seenAt: string): Promise<void> {
  for (const seriesId of FRED_CONTEXT_SERIES) {
    const fetched = await fetchFredSeries(seriesId, process.env.FRED_API_KEY)
    if (!fetched.ok) continue
    await writeHousingPrints({
      country: 'US',
      regionCode: seriesId,
      metric: 'hpi',
      seriesId,
      source: 'FRED',
      sourceUrl: FRED_SERIES_PAGE(seriesId),
      points: fetched.points,
      seenAt,
    }).catch(() => undefined)
  }
}
