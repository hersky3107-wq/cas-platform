import { CASCADE_SEEDS } from '../knowledge/cascades.seed'
import { cascadeBonusApplies, matchCascades } from './cascades'
import {
  campBucket,
  campsInRegion,
  combineFragility,
  damsNear,
  informFragility,
  nuclearNear,
  regionHasDam,
} from './fragility'
import { clamp } from './math'
import { peopleNorm } from './people'
import { SCORE, STAGE_MIN } from './thresholds'
import { combineTrigger } from './trigger'
import type { CascadeWatch, FragilityItem, RegionScore, TriggerComponent, UrbanCentre } from './types'

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

export function compoundBonus(components: TriggerComponent[], damPresent: boolean): number {
  const departments = new Set(components.filter((row) => row.value > 0).map((row) => row.department))
  const rainRiverDam =
    damPresent &&
    components.some((row) => row.key === 'rain' && row.value > 0) &&
    components.some((row) => row.key === 'river' && row.value > 0)
  if (departments.size >= 2 || rainRiverDam) return SCORE.compoundDepartments
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
  const camps = campBucket(opts.camp_count)
  const damOr = opts.dam_items.length
    ? 1 - opts.dam_items.reduce((acc, item) => acc * (1 - item.weight), 1)
    : 0
  const nuclear = opts.nuclear_items.length ? Math.max(...opts.nuclear_items.map((item) => item.weight)) : 0
  const inform = informFragility(opts.inform_vulnerability, opts.inform_coping)
  const fragility = combineFragility([damOr, camps, nuclear, opts.upstream_add, inform])
  const people = peopleNorm(opts.urban_pop, opts.inform_exposure)
  const watch = matchCascades({
    cascades: CASCADE_SEEDS,
    components: opts.components,
    kinds: opts.kinds,
    urbanPop: opts.urban_pop,
  })
  const damPresent = opts.kinds.has('dam') || opts.dam_items.length > 0
  const compound = compoundBonus(opts.components, damPresent)
  const cascade = cascadeBonusApplies(watch, opts.kinds, CASCADE_SEEDS) ? SCORE.cascadeBonus : 0
  const raw = rawRiskScore(trigger, fragility, people)
  const score = raw + compound + cascade
  const items = [
    ...opts.dam_items.slice(0, 5),
    ...(camps > 0
      ? [{
          kind: 'refugee_camp',
          name: `${opts.camp_count} camps`,
          lat: null,
          lon: null,
          weight: camps,
          attributes: { count: opts.camp_count, bucket: camps },
        } satisfies FragilityItem]
      : []),
    ...opts.nuclear_items.slice(0, 2),
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
