export const FRAGILITY_KINDS = [
  'dam',
  'levee',
  'glacial_lake',
  'refugee_camp',
  'nuclear_plant',
  'chemical_plant',
  'port',
  'power_plant',
  'other',
] as const

export type FragilityKind = (typeof FRAGILITY_KINDS)[number]

export interface FragilityEvidence {
  type: 'dataset' | 'paper' | 'news' | 'report'
  title: string
  url: string
  lang: string
  published_at: string | null
}

export interface FragilityPoint {
  kind: FragilityKind
  name: string
  lat: number
  lon: number
  attributes: Record<string, unknown>
  evidence: FragilityEvidence[]
  confidence: 'dataset' | 'candidate' | 'confirmed' | 'rejected'
  source: string
  source_license: string
}

export function roundCoord3(value: number): string {
  const sign = value < 0 ? -1 : 1
  const rounded = (sign * Math.round(Math.abs(value) * 1000)) / 1000
  return rounded.toFixed(3)
}

export function fragilityDedupeKey(source: string, name: string, lat: number, lon: number): string {
  return `${source}|${name}|${roundCoord3(lat)}|${roundCoord3(lon)}`
}

function finiteOrNull(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isFinite(n) || n <= -99) return null
  return n
}

function text(value: unknown): string {
  return value == null ? '' : String(value).trim()
}

export const GDW_SOURCE = 'global_dam_watch_v1'
export const GDW_LICENSE = 'CC BY 4.0'
export const GDW_DOWNLOAD = 'https://ndownloader.figshare.com/files/47913754'
export const GDW_PAGE = 'https://www.globaldamwatch.org/database'
export const GDW_PAPER = 'https://www.nature.com/articles/s41597-024-03752-9'
export const GDW_ZIP_ENTRY = 'GDW_v1_0_shp/GDW_barriers_v1_0.txt'

export const WRI_SOURCE = 'wri_global_power_plant_database_v1_3'
export const WRI_LICENSE = 'CC BY 4.0'
export const WRI_CSV =
  'https://raw.githubusercontent.com/wri/global-power-plant-database/master/output_database/global_power_plant_database.csv'
export const WRI_PAGE = 'https://github.com/wri/global-power-plant-database'

export const UNHCR_SOURCE = 'unhcr_poc_locations'
export const UNHCR_LICENSE = 'CC BY'
export const UNHCR_LICENSE_URL = 'http://www.opendefinition.org/licenses/cc-by'
export const UNHCR_HDX = 'https://data.humdata.org/dataset/unhcr-people-of-concern'
export const UNHCR_QUERY =
  'https://gis.unhcr.org/arcgis/rest/services/core_v2/wrl_prp_p_unhcr_PoC/FeatureServer/0/query'

const CAMP_SUBTYPES = new Set(['38', '39', '44'])

const CAMP_LABEL: Record<string, string> = {
  '38': 'Formal Settlement',
  '39': 'Informal Settlement',
  '44': 'Collective centre',
}

export function isLargeDam(heightM: number | null, capacityMcm: number | null, grandId: number | null): boolean {
  if (heightM != null && heightM >= 15) return true
  if (capacityMcm != null && capacityMcm >= 100) return true
  if (grandId != null && grandId > 0) return true
  return false
}

export function normalizeGdwBarrier(row: Record<string, unknown>): FragilityPoint | null {
  const height = finiteOrNull(row.DAM_HGT_M)
  const capacity = finiteOrNull(row.CAP_MCM)
  const grandId = finiteOrNull(row.GRAND_ID)
  if (!isLargeDam(height, capacity, grandId)) return null
  const lat = finiteOrNull(row.LAT_DAM) ?? finiteOrNull(row.LAT_RIV)
  const lon = finiteOrNull(row.LONG_DAM) ?? finiteOrNull(row.LONG_RIV)
  if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  const name = text(row.DAM_NAME) || text(row.RES_NAME)
  if (!name) return null
  return {
    kind: 'dam',
    name,
    lat,
    lon,
    attributes: {
      year_built: finiteOrNull(row.YEAR_DAM),
      height_m: height,
      capacity_mcm: capacity,
      river: text(row.RIVER) || null,
      country: text(row.COUNTRY) || null,
      grand_id: grandId,
      gdw_id: text(row.GDW_ID) || null,
      main_use: text(row.MAIN_USE) || null,
    },
    evidence: [
      {
        type: 'dataset',
        title: 'Global Dam Watch database version 1.0',
        url: GDW_PAGE,
        lang: 'en',
        published_at: '2024-09-17',
      },
    ],
    confidence: 'dataset',
    source: GDW_SOURCE,
    source_license: GDW_LICENSE,
  }
}

