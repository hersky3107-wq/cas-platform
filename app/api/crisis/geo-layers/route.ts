import { NextResponse } from 'next/server'
import { plateLinesDecimated } from '@/lib/crisis/precursors/geometry-load'
import { requireCrisisUser } from '@/lib/crisis/public/auth'
import { supabaseAdmin } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

function rawOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export async function GET(req: Request) {
  const auth = await requireCrisisUser(req)
  if ('response' in auth) return auth.response
  try {
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString()
    const volcanoRows: Array<{ title: string | null; lat: number | null; lon: number | null; value_raw: unknown }> = []
    for (let from = 0; ; from += 1000) {
      const page = await supabaseAdmin
        .from('crisis_raw_signals')
        .select('title, lat, lon, value_raw')
        .eq('signal_type', 'holocene_volcano')
        .order('id', { ascending: true })
        .range(from, from + 999)
      if (page.error) throw new Error(page.error.message)
      const rows = page.data ?? []
      volcanoRows.push(...rows)
      if (rows.length < 1000) break
    }
    const [elevated, cells] = await Promise.all([
      supabaseAdmin
        .from('crisis_raw_signals')
        .select('lat, lon, value_raw, event_time')
        .eq('signal_type', 'elevated_volcano')
        .gte('event_time', since)
        .limit(500),
      supabaseAdmin
        .from('crisis_raw_signals')
        .select('lat, lon, value_num, value_raw, event_time')
        .eq('signal_type', 'eq_rate_cell')
        .order('event_time', { ascending: false })
        .limit(2000),
    ])
    if (elevated.error) throw new Error(elevated.error.message)
    if (cells.error) throw new Error(cells.error.message)

    const alerts: Array<{ lat: number; lon: number; alert: string; at: string }> = []
    for (const row of elevated.data ?? []) {
      if (row.lat == null || row.lon == null) continue
      const raw = rawOf(row.value_raw)
      const alert = String(raw.alert_level ?? raw.color_code ?? '')
      if (!alert) continue
      alerts.push({ lat: row.lat, lon: row.lon, alert, at: row.event_time ?? '' })
    }

    const volcanoOut = volcanoRows.flatMap((row) => {
      if (row.lat == null || row.lon == null) return []
      const raw = rawOf(row.value_raw)
      let alert: string | null = null
      let best = ''
      for (const item of alerts) {
        if (Math.abs(item.lat - row.lat) > 0.4 || Math.abs(item.lon - row.lon) > 0.4) continue
        if (item.at >= best) {
          best = item.at
          alert = item.alert
        }
      }
      return [{
        lat: row.lat,
        lon: row.lon,
        name: String(raw.volcano ?? row.title ?? 'volcano'),
        alert,
      }]
    })

    const newest = (cells.data ?? []).find((row) => row.event_time)?.event_time?.slice(0, 10) ?? ''
    const cellOut = (cells.data ?? []).flatMap((row) => {
      if (!newest || !row.event_time?.startsWith(newest) || row.lat == null || row.lon == null) return []
      const raw = rawOf(row.value_raw)
      return [{
        lat: row.lat,
        lon: row.lon,
        multiplier: typeof row.value_num === 'number' ? row.value_num : 0,
        count7d: typeof raw.count_7d === 'number' ? raw.count_7d : 0,
        usual7d: typeof raw.usual_7d === 'number' ? raw.usual_7d : 0,
      }]
    })

    return NextResponse.json({
      plates: plateLinesDecimated(3),
      volcanoes: volcanoOut,
      cells: cellOut,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load layers'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
