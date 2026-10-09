import type { SupabaseClient } from '@supabase/supabase-js'
import type { FixedSchedule } from './schedule'

export type IngestWrites = 'signals' | 'metrics' | 'forecasts' | 'daily' | 'advisories' | 'mixed'
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

export interface NormalizedGlobalMetric {
  metric: string
  valid_time: string
  issued_at: string
  value: number | null
  unit: string | null
  source: string
  detail?: Record<string, unknown> | null
}

export interface NormalizedMetric {
  region_id: number
  metric: string
  valid_time: string
  issued_at: string
  value: number
  unit: string | null
  source: string
  detail?: Record<string, unknown> | null
}

export interface NormalizedDaily {
  region_id: number
  day: string
  source: string
  stats: Record<string, unknown>
}

export interface NormalizedAdvisory {
  country_iso3: string
  source: string
  level: number
  level_text: string
  updated_at: string
  fetched_at: string
}

export interface NormalizedAdvisoryHistory {
  country_iso3: string
  source: string
  level: number
  level_text: string
  changed_at: string
  previous_level: number | null
}

export interface NormalizedForecast {
  region_id: number
  source: string
  issued_date: string
  issued_at: string
  horizon_days: number
  series: Record<string, unknown>
}

export interface IngestFetchResult {
  signals?: NormalizedSignal[]
  metrics?: NormalizedMetric[]
  forecasts?: NormalizedForecast[]
  daily?: NormalizedDaily[]
  advisories?: NormalizedAdvisory[]
  advisoryHistory?: NormalizedAdvisoryHistory[]
  globalMetrics?: NormalizedGlobalMetric[]
  cursor?: Record<string, unknown>
  /** When set (dry-run extrapolation), this is the row count the sweep reports. */
  reportedRows?: number
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
  /** When set, this Seoul clock wins over scheduleMinutes. Missed slots catch up later the same local day, once. */
  fixedSchedule?: FixedSchedule
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
