import { ESCALATION } from '../score/thresholds'

export type EventKind = 'cyclone' | 'conflict' | 'outbreak' | 'fire_cluster' | 'flood' | 'volcano'
export type EventStatus = 'growing' | 'stable' | 'fading'
export type EventPace = 'growing_fast' | EventStatus

export interface EventPoint {
  kind: EventKind
  key: string
  name: string
  at: string
  value: number
  unit: string
  region_id: number | null
  source: string
  ref: string
}

export interface MetricPoint {
  date: string
  value: number
  unit: string
}

export interface LinkedEvent {
  id: string
  kind: EventKind
  name: string
  first_seen: string
  last_seen: string
  region_ids: number[]
  metrics_history: MetricPoint[]
  status: EventStatus
  pace: EventPace
  source_refs: Array<{ source: string; ref: string }>
}

export function gridKey(lat: number, lon: number, step = 0.5): string {
  const y = Math.floor(lat / step) * step
  const x = Math.floor(lon / step) * step
  return `${y.toFixed(1)},${x.toFixed(1)}`
}

export function growthPace(history: MetricPoint[], kind: EventKind, now: Date): { status: EventStatus; pace: EventPace; slope: number } {
  const cuts = slopeCuts(kind)
  const end = now.getTime()
  const start = end - ESCALATION.days * 86_400_000
  const window = history
    .map((row) => ({ ...row, t: Date.parse(row.date) }))
    .filter((row) => Number.isFinite(row.t) && row.t >= start && row.t <= end)
    .sort((a, b) => a.t - b.t)
  if (window.length < 2) return { status: 'stable', pace: 'stable', slope: 0 }
  const days = Math.max(1, (window[window.length - 1].t - window[0].t) / 86_400_000)
  const slope = (window[window.length - 1].value - window[0].value) / days
  if (slope > cuts.fast) return { status: 'growing', pace: 'growing_fast', slope }
  if (slope > cuts.min) return { status: 'growing', pace: 'growing', slope }
  if (slope < -cuts.min) return { status: 'fading', pace: 'fading', slope }
  return { status: 'stable', pace: 'stable', slope }
}

function slopeCuts(kind: EventKind): { min: number; fast: number } {
  if (kind === 'cyclone') return { min: ESCALATION.cycloneKtPerDay, fast: ESCALATION.cycloneFastKtPerDay }
  if (kind === 'conflict') return { min: ESCALATION.conflictPerDay, fast: ESCALATION.conflictFastPerDay }
  if (kind === 'fire_cluster') return { min: ESCALATION.fireFrpPerDay, fast: ESCALATION.fireFastFrpPerDay }
  if (kind === 'volcano') return { min: ESCALATION.volcanoPerDay, fast: ESCALATION.volcanoFastPerDay }
  if (kind === 'flood') return { min: ESCALATION.floodPerDay, fast: ESCALATION.floodFastPerDay }
  return { min: ESCALATION.outbreakPerDay, fast: ESCALATION.outbreakFastPerDay }
}

export function linkEvents(points: EventPoint[], now: Date): LinkedEvent[] {
  const groups = new Map<string, EventPoint[]>()
  for (const point of points) {
    const id = `${point.kind}:${point.key}`
    const list = groups.get(id) ?? []
    list.push(point)
    groups.set(id, list)
  }
  const out: LinkedEvent[] = []
  for (const [id, rows] of groups) {
    const sorted = [...rows].sort((a, b) => a.at.localeCompare(b.at))
    const byDay = new Map<string, MetricPoint>()
    for (const row of sorted) {
      const date = row.at.slice(0, 10)
      const prev = byDay.get(date)
      if (!prev || row.value >= prev.value) byDay.set(date, { date, value: row.value, unit: row.unit })
    }
    const history = [...byDay.values()]
    const growth = growthPace(history, sorted[0].kind, now)
    const regions = [...new Set(sorted.map((row) => row.region_id).filter((id): id is number => id != null))]
    const refs = new Map<string, { source: string; ref: string }>()
    for (const row of sorted) refs.set(`${row.source}|${row.ref}`, { source: row.source, ref: row.ref })
    out.push({
      id,
      kind: sorted[0].kind,
      name: sorted[sorted.length - 1].name || sorted[0].name,
      first_seen: sorted[0].at,
      last_seen: sorted[sorted.length - 1].at,
      region_ids: regions,
      metrics_history: history,
      status: growth.status,
      pace: growth.pace,
      source_refs: [...refs.values(), { source: 'slope', ref: String(Number(growth.slope.toFixed(3))) }],
    })
  }
  return out
}

export function escalationValue(pace: EventPace): number {
  if (pace === 'growing_fast') return ESCALATION.fast
  if (pace === 'growing') return ESCALATION.growing
  return 0
}
