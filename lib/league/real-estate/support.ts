/**
 * Which housing indexes can open a new round.
 * Australia’s RPPI (ABS 6416.0) ceased with the December quarter 2021 issue.
 * ABS Total Value of Dwellings still prints median prices and dwelling-stock
 * value. That is not the discontinued index, so Australia stays closed.
 */

import type { PropertyRegion } from '../gateway/adapters/real-estate-regions'

export const AU_RPPI_CEASED = 'December quarter 2021'

export function propertyIndexOpen(region: Pick<PropertyRegion, 'country' | 'tier'>): boolean {
  return region.country !== 'AU'
}

export function housingIndexMetric(metric: string): 'apt_sale' | 'apt_jeonse' | 'hpi' | 'fhfa' | null {
  if (metric.startsWith('apt_jeonse')) return 'apt_jeonse'
  if (metric.startsWith('apt_sale')) return 'apt_sale'
  if (metric.startsWith('hpi_')) return metric.includes('fhfa') ? 'fhfa' : 'hpi'
  return null
}

/** Stored series family. FHFA instruments use the fhfa family even though the token is hpi_qoq. */
export function storedIndexMetric(regionTier: PropertyRegion['tier'], metric: string): string | null {
  if (regionTier === 'fhfa') return 'fhfa'
  return housingIndexMetric(metric)
}
