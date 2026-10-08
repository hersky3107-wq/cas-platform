import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  NormalizedAdvisory,
  NormalizedAdvisoryHistory,
  NormalizedDaily,
  NormalizedForecast,
  NormalizedMetric,
  NormalizedSignal,
} from './types'

function metricUnits(row: NormalizedMetric): string[] {
  const raw = row.detail?.units
  if (Array.isArray(raw)) return raw.map((item) => String(item)).filter(Boolean)
  return []
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
    map.set(key, {
      ...prev,
      value: Math.max(prev.value, row.value),
      detail: { ...(prev.detail ?? {}), ...(row.detail ?? {}), units },
    })
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
  return chunked(rows, async (batch) => {
    const { error } = await client.from('crisis_raw_signals').upsert(batch, { onConflict: 'dedupe_key' })
    if (error) throw new Error(`crisis_raw_signals upsert: ${error.message}`)
  })
}

export async function upsertForecasts(client: SupabaseClient, rows: NormalizedForecast[]): Promise<number> {
  return chunked(rows, async (batch) => {
    const { error } = await client
      .from('crisis_region_forecasts')
      .upsert(batch, { onConflict: 'region_id,source,issued_date' })
    if (error) throw new Error(`crisis_region_forecasts upsert: ${error.message}`)
  })
}

export async function upsertMetrics(client: SupabaseClient, rows: NormalizedMetric[]): Promise<number> {
  const collapsed = collapseMetricsByPk(rows)
  return chunked(collapsed, async (batch) => {
    const { error } = await client
      .from('crisis_region_metrics')
      .upsert(batch, { onConflict: 'region_id,metric,valid_time,issued_at' })
    if (error) throw new Error(`crisis_region_metrics upsert: ${error.message}`)
  })
}

export async function upsertDaily(client: SupabaseClient, rows: NormalizedDaily[]): Promise<number> {
  return chunked(rows, async (batch) => {
    const { error } = await client.from('crisis_region_daily').upsert(batch, { onConflict: 'region_id,day,source' })
    if (error) throw new Error(`crisis_region_daily upsert: ${error.message}`)
  })
}

export async function upsertAdvisories(client: SupabaseClient, rows: NormalizedAdvisory[]): Promise<number> {
  return chunked(rows, async (batch) => {
    const { error } = await client.from('crisis_advisory_state').upsert(batch, { onConflict: 'country_iso3,source' })
    if (error) throw new Error(`crisis_advisory_state upsert: ${error.message}`)
  })
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
