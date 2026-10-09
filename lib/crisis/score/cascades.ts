import type { CascadeSeed } from '../knowledge/cascades.seed'
import { CASCADE_TRIGGER_COMPONENTS } from './thresholds'
import type { CascadeWatch, TriggerComponent } from './types'

export function matchCascades(opts: {
  cascades: CascadeSeed[]
  components: TriggerComponent[]
  kinds: Set<string>
  urbanPop: number
  watchlist?: boolean
}): CascadeWatch[] {
  const fired = new Set(opts.components.filter((row) => row.value > 0).map((row) => row.key))
  const out: CascadeWatch[] = []
  for (const row of opts.cascades) {
    const keys = CASCADE_TRIGGER_COMPONENTS[row.trigger_type] ?? []
    if (!keys.length || !keys.some((key) => fired.has(key))) continue
    const required = row.conditions.requires_fragility
    if (Array.isArray(required) && required.some((kind) => !opts.kinds.has(String(kind)))) continue
    const minPop = row.conditions.min_population
    if (typeof minPop === 'number' && opts.urbanPop < minPop) continue
    if (row.conditions.requires_watchlist === true && !opts.watchlist) continue
    out.push({
      id: row.id,
      trigger_type: row.trigger_type,
      effect_type: row.effect_type,
      lag_min_days: row.lag_min_days,
      lag_max_days: row.lag_max_days,
      evidence_level: row.evidence_level,
    })
  }
  return out
}

/** Bonus only when every required fragility kind is inside the region or a neighbour. */
export function cascadeBonusApplies(watch: CascadeWatch[], kinds: Set<string>, cascades: CascadeSeed[]): boolean {
  return watch.some((item) => {
    const seed = cascades.find((row) => row.id === item.id)
    const required = seed?.conditions.requires_fragility
    if (!Array.isArray(required) || required.length === 0) return false
    return required.every((kind) => kinds.has(String(kind)))
  })
}
