import { CARD_MAX_BYTES } from './thresholds'
import type { AnomalyCard, RegionScore, RelatedSignal } from './types'

function trim(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

export function buildAnomalyCard(score: RegionScore, signals: RelatedSignal[]): AnomalyCard {
  const card: AnomalyCard = {
    region: trim(score.name, 40),
    country: trim(score.country, 32),
    iso3: score.iso3,
    stage: score.stage,
    score: Number(score.score.toFixed(1)),
    components: score.components
      .filter((row) => row.value > 0)
      .map((row) => ({ key: row.key, value: Number(row.value.toFixed(2)), raw: slimRaw(row.raw) })),
    fragility: score.fragility_items.slice(0, 5).map((item) => ({ kind: item.kind, name: trim(item.name, 36) })),
    urban: score.urban_centres.slice(0, 3).map((row) => ({ name: trim(row.name, 28), pop: Math.round(row.pop) })),
    cascades: score.cascades.slice(0, 5).map((row) => ({
      id: row.id,
      effect: row.effect_type,
      lag: `${row.lag_min_days}-${row.lag_max_days}d`,
      evidence: row.evidence_level,
    })),
    signals: signals.slice(0, 3).map((row) => ({
      source: row.source,
      title: row.title ? trim(row.title, 48) : null,
      url: row.url,
      event_time: row.event_time,
    })),
    context: (score.context ?? []).slice(0, 4).map((row) => trim(row, 80)),
  }
  return shrinkCard(card)
}

function slimRaw(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (value == null) continue
    if (typeof value === 'number') out[key] = Number(value.toFixed(3))
    else if (typeof value === 'boolean' || typeof value === 'string') out[key] = typeof value === 'string' ? trim(value, 24) : value
  }
  return out
}

export function cardBytes(card: AnomalyCard): number {
  return Buffer.byteLength(JSON.stringify(card), 'utf8')
}

function shrinkCard(card: AnomalyCard): AnomalyCard {
  const next = { ...card }
  while (cardBytes(next) > CARD_MAX_BYTES) {
    if (next.signals.length > 1) next.signals = next.signals.slice(0, next.signals.length - 1)
    else if (next.cascades.length > 1) next.cascades = next.cascades.slice(0, next.cascades.length - 1)
    else if (next.urban.length > 1) next.urban = next.urban.slice(0, next.urban.length - 1)
    else if (next.fragility.length > 1) next.fragility = next.fragility.slice(0, next.fragility.length - 1)
    else if (next.components.length > 1) next.components = next.components.slice(0, next.components.length - 1)
    else if (next.context.length > 1) next.context = next.context.slice(0, next.context.length - 1)
    else break
  }
  return next
}
