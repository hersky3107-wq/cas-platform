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
  CONFLICT,
  CYCLONE,
  DAM_TRIGGER_KEYS,
  FRAGILITY_K,
  GDACS,
  NUCLEAR_TRIGGER_KEYS,
  QUAKE,
  RAIN,
  SCORE,
  STAGE_MIN,
  WATCHLIST_FRAGILITY,
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
    if (row.key === 'silence') continue
    if (row.value < SCORE.compoundMin) continue
    const family = COMPONENT_FAMILY[row.key]
    if (family) families.add(family)
  }
  if (families.size >= 2) return SCORE.compoundDepartments
  return 0
}

export function isExtremeTrigger(c: TriggerComponent): boolean {
  if (c.value <= 0) return false
  if (c.key === 'rain') {
    const sum = typeof c.raw.sum_mm === 'number' ? c.raw.sum_mm : 0
    const maxDay = typeof c.raw.max_day_mm === 'number' ? c.raw.max_day_mm : 0
    // rain >= 2x its stage threshold: 2x sumSoftMm (200mm) or 2x dayMm (100mm) or 2x sumHardMm (400mm)
    return sum >= 2 * RAIN.sumSoftMm || maxDay >= 2 * RAIN.dayMm || sum >= 2 * RAIN.sumHardMm
  }
  if (c.key === 'gdacs') {
    const alert = typeof c.raw.alert === 'string' ? c.raw.alert.toLowerCase() : ''
    return alert === 'red' || c.value >= GDACS.redValue
  }
  if (c.key === 'cyclone') {
    const km = typeof c.raw.nearest_km === 'number' ? c.raw.nearest_km : Infinity
    return km <= CYCLONE.closeKm || c.value >= CYCLONE.closeValue
  }
  if (c.key === 'quake') {
    const mag = typeof c.raw.mag === 'number' ? c.raw.mag : 0
    if (c.raw.forecast === 'probability' && mag < QUAKE.magHard) return false
    return mag >= QUAKE.magHard || c.value >= QUAKE.magHardValue
  }
  if (c.key === 'conflict') {
    const ratio = typeof c.raw.ratio === 'number' ? c.raw.ratio : 0
    return ratio >= CONFLICT.ratioHard || c.value >= CONFLICT.hardValue
  }
  return false
}

export function activeTriggerFamilies(components: TriggerComponent[]): Set<string> {
  const families = new Set<string>()
  for (const c of components) {
    if (c.value <= 0) continue
    if (c.key === 'escalation') {
      const isNatural = typeof c.raw.event === 'string' && /fire|flood|cyclone|volcano/.test(c.raw.event)
      families.add(isNatural ? 'natural' : 'human')
    } else {
      const fam = COMPONENT_FAMILY[c.key]
      if (fam) families.add(fam)
    }
  }
  return families
}

export function calculateStage(opts: {
  score: number
  components: TriggerComponent[]
  compound: number
  cascade: number
}): number {
  const rawStage = stageFromScore(opts.score)
  if (rawStage < 5) return rawStage

  const extreme = opts.components.some(isExtremeTrigger)
  if (extreme) return 5

  const families = activeTriggerFamilies(opts.components)
  if (families.size <= 1) {
    // A region with a single active trigger family cannot exceed stage 4 unless extreme
    return 4
  }

  // Stage 5 otherwise requires compound (two families >= 0.5) or a cascade bonus
  if (opts.compound > 0 || opts.cascade > 0) {
    return 5
  }

  return 4
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
  watchlist?: boolean
  context?: string[]
  extra_items?: FragilityItem[]
  coastal?: boolean
}): RegionScore {
  const trigger = combineTrigger(opts.components)
  const hydro = fired(opts.components, DAM_TRIGGER_KEYS)
  const campOn = fired(opts.components, CAMP_TRIGGER_KEYS)
  const nuclearOn = fired(opts.components, NUCLEAR_TRIGGER_KEYS)
  const damItems = hydro ? opts.dam_items : []
  const campCount = campOn ? opts.camp_count : 0
  const nuclearItems = nuclearOn ? opts.nuclear_items : []
  const upstream = hydro ? opts.upstream_add : 0
  const boost = opts.watchlist ? WATCHLIST_FRAGILITY.multiplier : 1
  const boostedKinds = new Set<string>(WATCHLIST_FRAGILITY.kinds)
  const scale = (item: FragilityItem): FragilityItem =>
    boost !== 1 && boostedKinds.has(item.kind) ? { ...item, weight: item.weight * boost } : item
  const shownDams = damItems.map(scale)
  const shownNuclear = nuclearItems.map(scale)
  const shownExtra = (opts.extra_items ?? []).map(scale)
  const camps = campBucket(campCount)
  const inform = informFragility(opts.inform_vulnerability, opts.inform_coping)
  const weightSum =
    shownDams.reduce((acc, item) => acc + item.weight, 0) +
    shownExtra.reduce((acc, item) => acc + item.weight, 0) +
    camps +
    (shownNuclear.length ? Math.max(...shownNuclear.map((item) => item.weight)) : 0) +
    upstream +
    inform
  const fragility = diminish(weightSum, FRAGILITY_K)
  const people = peopleNorm(opts.urban_pop, opts.inform_exposure)
  const watch = matchCascades({
    cascades: CASCADE_SEEDS,
    components: opts.components,
    kinds: opts.kinds,
    urbanPop: opts.urban_pop,
    watchlist: opts.watchlist,
    coastal: opts.coastal,
  })
  const compound = compoundBonus(opts.components)
  const cascade = cascadeBonusApplies(watch, opts.kinds, CASCADE_SEEDS) ? SCORE.cascadeBonus : 0
  const raw = rawRiskScore(trigger, fragility, people)
  const score = Math.min(SCORE.cap, raw + compound + cascade)
  const items = [
    ...shownDams.slice(0, 5),
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
    ...shownExtra.slice(0, 2),
    ...shownNuclear.slice(0, 2),
  ].sort((a, b) => b.weight - a.weight).slice(0, 5)

  return {
    region_id: opts.region_id,
    name: opts.name,
    country: opts.country,
    iso3: opts.iso3,
    score,
    raw_score: raw,
    stage: calculateStage({
      score,
      components: opts.components,
      compound,
      cascade,
    }),
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
    context: opts.context ?? [],
  }
}

export { damsNear, nuclearNear, campsInRegion, regionHasDam }
export type { CascadeWatch }
