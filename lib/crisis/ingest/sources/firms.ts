import { isConflictWatchlistIso3 } from '../../config/watchlist'
import { assignLatLonBatch } from '../assign'
import { buildDedupeKey } from '../dedupe'
import { asRecord, finiteNumber, isoTime, politeFetch } from '../fetch'
import { loadStateSafe } from '../regions'
import type { CrisisSource, IngestFetchResult, NormalizedDaily, NormalizedSignal } from '../types'

export const FIRMS_ROW_CAP = 20_000
export const FIRMS_KEEP_FRP_MW = 100
export const FIRMS_LOW_VOLUME_ABS = 3_000
export const FIRMS_LOW_VOLUME_RATIO = 0.3
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

export interface FirmsDetection {
  lat: number
  lon: number
  frp: number
  daynight: string | null
  acq_date: string | null
  acq_time: string | null
  confidence: string | null
  satellite: string | null
  instrument: string | null
  bright_ti4: number | null
  event_time: string | null
}

export function parseFirmsDetections(csv: string, cap = FIRMS_ROW_CAP): {
  detections: FirmsDetection[]
  before: number
  capped: boolean
} {
  const parsed = parseCsv(csv)
  const kept = parsed
    .filter((row) => firmsConfidenceKeep(row.confidence))
    .sort((a, b) => (finiteNumber(b.frp) ?? 0) - (finiteNumber(a.frp) ?? 0))
  const capped = kept.length > cap
  const detections = kept.slice(0, cap).flatMap((row) => {
    const lat = finiteNumber(row.latitude)
    const lon = finiteNumber(row.longitude)
    if (lat == null || lon == null) return []
    const acq = row.acq_date && row.acq_time
      ? isoTime(`${row.acq_date}T${row.acq_time.padStart(4, '0').slice(0, 2)}:${row.acq_time.padStart(4, '0').slice(2, 4)}:00Z`)
      : isoTime(row.acq_date)
    return [{
      lat,
      lon,
      frp: finiteNumber(row.frp) ?? 0,
      daynight: row.daynight || null,
      acq_date: row.acq_date || (acq ? acq.slice(0, 10) : null),
      acq_time: row.acq_time || null,
      confidence: row.confidence || null,
      satellite: row.satellite || null,
      instrument: row.instrument || null,
      bright_ti4: finiteNumber(row.bright_ti4),
      event_time: acq,
    }]
  })
  return { detections, before: parsed.length, capped }
}

export function shouldKeepFirmsPoint(frp: number, countryIso3: string | null | undefined): boolean {
  return frp >= FIRMS_KEEP_FRP_MW || isConflictWatchlistIso3(countryIso3)
}

export interface AssignedFirmsDetection extends FirmsDetection {
  region_id: number | null
  country_iso3: string | null
}

export function aggregateFirmsDaily(detections: AssignedFirmsDetection[]): NormalizedDaily[] {
  const buckets = new Map<string, {
    region_id: number
    day: string
    count: number
    frp_sum: number
    frp_max: number
    day_n: number
    night_n: number
  }>()
  for (const row of detections) {
    if (row.region_id == null || !row.acq_date) continue
    const key = `${row.region_id}|${row.acq_date}`
    const cur = buckets.get(key) ?? {
      region_id: row.region_id,
      day: row.acq_date,
      count: 0,
      frp_sum: 0,
      frp_max: 0,
      day_n: 0,
      night_n: 0,
    }
    cur.count += 1
    cur.frp_sum += row.frp
    cur.frp_max = Math.max(cur.frp_max, row.frp)
    const dn = (row.daynight ?? '').toUpperCase()
    if (dn === 'D' || dn === 'DAY') cur.day_n += 1
    else if (dn === 'N' || dn === 'NIGHT') cur.night_n += 1
    buckets.set(key, cur)
  }
  return [...buckets.values()].map((row) => ({
    region_id: row.region_id,
    day: row.day,
    source: 'firms',
    stats: {
      count: row.count,
      frp_sum: row.frp_sum,
      frp_max: row.frp_max,
      day: row.day_n,
      night: row.night_n,
    },
  }))
}

export function firmsDetectionsToSignals(detections: AssignedFirmsDetection[]): NormalizedSignal[] {
  return detections.map((row) => {
    const id = `${row.lat},${row.lon},${row.acq_date},${row.acq_time},${row.satellite}`
    return {
      department: 'fire',
      source: 'firms',
      signal_type: 'active_fire',
      title: `VIIRS ${row.confidence ?? ''} FRP ${row.frp}`.trim(),
      lat: row.lat,
      lon: row.lon,
      country_iso3: row.country_iso3,
      value_num: row.frp,
      value_raw: {
        confidence: row.confidence,
        frp: row.frp,
        bright_ti4: row.bright_ti4,
        satellite: row.satellite,
        instrument: row.instrument,
        daynight: row.daynight,
        region_id: row.region_id,
      },
      unit_raw: 'MW',
      event_time: row.event_time,
      url: 'https://firms.modaps.eosdis.nasa.gov/',
      dedupe_key: buildDedupeKey({ source: 'firms', signalType: 'active_fire', id, lat: row.lat, lon: row.lon, eventTime: row.event_time }),
    }
  })
}

