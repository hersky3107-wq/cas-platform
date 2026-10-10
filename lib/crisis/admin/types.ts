export const QUEUE_SCOPES = ['region', 'all'] as const
export type QueueScope = (typeof QUEUE_SCOPES)[number]

export const QUEUE_STATUSES = ['queued', 'running', 'done', 'failed'] as const
export type QueueStatus = (typeof QUEUE_STATUSES)[number]

export const ESTIMATE_USD_PER_REGION = 0.42
export const RUN_ALL_MIN_STAGE = 3
export const DEFAULT_HORIZON = '30d' as const

export interface AdminRegion {
  regionId: number
  name: string
  country: string
  iso3: string | null
  stage: number
  score: number
  triggers: string[]
  lastRunAt: string | null
  lat: number
  lon: number
  level: number
}

export interface QueueInsert {
  region_id: number | null
  scope: QueueScope
  requested_by: string | null
  status: 'queued'
}

export interface QueueRow {
  id: string
  region_id: number | null
  scope: QueueScope
  requested_by: string | null
  status: QueueStatus
  run_id: string | null
  error: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export interface StoredFlagDetail {
  stage?: unknown
  components?: unknown
  fragility_items?: unknown
  cascades?: unknown
}

export interface StoredRegion {
  id: number
  name: string | null
  iso3: string | null
  level: number
  parent_id: number | null
  centroid: unknown
}

export interface RiskFlagRow {
  region_id: number
  flag_date: string
  value: number | null
  detail: unknown
}
