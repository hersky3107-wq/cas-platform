import { buildDedupeKey } from '../dedupe'
import { asArray, asRecord, finiteNumber, politeFetch } from '../fetch'
import { weekProbabilities } from '../../precursors/oaf'
import type { CrisisSource, IngestFetchResult, NormalizedSignal } from '../types'

const QUERY =
  'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minmagnitude=6&orderby=time&limit=8'

export function oafDetailUrl(id: string): string {
  return `https://earthquake.usgs.gov/fdsnws/event/1/query?eventid=${encodeURIComponent(id)}&format=geojson`
}

export const usgsOafSource: CrisisSource = {
  key: 'usgs_oaf',
  department: 'geology',
  scheduleMinutes: 180,
  writes: 'signals',
  async fetch(ctx): Promise<IngestFetchResult> {
    const start = new Date(ctx.now.getTime() - 10 * 86_400_000).toISOString().slice(0, 10)
    const listUrl = `${QUERY}&starttime=${encodeURIComponent(start)}`
    const list = await politeFetch(listUrl, { sourceKey: 'usgs_oaf', minIntervalMs: 1500, timeoutMs: 40_000 })
    if (!list.ok) return { httpCalls: 1, error: list.error ?? `HTTP ${list.status}` }
    const features = asArray(asRecord(list.data)?.features)
    const signals: NormalizedSignal[] = []
    let httpCalls = 1
    let missing = 0
    for (const item of features) {
      const feat = asRecord(item)
      const id = typeof feat?.id === 'string' ? feat.id : null
      if (!id) continue
      httpCalls += 1
      const detail = await politeFetch(oafDetailUrl(id), { sourceKey: 'usgs_oaf', minIntervalMs: 1200, timeoutMs: 40_000 })
      if (!detail.ok) {
        missing += 1
        continue
      }
      const props = asRecord(asRecord(detail.data)?.properties) ?? {}
      const products = asRecord(props.products)
      const oaf = asRecord(asArray(products?.oaf)[0])
      const contents = asRecord(oaf?.contents)
      const forecastUrl = typeof asRecord(contents?.['forecast.json'])?.url === 'string'
        ? (asRecord(contents?.['forecast.json'])?.url as string)
        : null
      if (!forecastUrl) {
        missing += 1
        continue
      }
      httpCalls += 1
      const forecast = await politeFetch(forecastUrl, { sourceKey: 'usgs_oaf', minIntervalMs: 800, timeoutMs: 40_000 })
      if (!forecast.ok) {
        missing += 1
        continue
      }
      const week = weekProbabilities(forecast.data)
      if (!week) {
        missing += 1
        continue
      }
      const coords = asArray(asRecord(asRecord(detail.data)?.geometry)?.coordinates)
      const lon = finiteNumber(coords[0])
      const lat = finiteNumber(coords[1])
      const mag = finiteNumber(props.mag)
      const eventTime = typeof props.time === 'number' ? new Date(props.time).toISOString() : ctx.now.toISOString()
      signals.push({
        department: 'geology',
        source: 'usgs_oaf',
        signal_type: 'aftershock_forecast',
        title: `M${mag ?? '?'} aftershock week`,
        lat,
        lon,
        country_iso3: null,
        value_num: mag,
        value_raw: {
          event_id: id,
          mag,
          m5: week.m5,
          m6: week.m6,
          m7: week.m7,
          forecast: 'probability',
          place: props.place ?? null,
        },
        unit_raw: 'probability',
        event_time: eventTime,
        url: forecastUrl,
        dedupe_key: buildDedupeKey({
          source: 'usgs_oaf',
          signalType: 'aftershock_forecast',
          id,
          lat,
          lon,
          eventTime,
        }),
      })
    }
    return {
      httpCalls,
      signals,
      quotaNote: `m6=${features.length} forecasts=${signals.length} without_oaf=${missing}`,
    }
  },
}
