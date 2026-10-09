import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  NormalizedAdvisory,
  NormalizedAdvisoryHistory,
  NormalizedDaily,
  NormalizedForecast,
  NormalizedGlobalMetric,
  NormalizedMetric,
  NormalizedSignal,
} from './types'

/**
 * In-batch collapse before ON CONFLICT upserts.
 * Postgres rejects a batch that updates the same conflict key twice.
 *
 * Merge rules:
 * - signals (dedupe_key): keep the latest event_time, then the higher value_num. Union arrays inside value_raw.
 * - metrics (region_id, metric, valid_time, issued_at): keep the higher value (IPC phase). Union detail.units.
 * - forecasts (region_id, source, issued_date): keep the later issued_at.
 * - daily (region_id, day, source): keep the higher severity (frp_max, else total_events, else matches length). Union array stats.
 * - advisory_state (country_iso3, source): keep the higher level, then the later updated_at.
 */

function logCollapsed(removed: number, log: (message: string) => void = console.log): void {
  if (removed > 0) log(`collapsed ${removed} duplicates`)
}

function asObj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function unionArrays(left: unknown[], right: unknown[]): unknown[] {
  const out = [...left]
  const seen = new Set(left.map((item) => JSON.stringify(item)))
  for (const item of right) {
    const tag = JSON.stringify(item)
    if (seen.has(tag)) continue
    seen.add(tag)
    out.push(item)
  }
  return out
}

function mergeArrayFields(
  winner: Record<string, unknown> | null,
  other: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!winner && !other) return null
  const base: Record<string, unknown> = { ...(winner ?? {}) }
  for (const [key, value] of Object.entries(other ?? {})) {
    const prev = base[key]
    if (Array.isArray(prev) && Array.isArray(value)) base[key] = unionArrays(prev, value)
  }
  return base
}

function timeMs(value: string | null | undefined): number {
  if (!value) return 0
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : 0
}

function metricUnits(row: NormalizedMetric): string[] {
  const raw = row.detail?.units
  if (Array.isArray(raw)) return raw.map((item) => String(item)).filter(Boolean)
  return []
}

export function collapseSignals(rows: NormalizedSignal[]): NormalizedSignal[] {
  const map = new Map<string, NormalizedSignal>()
  for (const row of rows) {
    const prev = map.get(row.dedupe_key)
    if (!prev) {
      map.set(row.dedupe_key, row)
      continue
    }
    const prevNewer = timeMs(prev.event_time) > timeMs(row.event_time)
    const sameTime = timeMs(prev.event_time) === timeMs(row.event_time)
    const prevSeverer = (prev.value_num ?? Number.NEGATIVE_INFINITY) >= (row.value_num ?? Number.NEGATIVE_INFINITY)
    const keepPrev = prevNewer || (sameTime && prevSeverer)
    const winner = keepPrev ? prev : row
    const loser = keepPrev ? row : prev
    map.set(row.dedupe_key, {
      ...winner,
      value_raw: mergeArrayFields(asObj(winner.value_raw), asObj(loser.value_raw)),
    })
  }
  return [...map.values()]
}

/** Collapse rows that share the metrics PK. Keeps the max value (IPC phase). */
export function collapseMetricsByPk(rows: NormalizedMetric[]): NormalizedMetric[] {
  const map = new Map<string, NormalizedMetric>()
  for (const row of rows) {
    const key = `${row.region_id}\0${row.metric}\0${row.valid_time}\0${row.issued_at}`
    const prev = map.get(key)
    if (!prev) {
      map.set(key, {
        ...row,
        detail: { ...(row.detail ?? {}), units: metricUnits(row) },
      })
      continue
    }
    const units = [...new Set([...metricUnits(prev), ...metricUnits(row)])]
    const winner = row.value > prev.value ? row : prev
    const loser = winner === row ? prev : row
    map.set(key, {
      ...winner,
      value: Math.max(prev.value, row.value),
      detail: { ...(mergeArrayFields(winner.detail ?? null, loser.detail ?? null) ?? {}), units },
    })
  }
  return [...map.values()]
}

