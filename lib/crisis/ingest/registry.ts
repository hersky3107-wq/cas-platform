import type { CrisisSource } from './types'
import { advisoriesSource } from './sources/advisories'
import { emscSource } from './sources/emsc'
import { eonetSource } from './sources/eonet'
import { fewsnetSource } from './sources/fewsnet'
import { firmsSource } from './sources/firms'
import { gdacsSource } from './sources/gdacs'
import { gdeltEventsSource } from './sources/gdelt'
import { glofasSource } from './sources/glofas'
import { informSource } from './sources/inform'
import { iodaSource } from './sources/ioda'
import { ensoSource } from './sources/enso'
import { jtwcTcfaSource } from './sources/jtwc-tcfa'
import { nhcJtwcSource } from './sources/nhc-jtwc'
import { nhcOutlookSource } from './sources/nhc-outlook'
import { openmeteoForecastSource } from './sources/openmeteo-forecast'
import { tsunamiSource } from './sources/tsunami'
import { usgsSource } from './sources/usgs'
import { volcanoSource } from './sources/volcano'
import { volcanoUnrestSource } from './sources/volcano-unrest'
import { wikiTopSource } from './sources/wiki-top'

export const CRISIS_SOURCES: CrisisSource[] = [
  usgsSource,
  emscSource,
  gdacsSource,
  eonetSource,
  nhcJtwcSource,
  nhcOutlookSource,
  jtwcTcfaSource,
  ensoSource,
  tsunamiSource,
  volcanoSource,
  volcanoUnrestSource,
  firmsSource,
  openmeteoForecastSource,
  glofasSource,
  fewsnetSource,
  informSource,
  iodaSource,
  gdeltEventsSource,
  wikiTopSource,
  advisoriesSource,
]

export function sourceByKey(key: string): CrisisSource | undefined {
  return CRISIS_SOURCES.find((source) => source.key === key)
}
