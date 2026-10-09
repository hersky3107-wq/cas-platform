import { finite } from '../score/math'
import { mollweideToWgs84 } from './mollweide'

export const GHS_SOURCE = 'ghs_ucdb_r2024a_v1_2'
export const GHS_LICENSE = 'CC BY 4.0'
export const GHS_YEAR = 2025
export const GHS_PAGE = 'https://human-settlement.emergency.copernicus.eu/ghs_ucdb_2024.php'
export const GHS_GENERAL_ZIP =
  'https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_UCDB_GLOBE_R2024A/GHS_UCDB_THEME_GLOBE_R2024A/GHS_UCDB_THEME_GENERAL_CHARACTERISTICS_GLOBE_R2024A/V1-2/GHS_UCDB_THEME_GENERAL_CHARACTERISTICS_GLOBE_R2024A_V1_2.zip'
export const GHS_GENERAL_CSV = 'GHS_UCDB_THEME_GENERAL_CHARACTERISTICS_GLOBE_R2024A.csv'
export const GHS_GENERAL_GPKG = 'GHS_UCDB_THEME_GENERAL_CHARACTERISTICS_GLOBE_R2024A.gpkg'

export interface UrbanCentreRow {
  id: string
  name: string
  country_name: string
  pop: number
  lat: number
  lon: number
}

export function normalizeGhsCentre(
  row: Record<string, unknown>,
  xy: { x: number; y: number } | null,
): UrbanCentreRow | null {
  const id = String(row.ID_UC_G0 ?? '').trim()
  const name = String(row.GC_UCN_MAI_2025 ?? '').trim()
  const country = String(row.GC_CNT_GAD_2025 ?? '').trim()
  const pop = finite(row.GC_POP_TOT_2025)
  if (!id || !name || pop == null || pop <= 0) return null
  const wgs = xy ? mollweideToWgs84(xy.x, xy.y) : null
  if (!wgs) return null
  return { id, name, country_name: country, pop, lat: wgs.lat, lon: wgs.lon }
}

export interface RegionPop {
  region_id: number
  urban_pop: number
  urban_centres: number
  top5: Array<{ name: string; pop: number; lat: number; lon: number }>
}

export function aggregateUrbanPop(
  rows: Array<UrbanCentreRow & { region_id: number }>,
): RegionPop[] {
  const bags = new Map<number, UrbanCentreRow[]>()
  for (const row of rows) {
    const list = bags.get(row.region_id) ?? []
    list.push(row)
    bags.set(row.region_id, list)
  }
  const out: RegionPop[] = []
  for (const [region_id, list] of bags) {
    list.sort((a, b) => b.pop - a.pop)
    out.push({
      region_id,
      urban_pop: list.reduce((acc, row) => acc + row.pop, 0),
      urban_centres: list.length,
      top5: list.slice(0, 5).map((row) => ({ name: row.name, pop: row.pop, lat: row.lat, lon: row.lon })),
    })
  }
  return out
}