export function collapseForecasts(rows: NormalizedForecast[]): NormalizedForecast[] {
  const map = new Map<string, NormalizedForecast>()
  for (const row of rows) {
    const key = `${row.region_id}\0${row.source}\0${row.issued_date}`
    const prev = map.get(key)
    if (!prev || timeMs(row.issued_at) >= timeMs(prev.issued_at)) map.set(key, row)
  }
  return [...map.values()]
}

function dailySeverity(stats: Record<string, unknown>): number {
  const frp = typeof stats.frp_max === 'number' ? stats.frp_max : null
  if (frp != null) return frp
  const total = typeof stats.total_events === 'number' ? stats.total_events : null
  if (total != null) return total
  return Array.isArray(stats.matches) ? stats.matches.length : 0
}

export function collapseDaily(rows: NormalizedDaily[]): NormalizedDaily[] {
  const map = new Map<string, NormalizedDaily>()
  for (const row of rows) {
    const key = `${row.region_id}\0${row.day}\0${row.source}`
    const prev = map.get(key)
    if (!prev) {
      map.set(key, row)
      continue
    }
    const winner = dailySeverity(row.stats) > dailySeverity(prev.stats) ? row : prev
    const loser = winner === row ? prev : row
    map.set(key, {
      ...winner,
      stats: mergeArrayFields(winner.stats, loser.stats) ?? winner.stats,
    })
  }
  return [...map.values()]
}

export function collapseAdvisories(rows: NormalizedAdvisory[]): NormalizedAdvisory[] {
  const map = new Map<string, NormalizedAdvisory>()
  for (const row of rows) {
    const key = `${row.country_iso3}\0${row.source}`
    const prev = map.get(key)
    if (!prev) {
      map.set(key, row)
      continue
    }
    const higher = row.level > prev.level
    const same = row.level === prev.level && timeMs(row.updated_at) >= timeMs(prev.updated_at)
    if (higher || same) map.set(key, row)
  }
  return [...map.values()]
}

export const UPSERT_BATCH = 500

async function chunked<T>(
  rows: T[],
  write: (batch: T[]) => Promise<void>,
): Promise<number> {
  let written = 0
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const batch = rows.slice(i, i + UPSERT_BATCH)
    await write(batch)
    written += batch.length
  }
  return written
}

export async function upsertSignals(client: SupabaseClient, rows: NormalizedSignal[]): Promise<number> {
  const collapsed = collapseSignals(rows)
  logCollapsed(rows.length - collapsed.length)
  return chunked(collapsed, async (batch) => {
    const { error } = await client.from('crisis_raw_signals').upsert(batch, { onConflict: 'dedupe_key' })
    if (error) throw new Error(`crisis_raw_signals upsert: ${error.message}`)
  })
}

export async function upsertForecasts(client: SupabaseClient, rows: NormalizedForecast[]): Promise<number> {
  const collapsed = collapseForecasts(rows)
  logCollapsed(rows.length - collapsed.length)
  return chunked(collapsed, async (batch) => {
    const { error } = await client
      .from('crisis_region_forecasts')
      .upsert(batch, { onConflict: 'region_id,source,issued_date' })
    if (error) throw new Error(`crisis_region_forecasts upsert: ${error.message}`)
  })
}

export async function upsertMetrics(client: SupabaseClient, rows: NormalizedMetric[]): Promise<number> {
  const collapsed = collapseMetricsByPk(rows)
  logCollapsed(rows.length - collapsed.length)
  return chunked(collapsed, async (batch) => {
    const { error } = await client
      .from('crisis_region_metrics')
      .upsert(batch, { onConflict: 'region_id,metric,valid_time,issued_at' })
    if (error) throw new Error(`crisis_region_metrics upsert: ${error.message}`)
  })
}

