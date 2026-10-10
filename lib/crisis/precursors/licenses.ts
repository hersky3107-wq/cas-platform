/**
 * Probe notes for earthquake and volcano precursors (2026-10-10).
 * Status "used" means the feed is fetched or read from data we already store.
 * Status "skipped" means the source stays in the registry and does not fail the sweep.
 */
export interface PrecursorLicense {
  source: string
  license: string
  terms: string
  status: 'used' | 'skipped'
}

export const PRECURSOR_LICENSES: PrecursorLicense[] = [
  {
    source: 'USGS ComCat (M2.5+ catalog and OAF forecast.json)',
    license: 'US government public domain',
    terms: 'No use restriction. Cite USGS Earthquake Hazards Program.',
    status: 'used',
  },
  {
    source: 'EMSC / CSEM Seismic Portal',
    license: 'existing ingest',
    terms: 'No new EMSC endpoint. Recent events already stored by the emsc source are included in the 7-day count.',
    status: 'used',
  },
  {
    source: 'PB2002 plate boundaries (fraxen/tectonicplates GeoJSON)',
    license: 'Open Data Commons Attribution License 1.0',
    terms: 'Cite Peter Bird, Geochem. Geophys. Geosyst. 4(3), 1027, 2003, and Hugo Ahlenius / Nordpil.',
    status: 'used',
  },
  {
    source: 'Natural Earth 110m coastline',
    license: 'public domain',
    terms: 'naturalearthdata.com. Used only to mark a region as coastal for the tsunami cascade.',
    status: 'used',
  },
  {
    source: 'GEM Global Seismic Hazard Map',
    license: 'CC BY-NC-SA 4.0 (hazard grid)',
    terms: 'The downloadable grid is non-commercial. Not used. Hazard zone is distance to the PB2002 boundary.',
    status: 'skipped',
  },
  {
    source: 'Nevada Geodetic Laboratory GNSS',
    license: 'not fetched',
    terms: 'geodesy.unr.edu daily holdings timed out, and the full station series is too heavy for this sweep.',
    status: 'skipped',
  },
  {
    source: 'Smithsonian GVP Holocene volcano WFS',
    license: 'open WFS, attribution',
    terms: 'Cite the Global Volcanism Program, Smithsonian Institution. GetFeature returned the Holocene volcano layer (about 1,200 points).',
    status: 'used',
  },
  {
    source: 'Smithsonian GVP weekly activity report',
    license: 'not fetched',
    terms: 'volcano.si.edu weekly RSS and the reports page returned HTTP 403.',
    status: 'skipped',
  },
  {
    source: 'USGS HANS volcano alert levels',
    license: 'US government public domain',
    terms: 'Existing elevated-volcano feed. Alert rises already stored as volcano_unrest are a precursor.',
    status: 'used',
  },
  {
    source: 'NOAA Washington VAAC ash advisories',
    license: 'US government public domain',
    terms: 'IWXXM XML linked from the OSPO volcanic-ash messages page.',
    status: 'used',
  },
  {
    source: 'MIROVA thermal anomalies',
    license: 'not fetched',
    terms: 'mirovaweb.it NRT page has no open point or CSV feed. FIRMS hotspots on volcano coordinates are the fallback.',
    status: 'skipped',
  },
  {
    source: 'NASA FIRMS hotspots',
    license: 'existing ingest',
    terms: 'A hotspot already kept by the firms source within 15 km of a Holocene volcano counts as a thermal precursor.',
    status: 'used',
  },
  {
    source: 'Volcanic SO2',
    license: 'not fetched',
    terms: 'SACS last-notification URL returned HTTP 404. No open daily point file. Earthdata SO2 grids were not pulled.',
    status: 'skipped',
  },
]
