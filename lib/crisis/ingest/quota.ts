import type { SupabaseClient } from '@supabase/supabase-js'
import { GLOFAS_DAILY_BILLED_CAP, OPENMETEO_DAILY_BILLED_CAP, utcDayKey } from './budget'

/** Shared Open-Meteo provider ledger row in crisis_ingest_state. */
export const OPENMETEO_QUOTA_SOURCE = 'openmeteo_quota'
export const OPENMETEO_COMBINED_DAILY_CAP = 9000
/** Accidental spend already billed on this UTC date before the ledger existed. */
export const OPENMETEO_SEED_DATE_UTC = '2026-10-08'
export const OPENMETEO_SEED_BILLED = 4586

export interface QuotaLedger {
  date_utc: string
  billed_today: number
}

export function resolveQuotaLedger(
  cursor: Partial<QuotaLedger> | null | undefined,
  now: Date,
): { ledger: QuotaLedger; seeded: boolean } {
  const date_utc = utcDayKey(now)
  const billed = Number(cursor?.billed_today)
  if (cursor?.date_utc === date_utc && Number.isFinite(billed) && billed >= 0) {
    return { ledger: { date_utc, billed_today: billed }, seeded: false }
  }
  const billed_today = date_utc === OPENMETEO_SEED_DATE_UTC ? OPENMETEO_SEED_BILLED : 0
  return { ledger: { date_utc, billed_today }, seeded: true }
}

/**
 * Forecast may use up to 5,000 of the shared 9,000. GloFAS gets what remains
 * after that forecast reservation (its own cap is 4,000).
 */
export function providerAllowance(source: 'openmeteo_forecast' | 'glofas', billedToday: number): number {
  const combinedLeft = Math.max(0, OPENMETEO_COMBINED_DAILY_CAP - billedToday)
  const forecastRoom = Math.max(0, OPENMETEO_DAILY_BILLED_CAP - Math.min(billedToday, OPENMETEO_DAILY_BILLED_CAP))
  if (source === 'openmeteo_forecast') return Math.min(forecastRoom, combinedLeft)
  return Math.min(GLOFAS_DAILY_BILLED_CAP, Math.max(0, combinedLeft - forecastRoom))
}

export function addBilled(ledger: QuotaLedger, additional: number): QuotaLedger {
  return { date_utc: ledger.date_utc, billed_today: ledger.billed_today + Math.max(0, additional) }
}

export function extrapolateCount(sampleRows: number, sampleLocations: number, totalLocations: number): number {
  if (sampleLocations <= 0 || totalLocations <= 0) return 0
  return Math.round((sampleRows * totalLocations) / sampleLocations)
}

export async function loadProviderQuota(
  client: SupabaseClient,
  now: Date,
): Promise<{ ledger: QuotaLedger; seeded: boolean }> {
  const { data, error } = await client
    .from('crisis_ingest_state')
    .select('cursor')
    .eq('source', OPENMETEO_QUOTA_SOURCE)
    .maybeSingle()
  if (error) throw new Error(`openmeteo quota: ${error.message}`)
  const cursor = (data?.cursor ?? null) as Partial<QuotaLedger> | null
  return resolveQuotaLedger(cursor, now)
}

export async function saveProviderQuota(client: SupabaseClient, ledger: QuotaLedger): Promise<void> {
  const { error } = await client.from('crisis_ingest_state').upsert(
    { source: OPENMETEO_QUOTA_SOURCE, cursor: ledger },
    { onConflict: 'source' },
  )
  if (error) throw new Error(`openmeteo quota save: ${error.message}`)
}
