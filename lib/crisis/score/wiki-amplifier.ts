import { clamp } from './math'
import { COMPONENT_FAMILY, WIKI_AMPLIFY } from './thresholds'
import type { TriggerComponent } from './types'

export interface WikiAmplifyGate {
  natural: boolean
  human: boolean
}

const SKIP = new Set(['health_attention', 'escalation', 'slow_burn'])

/**
 * A kept article boosts components that already fired. It is not itself a trigger.
 * Natural components take storm/flood/dam/landslide/quake titles.
 * Human components take conflict and mobilization titles, and only when one has already fired.
 * A boolean gate is the natural-title case, used by older callers.
 */
export function amplifyFired(components: TriggerComponent[], gate: boolean | WikiAmplifyGate): TriggerComponent[] {
  const active: WikiAmplifyGate = typeof gate === 'boolean' ? { natural: gate, human: false } : gate
  if (!active.natural && !active.human) return components
  return components.map((row) => {
    if (row.value <= 0 || SKIP.has(row.key)) return row
    const family = COMPONENT_FAMILY[row.key]
    const allowed = (family === 'natural' && active.natural) || (family === 'human' && active.human)
    if (!allowed) return row
    const next = clamp(row.value * WIKI_AMPLIFY)
    if (next === row.value) return row
    return { ...row, value: next, raw: { ...row.raw, wiki_amplify: WIKI_AMPLIFY } }
  })
}