/** @deprecated use parseFirmsDetections + keep filter. Kept for older tests. */
export function normalizeFirmsCsv(csv: string, cap = FIRMS_ROW_CAP): { signals: NormalizedSignal[]; before: number; capped: boolean } {
  const { detections, before, capped } = parseFirmsDetections(csv, cap)
  const assigned = detections.map((row) => ({ ...row, region_id: null, country_iso3: null }))
  return { signals: firmsDetectionsToSignals(assigned), before, capped }
}

export function firmsMedian(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2) return sorted[mid]
  return (sorted[mid - 1] + sorted[mid]) / 2
}

/** Low when below 30% of the trailing median, or below 3000 with no history. */
export function firmsVolumeIsLow(count: number, history: number[]): boolean {
  const median = firmsMedian(history)
  if (median == null) return count < FIRMS_LOW_VOLUME_ABS
  return count < FIRMS_LOW_VOLUME_RATIO * median
}

export function firmsDedupeKey(row: FirmsDetection): string {
  return `${row.lat.toFixed(2)}|${row.lon.toFixed(2)}|${row.acq_date ?? ''}|${row.acq_time ?? ''}`
}

export function dedupeFirmsDetections(rows: FirmsDetection[]): FirmsDetection[] {
  const map = new Map<string, FirmsDetection>()
  for (const row of rows) {
    const key = firmsDedupeKey(row)
    const prev = map.get(key)
    if (!prev || row.frp > prev.frp) map.set(key, row)
  }
  return [...map.values()]
}

function sensorHistory(cursor: Record<string, unknown> | null, sensor: string): number[] {
  const bag = asRecord(cursor?.firms_sensor_counts)
  const raw = bag?.[sensor]
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is number => typeof item === 'number' && Number.isFinite(item)).slice(-7)
}

export function countFirmsCsv(csv: string): { before: number; after: number } {
  const { detections, before } = parseFirmsDetections(csv)
  return { before, after: detections.length }
}

export const firmsSource: CrisisSource = {
  key: 'firms',
  department: 'fire',
  scheduleMinutes: 180,
  writes: 'mixed',
  requiredEnv: ['FIRMS_MAP_KEY'],
  async fetch(ctx): Promise<IngestFetchResult> {
    const key = ctx.env.FIRMS_MAP_KEY!.trim()
    const state = await loadStateSafe(ctx.client, 'firms')
    const historyBag: Record<string, number[]> = {}
    const prior = asRecord(state?.cursor?.firms_sensor_counts)
    if (prior) {
      for (const [sensor, values] of Object.entries(prior)) {
        if (Array.isArray(values)) historyBag[sensor] = values.filter((item): item is number => typeof item === 'number')
      }
    }
    let httpCalls = 0
    const notes: string[] = []
    const collected: FirmsDetection[] = []
    let capped = false
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
      const parsed = parseFirmsDetections(res.text)
      const history = sensorHistory(state?.cursor ?? null, sensor)
      const low = firmsVolumeIsLow(parsed.before, history)
      ctx.log(`[firms] ${sensor} rows=${parsed.before} after_confidence=${parsed.detections.length} low=${low}`)
      notes.push(`${sensor}=${parsed.before}`)
      historyBag[sensor] = [...history, parsed.before].slice(-7)
      if (parsed.capped) capped = true
      if (parsed.before === 0) {
        notes.push(`${sensor} header only`)
        continue
      }
      collected.push(...parsed.detections)
      if (!low) break
    }

    const merged = dedupeFirmsDetections(collected)
    let assigned: AssignedFirmsDetection[] = merged.map((row) => ({
      ...row,
      region_id: null,
      country_iso3: null,
    }))
    try {
      const hits = await assignLatLonBatch(
        ctx.client,
        merged.map((row, i) => ({ i, lat: row.lat, lon: row.lon })),
      )
      assigned = merged.map((row, i) => {
        const hit = hits.get(i)
        return {
          ...row,
          region_id: hit?.region_id ?? null,
          country_iso3: hit?.country_iso3 ?? null,
        }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      ctx.log(`[firms] assign skipped: ${message}`)
      notes.push('assign unavailable')
    }

    const daily = aggregateFirmsDaily(assigned)
    const keepers = assigned.filter((row) => shouldKeepFirmsPoint(row.frp, row.country_iso3))
    const signals = firmsDetectionsToSignals(keepers)
    ctx.log(`[firms] merged=${merged.length} aggregated=${daily.length} kept_raw=${keepers.length} dropped=${assigned.length - keepers.length}`)
    return {
      httpCalls,
      signals,
      daily,
      cursor: { firms_sensor_counts: historyBag },
      quotaNote: [
        capped ? `capped at ${FIRMS_ROW_CAP}` : null,
        `sensors=${notes.filter((note) => note.includes('=')).join(',')}`,
        `merged=${merged.length}`,
        `aggregated=${daily.length}`,
        `kept=${keepers.length}`,
        `dropped=${assigned.length - keepers.length}`,
      ].filter(Boolean).join('; '),
    }
  },
}
