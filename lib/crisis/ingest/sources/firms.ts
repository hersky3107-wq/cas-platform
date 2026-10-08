import { buildDedupeKey } from '../dedupe'
import { finiteNumber, isoTime, politeFetch } from '../fetch'
import type { CrisisSource, IngestFetchResult, NormalizedSignal } from '../types'

export const FIRMS_ROW_CAP = 5000

const HIGH_NOMINAL = new Set(['high', 'nominal', 'h', 'n'])

export function firmsUrl(mapKey: string): string {
  return `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${mapKey}/VIIRS_SNPP_NRT/world/1`
}

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim())
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map((h) => h.trim())
  const rows: Array<Record<string, string>> = []
  for (const line of lines.slice(1)) {
    const cols = line.split(',')
    const row: Record<string, string> = {}
    headers.forEach((header, i) => {
      row[header] = (cols[i] ?? '').trim()
    })
    rows.push(row)
  }
  return rows
}

export function normalizeFirmsCsv(csv: string, cap = FIRMS_ROW_CAP): NormalizedSignal[] {
  const rows = parseCsv(csv)
    .filter((row) => HIGH_NOMINAL.has((row.confidence ?? '').toLowerCase()))
    .sort((a, b) => (finiteNumber(b.frp) ?? 0) - (finiteNumber(a.frp) ?? 0))
    .slice(0, cap)

  return rows.map((row) => {
    const lat = finiteNumber(row.latitude)
    const lon = finiteNumber(row.longitude)
    const acq = row.acq_date && row.acq_time
      ? isoTime(`${row.acq_date}T${row.acq_time.padStart(4, '0').slice(0, 2)}:${row.acq_time.padStart(4, '0').slice(2, 4)}:00Z`)
      : isoTime(row.acq_date)
    const id = `${row.latitude},${row.longitude},${row.acq_date},${row.acq_time},${row.satellite}`
    return {
      department: 'fire',
      source: 'firms',
      signal_type: 'active_fire',
      title: `VIIRS ${row.confidence} FRP ${row.frp ?? ''}`.trim(),
      lat,
      lon,
      country_iso3: null,
      value_num: finiteNumber(row.frp),
      value_raw: {
        confidence: row.confidence,
        frp: finiteNumber(row.frp),
        bright_ti4: finiteNumber(row.bright_ti4),
        satellite: row.satellite ?? null,
        daynight: row.daynight ?? null,
      },
      unit_raw: 'MW',
      event_time: acq,
      url: 'https://firms.modaps.eosdis.nasa.gov/',
      dedupe_key: buildDedupeKey({ source: 'firms', signalType: 'active_fire', id, lat, lon, eventTime: acq }),
    }
  })
}

export const firmsSource: CrisisSource = {
  key: 'firms',
  department: 'fire',
  scheduleMinutes: 180,
  writes: 'signals',
  requiredEnv: ['FIRMS_MAP_KEY'],
  async fetch(ctx): Promise<IngestFetchResult> {
    const key = ctx.env.FIRMS_MAP_KEY!.trim()
    const res = await politeFetch(firmsUrl(key), { sourceKey: 'firms', minIntervalMs: 15_000, as: 'text' })
    if (!res.ok) return { httpCalls: 1, error: res.error ?? `HTTP ${res.status}` }
    if (/invalid api call|invalid.*key|unauthorized/i.test(res.text)) {
      return { httpCalls: 1, error: 'FIRMS rejected MAP_KEY' }
    }
    const signals = normalizeFirmsCsv(res.text)
    return {
      httpCalls: 1,
      signals,
      quotaNote: signals.length >= FIRMS_ROW_CAP ? `capped at ${FIRMS_ROW_CAP} high/nominal rows` : null,
    }
  },
}