export function normalizeWriPlant(row: Record<string, unknown>): FragilityPoint | null {
  if (text(row.primary_fuel) !== 'Nuclear') return null
  const lat = finiteOrNull(row.latitude)
  const lon = finiteOrNull(row.longitude)
  const name = text(row.name)
  if (lat == null || lon == null || !name || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return {
    kind: 'nuclear_plant',
    name,
    lat,
    lon,
    attributes: {
      country: text(row.country_long) || text(row.country) || null,
      iso: text(row.country) || null,
      capacity_mw: finiteOrNull(row.capacity_mw),
      commissioning_year: finiteOrNull(row.commissioning_year),
      owner: text(row.owner) || null,
      gppd_idnr: text(row.gppd_idnr) || null,
      status: 'unspecified_in_source',
    },
    evidence: [
      {
        type: 'dataset',
        title: 'Global Power Plant Database v1.3.0',
        url: WRI_PAGE,
        lang: 'en',
        published_at: '2021-06-02',
      },
    ],
    confidence: 'dataset',
    source: WRI_SOURCE,
    source_license: WRI_LICENSE,
  }
}

export function normalizeUnhcrLocation(row: Record<string, unknown>): FragilityPoint | null {
  const subtype = text(row.loc_subtype)
  if (!CAMP_SUBTYPES.has(subtype)) return null
  const lat = finiteOrNull(row.latitude_d ?? row.latitude)
  const lon = finiteOrNull(row.longitude_d ?? row.longitude)
  const name = text(row.gis_name) || text(row.name)
  if (lat == null || lon == null || !name || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return {
    kind: 'refugee_camp',
    name,
    lat,
    lon,
    attributes: {
      country_iso3: text(row.iso3) || null,
      loc_subtype: subtype,
      loc_subtype_label: CAMP_LABEL[subtype] ?? null,
      pop_type: text(row.pop_type) || null,
      poc_subtype: text(row.poc_subtype) || null,
    },
    evidence: [
      {
        type: 'dataset',
        title: 'UNHCR locations of refugees, internally displaced and stateless people',
        url: UNHCR_HDX,
        lang: 'en',
        published_at: null,
      },
    ],
    confidence: 'dataset',
    source: UNHCR_SOURCE,
    source_license: UNHCR_LICENSE,
  }
}

export function dedupePoints(points: FragilityPoint[]): FragilityPoint[] {
  const seen = new Set<string>()
  const out: FragilityPoint[] = []
  for (const point of points) {
    const key = fragilityDedupeKey(point.source, point.name, point.lat, point.lon)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(point)
  }
  return out
}

export const SKIPPED_DATASETS = [
  {
    id: 'glacial_lakes',
    status: 'not available',
    detail:
      'ICIMOD HKH glacial-lake inventory (DOI 10.26066/RDS.35856) is marked Copyright and has no confirmed direct CSV or shapefile download. Zenodo record 15476013 is a Pakistan-only PlanetScope set, not the HKH-wide inventory. Skipped.',
  },
  {
    id: 'geonucleardata',
    status: 'later, license review needed',
    detail:
      'GeoNuclearData (github.com/cristianst85/GeoNuclearData) is ODbL/DbCL share-alike. Not loaded. Nuclear points come from WRI Global Power Plant Database, which has no operating / under construction / shutdown field.',
  },
  {
    id: 'osm_health_facilities',
    status: 'later, license review needed',
    detail: 'OpenStreetMap-derived health facility dumps (including healthsites.io) are ODbL share-alike. Not loaded.',
  },
] as const
