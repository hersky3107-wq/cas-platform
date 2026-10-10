import { assignLatLonBatch } from '../assign'
import { countriesInText } from './advisories'
import { buildDedupeKey } from '../dedupe'
import { asArray, asRecord, finiteNumber, isoTime, politeFetch } from '../fetch'
import { loadStateSafe } from '../regions'
import type { CrisisSource, IngestContext, IngestFetchResult, NormalizedSignal } from '../types'

export const UCDP_VERSION = '26.0.8'
export const UCDP_DAILY_CAP = 5000
const PAGE_SIZE = 1000

function dayShift(now: Date, days: number): string {
  return new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10)
}

function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10)
}

export function ucdpEventSignal(row: Record<string, unknown>): NormalizedSignal | null {
  const lat = finiteNumber(row.latitude)
  const lon = finiteNumber(row.longitude)
  const deaths = finiteNumber(row.best)
  if (lat == null || lon == null || deaths == null || deaths < 1) return null
  const iso3 = countriesInText(typeof row.country === 'string' ? row.country : '')[0] ?? null
  const when = isoTime(row.date_start)
  const id = String(row.relid ?? row.id ?? '')
  if (!id) return null
  return {
    department: 'conflict',
    source: 'ucdp',
    signal_type: 'ucdp_event',
    title: 'confirmed deaths',
    lat,
    lon,
    country_iso3: iso3,
    value_num: deaths,
    value_raw: { deaths, date_start: when },
    unit_raw: 'deaths',
    event_time: when,
    url: 'https://ucdp.uu.se/',
    dedupe_key: buildDedupeKey({ source: 'ucdp', signalType: 'ucdp_event', id, eventTime: when }),
  }
}

export const ucdpSource: CrisisSource = {
  key: 'ucdp',
  department: 'conflict',
  scheduleMinutes: 1440,
  writes: 'signals',
  requiredEnv: ['UCDP_TOKEN'],
  async fetch(ctx): Promise<IngestFetchResult> {
    return fetchUcdp(ctx)
  },
}

async function fetchUcdp(ctx: IngestContext): Promise<IngestFetchResult> {
  const state = ctx.dryRun ? null : await loadStateSafe(ctx.client, 'ucdp')
  const cursor = asRecord(state?.cursor) ?? {}
  const today = utcDay(ctx.now)
  let requests = cursor.date_utc === today ? Number(cursor.requests_today) || 0 : 0
  const backfill = cursor.backfill_done === true
  const start = backfill ? dayShift(ctx.now, -2) : dayShift(ctx.now, -90)
  const end = utcDay(ctx.now)
  const token = ctx.env.UCDP_TOKEN?.trim() ?? ''
  const signals: NormalizedSignal[] = []
  let page = 0
  let httpCalls = 0
  while (requests < UCDP_DAILY_CAP) {
    const url =
      `https://ucdpapi.pcr.uu.se/api/gedevents/${UCDP_VERSION}` +
      `?pagesize=${PAGE_SIZE}&page=${page}&StartDate=${start}&EndDate=${end}`
    const res = await politeFetch(url, {
      sourceKey: 'ucdp',
      minIntervalMs: 1000,
      headers: { 'x-ucdp-access-token': token },
    })
    httpCalls += 1
    requests += 1
    if (!res.ok) {
      return {
        httpCalls,
        signals,
        error: res.error ?? `HTTP ${res.status}`,
        cursor: { date_utc: today, requests_today: requests, backfill_done: backfill, version: UCDP_VERSION },
        quotaNote: `requests_today=${requests}/${UCDP_DAILY_CAP} version=${UCDP_VERSION}`,
      }
    }
    const body = asRecord(res.data)
    const rows = asArray(body?.Result)
    for (const item of rows) {
      const rec = asRecord(item)
      if (!rec) continue
      const signal = ucdpEventSignal(rec)
      if (signal) signals.push(signal)
    }
    page += 1
    if (rows.length < PAGE_SIZE || page >= 8) break
  }
  const points = signals
    .map((row, index) => ({ i: index, lat: row.lat as number, lon: row.lon as number }))
  let assigned = new Map<number, { region_id: number; country_iso3: string | null }>()
  if (!ctx.dryRun && points.length) {
    try {
      assigned = await assignLatLonBatch(ctx.client, points)
    } catch (error) {
      ctx.log(`[ucdp] assign failed: ${error instanceof Error ? error.message : error}`)
    }
  }
  signals.forEach((row, index) => {
    const hit = assigned.get(index)
    const raw = row.value_raw ?? {}
    row.value_raw = { ...raw, lat: row.lat, lon: row.lon, region_id: hit?.region_id ?? null }
    row.country_iso3 = row.country_iso3 ?? hit?.country_iso3 ?? null
    row.lat = null
    row.lon = null
  })
  return {
    httpCalls,
    signals,
    cursor: { date_utc: today, requests_today: requests, backfill_done: true, version: UCDP_VERSION },
    quotaNote: `requests_today=${requests}/${UCDP_DAILY_CAP} version=${UCDP_VERSION} events=${signals.length} window=${start}..${end}`,
  }
}
