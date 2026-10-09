import { clamp } from './math'
import { WIKI_AMPLIFY } from './thresholds'
import type { TriggerComponent } from './types'

/** A kept wiki article boosts components that already fired. It is not itself a trigger. */
export function amplifyFired(components: TriggerComponent[], active: boolean): TriggerComponent[] {
  if (!active) return components
  return components.map((row) => {
    if (row.value <= 0) return row
    const next = clamp(row.value * WIKI_AMPLIFY)
    if (next === row.value) return row
    return { ...row, value: next, raw: { ...row.raw, wiki_amplify: WIKI_AMPLIFY } }
  })
}