export async function upsertDaily(client: SupabaseClient, rows: NormalizedDaily[]): Promise<number> {
  const collapsed = collapseDaily(rows)
  logCollapsed(rows.length - collapsed.length)
  return chunked(collapsed, async (batch) => {
    const { error } = await client.from('crisis_region_daily').upsert(batch, { onConflict: 'region_id,day,source' })
    if (error) throw new Error(`crisis_region_daily upsert: ${error.message}`)
  })
}

export async function upsertAdvisories(client: SupabaseClient, rows: NormalizedAdvisory[]): Promise<number> {
  const collapsed = collapseAdvisories(rows)
  logCollapsed(rows.length - collapsed.length)
  return chunked(collapsed, async (batch) => {
    const { error } = await client.from('crisis_advisory_state').upsert(batch, { onConflict: 'country_iso3,source' })
    if (error) throw new Error(`crisis_advisory_state upsert: ${error.message}`)
  })
}

export async function upsertGlobalMetrics(
  client: SupabaseClient,
  rows: NormalizedGlobalMetric[],
): Promise<{ written: number; skipped: string | null }> {
  if (!rows.length) return { written: 0, skipped: null }
  const { error } = await client.from('crisis_global_metrics').upsert(rows, { onConflict: 'metric,valid_time,source' })
  if (error) {
    if (/crisis_global_metrics|schema cache|does not exist/i.test(error.message)) {
      return { written: 0, skipped: 'crisis_global_metrics is not applied yet' }
    }
    throw new Error(`crisis_global_metrics upsert: ${error.message}`)
  }
  return { written: rows.length, skipped: null }
}

function missingRelation(error: { message: string }, table: string): boolean {
  return new RegExp(`${table}|schema cache|does not exist`, 'i').test(error.message)
}

export async function upsertDyadDaily(
  client: SupabaseClient,
  rows: Array<{ actor1_country: string; actor2_country: string; day: string; stats: Record<string, unknown> }>,
): Promise<{ written: number; skipped: string | null }> {
  if (!rows.length) return { written: 0, skipped: null }
  try {
    const written = await chunked(rows, async (batch) => {
      const { error } = await client.from('crisis_dyad_daily').upsert(batch, {
        onConflict: 'actor1_country,actor2_country,day',
      })
      if (error) {
        if (missingRelation(error, 'crisis_dyad_daily')) throw new Error('crisis_dyad_daily is not applied yet')
        throw new Error(`crisis_dyad_daily upsert: ${error.message}`)
      }
    })
    return { written, skipped: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/not applied yet|schema cache|does not exist/i.test(message)) {
      return { written: 0, skipped: 'crisis_dyad_daily is not applied yet' }
    }
    throw error
  }
}

export async function upsertCountryDaily(
  client: SupabaseClient,
  rows: Array<{ country_iso3: string; day: string; stats: Record<string, unknown> }>,
): Promise<{ written: number; skipped: string | null }> {
  if (!rows.length) return { written: 0, skipped: null }
  try {
    const written = await chunked(rows, async (batch) => {
      const { error } = await client.from('crisis_country_daily').upsert(batch, {
        onConflict: 'country_iso3,day',
      })
      if (error) {
        if (missingRelation(error, 'crisis_country_daily')) {
          throw new Error('crisis_country_daily is not applied yet')
        }
        throw new Error(`crisis_country_daily upsert: ${error.message}`)
      }
    })
    return { written, skipped: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/not applied yet|schema cache|does not exist/i.test(message)) {
      return { written: 0, skipped: 'crisis_country_daily is not applied yet' }
    }
    throw error
  }
}

export async function insertAdvisoryHistory(
  client: SupabaseClient,
  rows: NormalizedAdvisoryHistory[],
): Promise<number> {
  return chunked(rows, async (batch) => {
    const { error } = await client.from('crisis_advisory_history').insert(batch)
    if (error) throw new Error(`crisis_advisory_history insert: ${error.message}`)
  })
}
