import type { EngineCard, Horizon } from '../engine/schema'
import { DEFAULT_HORIZON } from './types'
import type { AdminRegion, StoredFlagDetail } from './types'

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function engineCardFromStored(
  region: AdminRegion,
  detail: StoredFlagDetail,
  horizon: Horizon = DEFAULT_HORIZON,
): EngineCard {
  const components: EngineCard['components'] = []
  if (Array.isArray(detail.components)) {
    for (const item of detail.components) {
      const rec = asRecord(item)
      if (!rec || typeof rec.key !== 'string') continue
      components.push({
        key: rec.key,
        value: typeof rec.value === 'number' ? rec.value : 0,
        raw: asRecord(rec.raw) ?? {},
      })
    }
  }
  const fragility: EngineCard['fragility'] = []
  if (Array.isArray(detail.fragility_items)) {
    for (const item of detail.fragility_items) {
      const rec = asRecord(item)
      if (!rec || typeof rec.kind !== 'string' || typeof rec.name !== 'string') continue
      fragility.push({ kind: rec.kind, name: rec.name })
    }
  }
  const cascades: EngineCard['cascades'] = []
  if (Array.isArray(detail.cascades)) {
    for (const item of detail.cascades) {
      const rec = asRecord(item)
      if (!rec || typeof rec.id !== 'string') continue
      cascades.push({
        id: rec.id,
        trigger: typeof rec.trigger_type === 'string' ? rec.trigger_type : typeof rec.trigger === 'string' ? rec.trigger : '',
        effect: typeof rec.effect_type === 'string' ? rec.effect_type : typeof rec.effect === 'string' ? rec.effect : '',
      })
    }
  }
  return {
    region_id: region.regionId,
    name: region.name,
    country: region.country,
    iso3: region.iso3,
    lat: region.lat,
    lon: region.lon,
    level: region.level,
    horizon,
    components,
    fragility,
    cascades,
    context: [],
    urban: [],
  }
}
