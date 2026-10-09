import { clamp, combineOr, haversineKm } from './math'
import { CAMP, DAM, INFORM, NUCLEAR } from './thresholds'
import type { CampSite, DamSite, FragilityItem, PlantSite, TriggerComponent } from './types'

export function damWeight(heightM: number | null, yearBuilt: number | null, nowYear: number): number {
  const height = heightM != null && heightM > 0 ? clamp(heightM / DAM.heightRefM) : 0.25
  const age = yearBuilt != null && yearBuilt > 1800
    ? clamp((nowYear - yearBuilt) / DAM.ageRefYears)
    : DAM.unknownAge
  return clamp(DAM.base + DAM.heightWeight * height + DAM.ageWeight * age)
}

export function damsNear(
  lat: number,
  lon: number,
  regionId: number,
  dams: DamSite[],
  nowYear: number,
): FragilityItem[] {
  const items: FragilityItem[] = []
  for (const dam of dams) {
    const km = haversineKm(lat, lon, dam.lat, dam.lon)
    if (dam.region_id !== regionId && km > DAM.nearKm) continue
    items.push({
      kind: 'dam',
      name: dam.name,
      lat: dam.lat,
      lon: dam.lon,
      weight: damWeight(dam.height_m, dam.year_built, nowYear),
      attributes: { height_m: dam.height_m, year_built: dam.year_built, km, in_region: dam.region_id === regionId },
    })
  }
  return items.sort((a, b) => b.weight - a.weight)
}

export function campBucket(count: number): number {
  if (count <= 0) return 0
  if (count <= CAMP.smallMax) return CAMP.small
  if (count <= CAMP.mediumMax) return CAMP.medium
  return CAMP.large
}

export function campsInRegion(regionId: number, camps: CampSite[]): { value: number; items: FragilityItem[]; count: number } {
  const here = camps.filter((camp) => camp.region_id === regionId)
  const value = campBucket(here.length)
  return {
    value,
    count: here.length,
    items: here.slice(0, 5).map((camp) => ({
      kind: 'refugee_camp',
      name: camp.name,
      lat: camp.lat,
      lon: camp.lon,
      weight: value,
      attributes: { bucket: value, count: here.length },
    })),
  }
}

export function nuclearNear(
  lat: number,
  lon: number,
  regionId: number,
  plants: PlantSite[],
  components: TriggerComponent[],
): FragilityItem[] {
  const floodOrQuake = components.some((row) => (row.key === 'quake' || row.key === 'rain' || row.key === 'river') && row.value > 0)
  if (!floodOrQuake) return []
  const items: FragilityItem[] = []
  for (const plant of plants) {
    const km = haversineKm(lat, lon, plant.lat, plant.lon)
    if (plant.region_id !== regionId && km > NUCLEAR.nearKm) continue
    items.push({
      kind: 'nuclear_plant',
      name: plant.name,
      lat: plant.lat,
      lon: plant.lon,
      weight: NUCLEAR.value,
      attributes: { km, in_region: plant.region_id === regionId },
    })
  }
  return items
}

export function informFragility(vulnerability: number | null, coping: number | null): number {
  const vuln = vulnerability != null ? clamp(vulnerability / INFORM.scale) : 0
  const lack = coping != null ? clamp(coping / INFORM.scale) : 0
  return clamp(INFORM.fragilityCap * (0.5 * vuln + 0.5 * lack), 0, INFORM.fragilityCap)
}

export function regionHasDam(regionId: number, dams: DamSite[]): boolean {
  return dams.some((dam) => dam.region_id === regionId)
}

export function upstreamDamAdd(
  neighborIds: number[],
  neighborTriggers: Map<number, TriggerComponent[]>,
  dams: DamSite[],
): number {
  for (const id of neighborIds) {
    const fired = neighborTriggers.get(id) ?? []
    const hydro = fired.some((row) => (row.key === 'rain' || row.key === 'river') && row.value > 0)
    if (hydro && regionHasDam(id, dams)) return DAM.upstreamAdd
  }
  return 0
}

export function combineFragility(parts: number[]): number {
  return clamp(parts.reduce((acc, value) => acc + value, 0))
}

export function fragilityFromItems(items: FragilityItem[], extra: number[]): number {
  const damOr = combineOr(items.filter((item) => item.kind === 'dam').map((item) => item.weight))
  const camps = items.find((item) => item.kind === 'refugee_camp')?.weight ?? 0
  const nuclear = items.some((item) => item.kind === 'nuclear_plant') ? NUCLEAR.value : 0
  return combineFragility([damOr, camps, nuclear, ...extra])
}
