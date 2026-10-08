import type { CrisisSource } from './types'
import { emscSource } from './sources/emsc'
import { eonetSource } from './sources/eonet'
import { fewsnetSource } from './sources/fewsnet'
import { firmsSource } from './sources/firms'
import { gdacsSource } from './sources/gdacs'
import { glofasSource } from './sources/glofas'
import { informSource } from './sources/inform'
import { nhcJtwcSource } from './sources/nhc-jtwc'
import { openmeteoForecastSource } from './sources/openmeteo-forecast'
import { tsunamiSource } from './sources/tsunami'
import { usgsSource } from './sources/usgs'
import { volcanoSource } from './sources/volcano'

export const CRISIS_SOURCES: CrisisSource[] = [
  usgsSource,
  emscSource,
  gdacsSource,
  eonetSource,
  nhcJtwcSource,
  tsunamiSource,
  volcanoSource,
  firmsSource,
  openmeteoForecastSource,
  glofasSource,
  fewsnetSource,
  informSource,
]

export function sourceByKey(key: string): CrisisSource | undefined {
  return CRISIS_SOURCES.find((source) => source.key === key)
}
