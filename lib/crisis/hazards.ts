/** CrisisWatch hazard registry — kinds, groups, default lead-time bands. Labels live in i18n/hazards.ts. */

export const LEAD_TIME_BANDS = [
  'hours_24_72',
  'days_3_7',
  'weeks_1_2',
  'weeks_2_6',
  'months_1_3',
  'unknown',
] as const

export type LeadTimeBand = (typeof LEAD_TIME_BANDS)[number]

export const HAZARD_GROUPS = [
  'natural_geo',
  'natural_water',
  'natural_weather',
  'natural_climate',
  'natural_bio',
  'natural_space',
  'human_tech',
  'conflict_terror',
  'socio_economic',
] as const

export type HazardGroupKey = (typeof HAZARD_GROUPS)[number]

export const HAZARD_KINDS = [
  'earthquake',
  'tsunami',
  'volcano',
  'landslide',
  'flood_rain',
  'river_flood',
  'glof',
  'cyclone',
  'heat',
  'cold',
  'drought',
  'wildfire',
  'epidemic',
  'locust',
  'animal_disease',
  'space_weather',
  'dam_failure',
  'industrial',
  'nuclear',
  'grid_failure',
  'food_crisis',
  'economic_shock',
  'conflict',
  'terror_risk',
  'unrest',
  'internet_shutdown',
  'travel_advisory',
  'gradual_worsening',
] as const

export type HazardKind = (typeof HAZARD_KINDS)[number]

export interface HazardRegistryEntry {
  key: HazardKind
  group: HazardGroupKey
  leadTimeBand: LeadTimeBand
}

export const HAZARD_REGISTRY: Record<HazardKind, HazardRegistryEntry> = {
  earthquake: { key: 'earthquake', group: 'natural_geo', leadTimeBand: 'hours_24_72' },
  tsunami: { key: 'tsunami', group: 'natural_geo', leadTimeBand: 'hours_24_72' },
  volcano: { key: 'volcano', group: 'natural_geo', leadTimeBand: 'weeks_1_2' },
  landslide: { key: 'landslide', group: 'natural_geo', leadTimeBand: 'days_3_7' },
  flood_rain: { key: 'flood_rain', group: 'natural_water', leadTimeBand: 'days_3_7' },
  river_flood: { key: 'river_flood', group: 'natural_water', leadTimeBand: 'days_3_7' },
  glof: { key: 'glof', group: 'natural_water', leadTimeBand: 'days_3_7' },
  cyclone: { key: 'cyclone', group: 'natural_weather', leadTimeBand: 'days_3_7' },
  heat: { key: 'heat', group: 'natural_weather', leadTimeBand: 'days_3_7' },
  cold: { key: 'cold', group: 'natural_weather', leadTimeBand: 'days_3_7' },
  drought: { key: 'drought', group: 'natural_climate', leadTimeBand: 'months_1_3' },
  wildfire: { key: 'wildfire', group: 'natural_climate', leadTimeBand: 'days_3_7' },
  epidemic: { key: 'epidemic', group: 'natural_bio', leadTimeBand: 'weeks_1_2' },
  locust: { key: 'locust', group: 'natural_bio', leadTimeBand: 'weeks_2_6' },
  animal_disease: { key: 'animal_disease', group: 'natural_bio', leadTimeBand: 'weeks_2_6' },
  space_weather: { key: 'space_weather', group: 'natural_space', leadTimeBand: 'hours_24_72' },
  dam_failure: { key: 'dam_failure', group: 'human_tech', leadTimeBand: 'hours_24_72' },
  industrial: { key: 'industrial', group: 'human_tech', leadTimeBand: 'hours_24_72' },
  nuclear: { key: 'nuclear', group: 'human_tech', leadTimeBand: 'hours_24_72' },
  grid_failure: { key: 'grid_failure', group: 'human_tech', leadTimeBand: 'hours_24_72' },
  food_crisis: { key: 'food_crisis', group: 'socio_economic', leadTimeBand: 'months_1_3' },
  economic_shock: { key: 'economic_shock', group: 'socio_economic', leadTimeBand: 'weeks_2_6' },
  conflict: { key: 'conflict', group: 'conflict_terror', leadTimeBand: 'days_3_7' },
  terror_risk: { key: 'terror_risk', group: 'conflict_terror', leadTimeBand: 'days_3_7' },
  unrest: { key: 'unrest', group: 'conflict_terror', leadTimeBand: 'days_3_7' },
  internet_shutdown: { key: 'internet_shutdown', group: 'socio_economic', leadTimeBand: 'hours_24_72' },
  travel_advisory: { key: 'travel_advisory', group: 'socio_economic', leadTimeBand: 'days_3_7' },
  gradual_worsening: { key: 'gradual_worsening', group: 'socio_economic', leadTimeBand: 'weeks_2_6' },
}

/** Layer-1 score component keys → registry kind. */
export const SCORE_TRIGGER_TO_KIND: Record<string, HazardKind> = {
  rain: 'flood_rain',
  river: 'river_flood',
  cyclone: 'cyclone',
  quake: 'earthquake',
  gdacs: 'cyclone',
  volcano: 'volcano',
  fire: 'wildfire',
  conflict: 'conflict',
  silence: 'gradual_worsening',
  internet: 'internet_shutdown',
  advisory: 'travel_advisory',
  food: 'food_crisis',
  health_attention: 'epidemic',
  escalation: 'conflict',
  slow_burn: 'gradual_worsening',
}

export function isHazardKind(value: string): value is HazardKind {
  return (HAZARD_KINDS as readonly string[]).includes(value)
}

export function hazardKindForScoreTrigger(triggerKey: string, raw?: Record<string, unknown>): HazardKind {
  const key = triggerKey.trim().toLowerCase()
  if (key === 'gdacs') {
    const eventType = typeof raw?.event_type === 'string' ? raw.event_type.toUpperCase() : ''
    if (eventType === 'EQ') return 'earthquake'
    if (eventType === 'TC') return 'cyclone'
    if (eventType === 'FL') return 'flood_rain'
    if (eventType === 'VO') return 'volcano'
    if (eventType === 'DR') return 'drought'
    if (eventType === 'WF') return 'wildfire'
    if (eventType === 'TS') return 'tsunami'
  }
  return SCORE_TRIGGER_TO_KIND[key] ?? 'gradual_worsening'
}

export type ExpectedWindow =
  | { type: 'relative_days'; min: number; max: number }
  | { type: 'relative_hours'; min: number; max: number }
  | { type: 'relative_months'; min: number; max: number }
  | { type: 'ongoing' }
  | { type: 'lead'; key: 'days_to_weeks' }
  | { type: 'band'; band: LeadTimeBand }

export function kindsByGroup(): Map<HazardGroupKey, HazardKind[]> {
  const map = new Map<HazardGroupKey, HazardKind[]>()
  for (const group of HAZARD_GROUPS) map.set(group, [])
  for (const entry of Object.values(HAZARD_REGISTRY)) {
    map.get(entry.group)!.push(entry.key)
  }
  return map
}
