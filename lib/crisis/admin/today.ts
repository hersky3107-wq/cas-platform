import { centroidLonLat } from './geo'
import type { AdminRegion, RiskFlagRow, StoredFlagDetail, StoredRegion } from './types'

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function triggerKeys(detail: StoredFlagDetail | null): string[] {
  if (!detail || !Array.isArray(detail.components)) return []
  const keys: string[] = []
  for (const item of detail.components) {
    const rec = asRecord(item)
    if (!rec) continue
    const key = typeof rec.key === 'string' ? rec.key : ''
    const value = typeof rec.value === 'number' ? rec.value : 0
    if (key && value > 0) keys.push(key)
  }
  return keys
}

export function parseFlagDetail(detail: unknown): StoredFlagDetail {
  const rec = asRecord(detail)
  if (!rec) return {}
  return {
    stage: rec.stage,
    components: rec.components,
    fragility_items: rec.fragility_items,
    cascades: rec.cascades,
  }
}

export function flagStage(detail: StoredFlagDetail, score: number): number {
  if (typeof detail.stage === 'number' && Number.isInteger(detail.stage)) return detail.stage
  if (score >= 7) return 5
  if (score >= 5) return 4
  if (score >= 3) return 3
  if (score >= 1.5) return 2
  return 1
}

export function latestFlagDate(rows: Array<{ flag_date: string }>, todayUtc: string): string | null {
  const dates = rows.map((row) => row.flag_date).filter(Boolean)
  if (dates.includes(todayUtc)) return todayUtc
  return dates.sort().at(-1) ?? null
}

export function assembleTodayRegions(opts: {
  flags: RiskFlagRow[]
  regions: StoredRegion[]
  countries: Array<{ iso3: string; name: string }>
  lastRuns: Array<{ region_id: number; at: string | null }>
}): AdminRegion[] {
  const countryName = new Map(opts.countries.map((row) => [row.iso3, row.name]))
  const regionById = new Map(opts.regions.map((row) => [row.id, row]))
  const lastById = new Map<number, string>()
  for (const row of opts.lastRuns) {
    if (row.at && !lastById.has(row.region_id)) lastById.set(row.region_id, row.at)
  }

  const out: AdminRegion[] = []
  for (const flag of opts.flags) {
    const region = regionById.get(Number(flag.region_id))
    if (!region) continue
    const point = centroidLonLat(region.centroid)
    if (!point) continue
    const detail = parseFlagDetail(flag.detail)
    const score = typeof flag.value === 'number' && Number.isFinite(flag.value) ? flag.value : 0
    const iso3 = region.iso3
    out.push({
      regionId: Number(region.id),
      name: region.name ?? iso3 ?? String(region.id),
      country: iso3 ? countryName.get(iso3) ?? iso3 : '',
      iso3,
      stage: flagStage(detail, score),
      score: Number(score.toFixed(1)),
      triggers: triggerKeys(detail),
      lastRunAt: lastById.get(Number(region.id)) ?? null,
      lat: point.lat,
      lon: point.lon,
      level: region.level,
    })
  }
  out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  return out
}
