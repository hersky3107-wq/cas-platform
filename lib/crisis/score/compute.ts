import { CASCADE_SEEDS } from '../knowledge/cascades.seed'
import { cascadeBonusApplies, matchCascades } from './cascades'
import {
  campBucket,
  campsInRegion,
  damsNear,
  diminish,
  informFragility,
  nuclearNear,
  regionHasDam,
} from './fragility'
import { clamp } from './math'
import { peopleNorm } from './people'
import {
  CAMP_TRIGGER_KEYS,
  COMPONENT_FAMILY,
  DAM_TRIGGER_KEYS,
  FRAGILITY_K,
  NUCLEAR_TRIGGER_KEYS,
  SCORE,
  STAGE_MIN,
} from './thresholds'
import { combineTrigger } from './trigger'
import type { CascadeWatch, FragilityItem, RegionScore, TriggerComponent, UrbanCentre } from './types'

function fired(components: TriggerComponent[], keys: readonly string[]): boolean {
  return components.some((row) => keys.includes(row.key) && row.value > 0)
}

export function stageFromScore(score: number): number {
  if (score >= STAGE_MIN[5]) return 5
  if (score >= STAGE_MIN[4]) return 4
  if (score >= STAGE_MIN[3]) return 3
  if (score >= STAGE_MIN[2]) return 2
  return 1
}

export function rawRiskScore(trigger: number, fragility: number, people: number): number {
  return 100 * trigger * (0.5 + 0.5 * clamp(fragility)) * (0.5 + 0.5 * clamp(people))
}

export function compoundBonus(components: TriggerComponent[]): number {
  const families = new Set<string>()
  for (const row of components) {
    if (row.value < SCORE.compoundMin) continue
    const family = COMPONENT_FAMILY[row.key]
    if (family) families.add(family)
  }
  if (families.size >= 2) return SCORE.compoundDepartments
  return 0
}

export function finalizeScore(opts: {
  region_id: number
  name: string
  country: string
  iso3: string | null
  urban_pop: number
  inform_exposure: number | null
  inform_vulnerability: number | null
  inform_coping: number | null
  components: TriggerComponent[]
  dam_items: FragilityItem[]
  camp_count: number
  nuclear_items: FragilityItem[]
  upstream_add: number
  urban_centres: UrbanCentre[]
  kinds: Set<string>
}): RegionScore {
  const trigger = combineTrigger(opts.components)
  const hydro = fired(opts.components, DAM_TRIGGER_KEYS)
  const campOn = fired(opts.components, CAMP_TRIGGER_KEYS)
  const nuclearOn = fired(opts.components, NUCLEAR_TRIGGER_KEYS)
  const damItems = hydro ? opts.dam_items : []
  const campCount = campOn ? opts.camp_count : 0
  const nuclearItems = nuclearOn ? opts.nuclear_items : []
  const upstream = hydro ? opts.upstream_add : 0
  const camps = campBucket(campCount)
  const inform = informFragility(opts.inform_vulnerability, opts.inform_coping)
  const weightSum =
    damItems.reduce((acc, item) => acc + item.weight, 0) +
    camps +
    (nuclearItems.length ? Math.max(...nuclearItems.map((item) => item.weight)) : 0) +
    upstream +
    inform
  const fragility = diminish(weightSum, FRAGILITY_K)
  const people = peopleNorm(opts.urban_pop, opts.inform_exposure)
  const watch = matchCascades({
    cascades: CASCADE_SEEDS,
    components: opts.components,
    kinds: opts.kinds,
    urbanPop: opts.urban_pop,
  })
  const compound = compoundBonus(opts.components)
  const cascade = cascadeBonusApplies(watch, opts.kinds, CASCADE_SEEDS) ? SCORE.cascadeBonus : 0
  const raw = rawRiskScore(trigger, fragility, people)
  const score = Math.min(SCORE.cap, raw + compound + cascade)
  const items = [
    ...damItems.slice(0, 5),
    ...(camps > 0
      ? [{
          kind: 'refugee_camp',
          name: `${campCount} camps`,
          lat: null,
          lon: null,
          weight: camps,
          attributes: { count: campCount, bucket: camps },
        } satisfies FragilityItem]
      : []),
    ...nuclearItems.slice(0, 2),
  ].sort((a, b) => b.weight - a.weight).slice(0, 5)

  return {
    region_id: opts.region_id,
    name: opts.name,
    country: opts.country,
    iso3: opts.iso3,
    score,
    raw_score: raw,
    stage: stageFromScore(score),
    trigger,
    fragility,
    people_norm: people,
    urban_pop: opts.urban_pop,
    components: opts.components.filter((row) => row.value > 0),
    departments: [...new Set(opts.components.filter((row) => row.value > 0).map((row) => row.department))],
    fragility_items: items,
    cascades: watch,
    urban_centres: opts.urban_centres.slice(0, 5),
    bonus: { compound, cascade },
  }
}

export { damsNear, nuclearNear, campsInRegion, regionHasDam }
export type { CascadeWatch }
