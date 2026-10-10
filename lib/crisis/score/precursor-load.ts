import type { SupabaseClient } from '@supabase/supabase-js'
import { alertRank } from '../ingest/sources/volcano-unrest'
import type { HoloceneVolcano, LabeledPoint } from '../precursors/volcano'

export interface OafPoint {
  lat: number
  lon: number
  m5: number
  m6: number
  m7: number
}

export interface PrecursorBundle {
  yearCounts: Map<string, number>
  holocene: HoloceneVolcano[]
  points: LabeledPoint[]
  oaf: OafPoint[]
}

function rawOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export async function loadPrecursors(client: SupabaseClient, now: Date): Promise<PrecursorBundle> {
  const since = new Date(now.getTime() - 14 * 86_400_000).toISOString()
  const yearCounts = new Map<string, number>()
  const holocene: HoloceneVolcano[] = []
  const points: LabeledPoint[] = []
  const oaf: OafPoint[] = []

  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from('crisis_raw_signals')
      .select('value_num, value_raw, event_time')
      .eq('signal_type', 'eq_cell_background')
      .order('event_time', { ascending: false })
      .range(from, from + 999)
    if (error) throw new Error(`eq background: ${error.message}`)
    const rows = data ?? []
    for (const row of rows) {
      const raw = rawOf(row.value_raw)
      const cell = typeof raw.cell === 'string' ? raw.cell : null
      if (!cell || yearCounts.has(cell)) continue
      yearCounts.set(cell, typeof row.value_num === 'number' ? row.value_num : 0)
    }
    if (rows.length < 1000) break
  }

  for (let from = 0; ; from += 1000) {
    const { data: volcanoRows, error: volcanoError } = await client
      .from('crisis_raw_signals')
      .select('title, lat, lon, value_raw')
      .eq('signal_type', 'holocene_volcano')
      .order('id', { ascending: true })
      .range(from, from + 999)
    if (volcanoError) throw new Error(`holocene: ${volcanoError.message}`)
    const rows = volcanoRows ?? []
    for (const row of rows) {
      if (row.lat == null || row.lon == null) continue
      const raw = rawOf(row.value_raw)
      const name = String(raw.volcano ?? row.title ?? 'volcano')
      holocene.push({
        id: String(raw.volcano_number ?? name),
        name,
        lat: row.lat,
        lon: row.lon,
      })
    }
    if (rows.length < 1000) break
  }

  const { data: live, error: liveError } = await client
    .from('crisis_raw_signals')
    .select('signal_type, title, lat, lon, value_raw, event_time')
    .in('signal_type', ['volcano_ash', 'volcano_thermal', 'volcano_so2', 'volcano_weekly', 'volcano_unrest', 'aftershock_forecast'])
    .gte('event_time', since)
    .limit(4000)
  if (liveError) throw new Error(`precursors: ${liveError.message}`)
  for (const row of live ?? []) {
    if (row.lat == null || row.lon == null) continue
    const raw = rawOf(row.value_raw)
    const name = String(raw.volcano ?? raw.place ?? row.title ?? '')
    if (row.signal_type === 'aftershock_forecast') {
      const m5 = typeof raw.m5 === 'number' ? raw.m5 : null
      const m6 = typeof raw.m6 === 'number' ? raw.m6 : null
      const m7 = typeof raw.m7 === 'number' ? raw.m7 : null
      if (m5 == null || m6 == null || m7 == null) continue
      oaf.push({ lat: row.lat, lon: row.lon, m5, m6, m7 })
      continue
    }
    if (row.signal_type === 'volcano_unrest') {
      if (raw.rule !== 'hans_increase') continue
      const previous = typeof raw.previous_rank === 'number' ? raw.previous_rank : 0
      const steps = Math.max(1, alertRank(typeof raw.alert === 'string' ? raw.alert : null) - previous)
      points.push({ lat: row.lat, lon: row.lon, name, at: row.event_time, kind: 'alert', steps })
      continue
    }
    const kind =
      row.signal_type === 'volcano_ash' ? 'ash'
      : row.signal_type === 'volcano_thermal' ? 'thermal'
      : row.signal_type === 'volcano_so2' ? 'so2'
      : row.signal_type === 'volcano_weekly' ? 'weekly'
      : null
    if (!kind) continue
    points.push({ lat: row.lat, lon: row.lon, name, at: row.event_time, kind })
  }

  return { yearCounts, holocene, points, oaf }
}
