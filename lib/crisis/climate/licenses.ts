export interface ClimateLicense {
  status: 'used' | 'skipped'
  source: string
  license: string
  terms: string
}

export const CLIMATE_LICENSES: ClimateLicense[] = [
  {
    status: 'used',
    source: 'Open-Meteo forecast (16-day daily)',
    license: 'CC BY 4.0',
    terms: 'Free non-commercial API, under 10,000 calls/day. Cite Open-Meteo.com. Forecast models include DWD, NOAA, and ECMWF under their own open terms.',
  },
  {
    status: 'used',
    source: 'Open-Meteo historical archive (ERA5)',
    license: 'CC BY 4.0 via Open-Meteo; ERA5 is Copernicus C3S',
    terms: 'Daily max/min, humidity, precipitation, and soil moisture. Cite Open-Meteo and ECMWF ERA5 / Copernicus Climate Change Service. Batched at 200 locations per sweep after the forecast reservation.',
  },
  {
    status: 'used',
    source: 'NOAA CPC ENSO',
    license: 'US government public domain',
    terms: 'Existing enso source. An El Niño or La Niña advisory is one drought factor, not a trigger by itself.',
  },
  {
    status: 'skipped',
    source: 'Copernicus GDO/EDO Combined Drought Indicator',
    license: 'Copernicus EMS, free full and open access under Regulation (EU) 2021/696',
    terms: 'The CDI coverage (cdiad) is a Europe WCS raster, not a point file. A global grid download is too heavy for this sweep. Drought uses ERA5 rainfall deficit, soil moisture, and ENSO instead.',
  },
  {
    status: 'skipped',
    source: 'Elderly population share',
    license: 'not in the region table',
    terms: 'No open elderly-share column is stored per region. Heat and cold fragility uses internet-outage history and active conflict or advisory instead.',
  },
]
