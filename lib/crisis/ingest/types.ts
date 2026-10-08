import type { SupabaseClient } from '@supabase/supabase-js'

export type IngestWrites = 'signals' | 'metrics'
export type IngestStatus = 'ok' | 'partial' | 'error' | 'skipped'
export type LicenseClass = 'open' | 'attribution' | 'noncommercial' | 'unclear'

export interface NormalizedSignal {
  department: string
  source: string
  signal_type: string
  title: string | null
  lat: number | null
  lon: number | null
  country_iso3: string | null
  value_num: number | null
  value_raw: Record<string, unknown> | null
  unit_raw: string | null
  event_time: string | null
  url: string | null
  dedupe_key: string
}

export interface NormalizedMetric {
  region_id: number
  metric: string
  valid_time: string
  issued_at: string
  value: number
  unit: string | null
  source: string
}

export interface IngestFetchResult {
  signals?: NormalizedSignal[]
  metrics?: NormalizedMetric[]
  httpCalls: number
  billedCalls?: number
  quotaNote?: string
  unmatched?: string[]
  error?: string
  skipped?: string
}

export interface IngestContext {
  now: Date
  dryRun: boolean
  env: NodeJS.ProcessEnv
  log: (message: string) => void
  client: SupabaseClient
}

export interface CrisisSource {
  key: string
  department: string
  scheduleMinutes: number
  writes: IngestWrites
  requiredEnv?: string[]
  fetch(ctx: IngestContext): Promise<IngestFetchResult>
}

export interface ForecastRegion {
  id: number
  level: 0 | 1
  iso3: string | null
  admin1_code: string | null
  name: string | null
  name_local: string | null
  lat: number
  lon: number
}

export interface IngestStateRow {
  source: string
  last_success_at: string | null
  cursor: Record<string, unknown> | null
  next_due_at: string | null
}
