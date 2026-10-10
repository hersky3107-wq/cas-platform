import type { CrisisSource } from './types'
import { advisoriesSource } from './sources/advisories'
import { cloudflareRadarSource } from './sources/cloudflare-radar'
import { eiaSource } from './sources/eia'
import { emscSource } from './sources/emsc'
import { eonetSource } from './sources/eonet'
import { fewsnetSource } from './sources/fewsnet'
import { firmsSource } from './sources/firms'
import { gdacsSource } from './sources/gdacs'
import { gdeltEventsSource } from './sources/gdelt'
import { glofasSource } from './sources/glofas'
import { gnssNglSource, gvpWeeklySource, so2DailySource } from './sources/precursor-skips'
import { gvpHoloceneSource } from './sources/gvp-holocene'
import { informSource } from './sources/inform'
import { iodaSource } from './sources/ioda'
import { ensoSource } from './sources/enso'
import { jtwcTcfaSource } from './sources/jtwc-tcfa'
import { metaculusSource } from './sources/metaculus'
import { nasaImergSource } from './sources/nasa-imerg'
import { nhcJtwcSource } from './sources/nhc-jtwc'
import { nhcOutlookSource } from './sources/nhc-outlook'
import { openmeteoForecastSource } from './sources/openmeteo-forecast'
import { reliefwebSource } from './sources/reliefweb'
import { tsunamiSource } from './sources/tsunami'
import { usgsCatalogSource } from './sources/usgs-catalog'
import { usgsOafSource } from './sources/usgs-oaf'
import { usgsSource } from './sources/usgs'
import { vaacSource } from './sources/vaac'
import { volcanoSource } from './sources/volcano'
import { volcanoThermalSource } from './sources/volcano-thermal'
import { volcanoUnrestSource } from './sources/volcano-unrest'
import { wikiTopSource } from './sources/wiki-top'

export const CRISIS_SOURCES: CrisisSource[] = [
  usgsSource,
  usgsCatalogSource,
  usgsOafSource,
  emscSource,
  gdacsSource,
  eonetSource,
  nhcJtwcSource,
  nhcOutlookSource,
  jtwcTcfaSource,
  ensoSource,
  tsunamiSource,
  volcanoSource,
  gvpHoloceneSource,
  gvpWeeklySource,
  vaacSource,
  volcanoThermalSource,
  so2DailySource,
  gnssNglSource,
  volcanoUnrestSource,
  firmsSource,
  openmeteoForecastSource,
  glofasSource,
  fewsnetSource,
  informSource,
  iodaSource,
  cloudflareRadarSource,
  gdeltEventsSource,
  wikiTopSource,
  advisoriesSource,
  reliefwebSource,
  metaculusSource,
  eiaSource,
  nasaImergSource,
]

export function sourceByKey(key: string): CrisisSource | undefined {
  return CRISIS_SOURCES.find((source) => source.key === key)
}
