export interface TriggerComponent {
  key: string
  department: string
  value: number
  raw: Record<string, unknown>
}

export interface FragilityItem {
  kind: string
  name: string
  lat: number | null
  lon: number | null
  weight: number
  attributes: Record<string, unknown>
}

export interface CascadeWatch {
  id: string
  trigger_type: string
  effect_type: string
  lag_min_days: number
  lag_max_days: number
  evidence_level: string
}

export interface UrbanCentre {
  name: string
  pop: number
  lat: number
  lon: number
}

export interface RelatedSignal {
  source: string
  title: string | null
  url: string | null
  event_time: string | null
}

export interface RegionScore {
  region_id: number
  name: string
  country: string
  iso3: string | null
  score: number
  raw_score: number
  stage: number
  trigger: number
  fragility: number
  people_norm: number
  urban_pop: number
  components: TriggerComponent[]
  departments: string[]
  fragility_items: FragilityItem[]
  cascades: CascadeWatch[]
  urban_centres: UrbanCentre[]
  bonus: { compound: number; cascade: number }
  context: string[]
}

export interface AnomalyCard {
  region: string
  country: string
  iso3: string | null
  stage: number
  score: number
  components: Array<{ key: string; value: number; raw: Record<string, unknown> }>
  fragility: Array<{ kind: string; name: string }>
  urban: Array<{ name: string; pop: number }>
  cascades: Array<{ id: string; effect: string; lag: string; evidence: string }>
  signals: RelatedSignal[]
  context: string[]
}

export interface QuakeEvent {
  lat: number
  lon: number
  mag: number
  source: string
  event_time: string | null
}

export interface PointEvent {
  lat: number
  lon: number
  event_time: string | null
  alert?: string | null
  region_id?: number | null
  country_iso3?: string | null
}

export interface DamSite {
  name: string
  lat: number
  lon: number
  region_id: number | null
  height_m: number | null
  year_built: number | null
  kind?: 'dam' | 'levee'
}

export interface CampSite {
  name: string
  lat: number
  lon: number
  region_id: number | null
}

export interface PlantSite {
  name: string
  lat: number
  lon: number
  region_id: number | null
  kind?: 'nuclear_plant' | 'chemical_plant' | 'port'
}
