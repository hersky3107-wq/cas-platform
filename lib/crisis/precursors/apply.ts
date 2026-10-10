import { clamp } from '../score/math'
import type { TriggerComponent } from '../score/types'
import { earthquakeStrength, type BDrop, type RateFlag, type SwarmCluster } from './earthquake'
import type { WeekProbabilities } from './oaf'
import { volcanoPrecursorFires, type PrecursorBit } from './volcano'

function withRaw(base: TriggerComponent, value: number, extra: Record<string, unknown>): TriggerComponent {
  return {
    ...base,
    value: clamp(Math.max(base.value, value)),
    raw: { ...base.raw, ...extra },
  }
}

export function applyEarthquakePrecursor(
  base: TriggerComponent,
  opts: {
    flag: RateFlag | null
    hazardZone: number
    swarm: SwarmCluster | null
    bDrop: BDrop | null
    oaf: WeekProbabilities | null
  },
): TriggerComponent {
  const extra: Record<string, unknown> = { hazard_zone: Number(opts.hazardZone.toFixed(2)) }
  let next = base.value
  if (opts.flag) {
    next = Math.max(next, earthquakeStrength(opts.flag.multiplier, opts.hazardZone))
    extra.forecast = 'probability'
    extra.rate_multiplier = Number(opts.flag.multiplier.toFixed(2))
    extra.count_7d = opts.flag.count7d
    extra.usual_7d = Number(opts.flag.expected7d.toFixed(2))
    extra.cell = opts.flag.cell
    extra.year_count = opts.flag.yearCount
  }
  if (opts.swarm) extra.swarm_72h = opts.swarm.count
  if (opts.bDrop) {
    extra.b_value = Number(opts.bDrop.recent.toFixed(2))
    extra.b_reference = Number(opts.bDrop.reference.toFixed(2))
    extra.b_drop = true
  }
  if (opts.oaf) {
    extra.oaf_m5 = Number(opts.oaf.m5.toFixed(4))
    extra.oaf_m6 = Number(opts.oaf.m6.toFixed(4))
    extra.oaf_m7 = Number(opts.oaf.m7.toFixed(4))
  }
  if (!opts.flag && !opts.swarm && !opts.bDrop && !opts.oaf) return base
  return withRaw(base, next, extra)
}

export function applyVolcanoPrecursor(base: TriggerComponent, bits: PrecursorBit[]): TriggerComponent {
  if (!volcanoPrecursorFires(bits)) return base
  const kinds = new Set(bits.map((bit) => bit.kind))
  const value = clamp(0.5 + 0.15 * Math.max(0, kinds.size - 1))
  return withRaw(base, value, {
    forecast: 'probability',
    precursors: bits.map((bit) => ({
      kind: bit.kind,
      ...(bit.multiplier != null ? { multiplier: Number(bit.multiplier.toFixed(2)) } : {}),
      ...(bit.steps != null ? { steps: bit.steps } : {}),
      ...(bit.name ? { name: bit.name } : {}),
    })),
  })
}
