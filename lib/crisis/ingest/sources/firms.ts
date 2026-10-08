import { buildDedupeKey } from '../dedupe'
import { finiteNumber, isoTime, politeFetch } from '../fetch'
import type { CrisisSource, IngestFetchResult, NormalizedSignal } from '../types'

export const FIRMS_ROW_CAP = 20_000
export const FIRMS_AREA = 'world'
export const FIRMS_DAY_RANGE = 1
/** NOAA-20 first: the 2026-10-08 SNPP world/1 call returned a header and zero detections. */
export const FIRMS_SOURCES = ['VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT', 'VIIRS_SNPP_NRT', 'MODIS_NRT'] as const

const VIIRS_KEEP = new Set(['h', 'n', 'high', 'nominal'])

export function firmsUrl(mapKey: string, source: string = FIRMS_SOURCES[0]): string {
  return `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${mapKey}/${source}/${FIRMS_AREA}/${FIRMS_DAY_RANGE}`
}

export function firmsUrlRedacted(source: string): string {
  return `https://firms.modaps.eosdis.nasa.gov/api/area/csv/MAP_KEY/${source}/${FIRMS_AREA}/${FIRMS_DAY_RANGE}`
}

/** VIIRS letters h/n (and the words). MODIS confidence is 0–100; keep nominal/high (>= 30). */
export function firmsConfidenceKeep(raw: string | null | undefined): boolean {
  const value = (raw ?? '').trim().toLowerCase()
  if (VIIRS_KEEP.has(value)) return true
  if (value === 'l' || value === 'low') return false
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric >= 30 && numeric <= 100
}

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim())
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map((header) => header.trim().toLowerCase())
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

export function countFirmsCsv(csv: string): { before: number; after: number } {
  const rows = parseCsv(csv)
  return { before: rows.length, after: rows.filter((row) => firmsConfidenceKeep(row.confidence)).length }
}

export function normalizeFirmsCsv(csv: string, cap = FIRMS_ROW_CAP): { signals: NormalizedSignal[]; before: number; capped: boolean } {
  const parsed = parseCsv(csv)
  const kept = parsed
    .filter((row) => firmsConfidenceKeep(row.confidence))
    .sort((a, b) => (finiteNumber(b.frp) ?? 0) - (finiteNumber(a.frp) ?? 0))
  const capped = kept.length > cap
  const rows = kept.slice(0, cap)
  const signals = rows.map((row) => {
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
        instrument: row.instrument ?? null,
        daynight: row.daynight ?? null,
      },
      unit_raw: 'MW',
      event_time: acq,
      url: 'https://firms.modaps.eosdis.nasa.gov/',
      dedupe_key: buildDedupeKey({ source: 'firms', signalType: 'active_fire', id, lat, lon, eventTime: acq }),
    }
  })
  return { signals, before: parsed.length, capped }
}

export const firmsSource: CrisisSource = {
  key: 'firms',
  department: 'fire',
  scheduleMinutes: 180,
  writes: 'signals',
  requiredEnv: ['FIRMS_MAP_KEY'],
  async fetch(ctx): Promise<IngestFetchResult> {
    const key = ctx.env.FIRMS_MAP_KEY!.trim()
    let httpCalls = 0
    const notes: string[] = []
    for (const sensor of FIRMS_SOURCES) {
      const res = await politeFetch(firmsUrl(key, sensor), {
        sourceKey: 'firms',
        minIntervalMs: 5_000,
        timeoutMs: 90_000,
        as: 'text',
      })
      httpCalls += 1
      ctx.log(`[firms] ${firmsUrlRedacted(sensor)} http=${res.status}`)
      if (!res.ok) {
        notes.push(`${sensor} HTTP ${res.status}`)
        continue
      }
      if (/invalid api call|invalid.*key|unauthorized/i.test(res.text)) {
        return { httpCalls, error: 'FIRMS rejected MAP_KEY' }
      }
      const { signals, before, capped } = normalizeFirmsCsv(res.text)
      ctx.log(`[firms] ${sensor} rows_before=${before} rows_after=${signals.length}${capped ? ' capped' : ''}`)
      if (before === 0) {
        notes.push(`${sensor} header only`)
        continue
      }
      if (capped) ctx.log(`[firms] capped at ${FIRMS_ROW_CAP} (after filter would exceed cap)`)
      return {
        httpCalls,
        signals,
        quotaNote: [capped ? `capped at ${FIRMS_ROW_CAP}` : null, `sensor=${sensor}`, `before=${before}`, `after=${signals.length}`]
          .filter(Boolean)
          .join('; '),
      }
    }
    return {
      httpCalls,
      signals: [],
      quotaNote: notes.join('; ') || 'no FIRMS rows',
    }
  },
}
