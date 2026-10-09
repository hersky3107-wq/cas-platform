import { asArray, asRecord, isoTime, politeFetch } from '../fetch'
import { toIso3 } from '../iso'
import type { CrisisSource, IngestFetchResult, NormalizedSignal } from '../types'
import { collapseSignals } from '../upsert'

/** Cloudflare Radar outage annotations (https://developers.cloudflare.com/api/resources/radar/subresources/annotations/). */
export const CLOUDFLARE_OUTAGES_URL = 'https://api.cloudflare.com/client/v4/radar/annotations/outages'

const TYPE_SCORE: Record<string, number> = {
  NATIONWIDE: 4,
  REGIONAL: 3,
  NETWORK: 2,
  PLATFORM: 1,
}

function locationsOf(row: Record<string, unknown>): string[] {
  const direct = asArray(row.locations).filter((code): code is string => typeof code === 'string')
  if (direct.length) return direct
  const details = asArray(row.locationsDetails)
    .map((item) => asRecord(item)?.code)
    .filter((code): code is string => typeof code === 'string')
  if (details.length) return details
  return [...new Set(
    asArray(row.asnsDetails)
      .map((item) => asRecord(asRecord(item)?.location)?.code)
      .filter((code): code is string => typeof code === 'string'),
  )]
}

/** One signal per annotation and country. Annotations without a country are dropped. */
export function normalizeCloudflareOutages(payload: unknown): { signals: NormalizedSignal[]; noCountry: number } {
  const result = asRecord(asRecord(payload)?.result)
  const signals: NormalizedSignal[] = []
  let noCountry = 0
  for (const item of asArray(result?.annotations)) {
    const row = asRecord(item)
    if (!row) continue
    const id = String(row.id ?? '')
    const outage = asRecord(row.outage)
    const type = typeof outage?.outageType === 'string' ? outage.outageType : null
    const cause = typeof outage?.outageCause === 'string' ? outage.outageCause : null
    const start = isoTime(row.startDate)
    const end = isoTime(row.endDate)
    const codes = locationsOf(row)
    if (!codes.length) {
      noCountry += 1
      continue
    }
    for (const code of codes) {
      const iso3 = toIso3(code)
      if (!iso3) continue
      const description = typeof row.description === 'string' ? row.description : ''
      signals.push({
        department: 'connectivity',
        source: 'cloudflare',
        signal_type: 'internet_outage',
        title: [iso3, type?.toLowerCase(), cause?.toLowerCase().replace(/_/g, ' '), description.slice(0, 120)].filter(Boolean).join(' '),
        lat: null,
        lon: null,
        country_iso3: iso3,
        value_num: type ? TYPE_SCORE[type] ?? null : null,
        value_raw: {
          annotation_id: id,
          outage_type: type,
          outage_cause: cause,
          description: description.slice(0, 300),
          from: start,
          until: end,
          asns: asArray(row.asns).length,
          linked_url: typeof row.linkedUrl === 'string' ? row.linkedUrl : null,
          event_type: typeof row.eventType === 'string' ? row.eventType : null,
        },
        unit_raw: 'cloudflare_outage_type',
        event_time: start,
        url: `https://radar.cloudflare.com/outage-center#${id}`,
        dedupe_key: ['cloudflare', 'internet_outage', id, iso3].join('|'),
      })
    }
  }
  return { signals, noCountry }
}

export const cloudflareRadarSource: CrisisSource = {
  key: 'cloudflare_radar',
  department: 'connectivity',
  scheduleMinutes: 30,
  writes: 'signals',
  requiredEnv: ['CLOUDFLARE_RADAR_TOKEN'],
  async fetch(ctx): Promise<IngestFetchResult> {
    const res = await politeFetch(`${CLOUDFLARE_OUTAGES_URL}?dateRange=7d&limit=200&format=json`, {
      sourceKey: 'cloudflare_radar',
      minIntervalMs: 1000,
      headers: { Authorization: `Bearer ${ctx.env.CLOUDFLARE_RADAR_TOKEN?.trim() ?? ''}` },
    })
    if (!res.ok) return { httpCalls: 1, error: `outages HTTP ${res.status}` }
    const { signals, noCountry } = normalizeCloudflareOutages(res.data)
    const collapsed = collapseSignals(signals)
    return {
      httpCalls: 1,
      signals: collapsed,
      quotaNote: [`n=${collapsed.length}`, noCountry ? `no_country=${noCountry}` : null].filter(Boolean).join('; '),
    }
  },
}
