export interface ExtraLicense {
  status: 'used' | 'skipped'
  source: string
  license: string
  terms: string
}

export const EXTRA_LICENSES: ExtraLicense[] = [
  {
    status: 'skipped',
    source: 'NASA LHASA global landslide nowcast',
    license: 'NASA / US government, public domain',
    terms: 'The published nowcast is a global 1 km daily grid at GES DISC. There is no point feed, and the raster is too heavy for this sweep.',
  },
  {
    status: 'used',
    source: 'WHO Disease Outbreak News',
    license: 'WHO copyright, free reuse with attribution',
    terms: 'OData feed of recent outbreak reports. Cite WHO Disease Outbreak News. Disease name and country only; the narrative is not stored.',
  },
  {
    status: 'skipped',
    source: 'ProMED',
    license: 'ISID / ProMED, not an open outbreak feed',
    terms: 'promedmail.org is up, but /api/alerts is missing and the public posts API is a blog. No outbreak feed is pulled.',
  },
  {
    status: 'skipped',
    source: 'FAO Locust Watch situation',
    license: 'FAO, typically CC BY-NC-SA when a dataset is published',
    terms: 'Locust Hub search returned no situation layer, and the current-situation page answered 404. Country levels are not ingested.',
  },
  {
    status: 'used',
    source: 'NOAA SWPC 3-day geomagnetic forecast',
    license: 'US government public domain',
    terms: 'Text forecast from services.swpc.noaa.gov. Cite NOAA Space Weather Prediction Center. A G3 or higher forecast is global context and a high-latitude trigger.',
  },
  {
    status: 'used',
    source: 'UCDP GED candidate events 26.0.8',
    license: 'Uppsala Conflict Data Program, free with attribution',
    terms: 'Header x-ucdp-access-token. 5,000 requests per day, reset at midnight UTC. Cite UCDP. Geolocated events with deaths only. Group and target names are not stored.',
  },
]
