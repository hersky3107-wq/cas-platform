import type { SupabaseClient } from '@supabase/supabase-js'
import type { NormalizedMetric, NormalizedSignal } from './types'

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

export async function upsertMetrics(client: SupabaseClient, rows: NormalizedMetric[]): Promise<number> {
  return chunked(rows, async (batch) => {
    const { error } = await client
      .from('crisis_region_metrics')
      .upsert(batch, { onConflict: 'region_id,metric,valid_time,issued_at' })
    if (error) throw new Error(`crisis_region_metrics upsert: ${error.message}`)
  })
}
