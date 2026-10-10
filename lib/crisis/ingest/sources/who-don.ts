import { countriesInText } from './advisories'
import { asArray, asRecord, isoTime, politeFetch } from '../fetch'
import { buildDedupeKey } from '../dedupe'
import { diseaseFromTitle } from '../../score/more-hazards'
import type { CrisisSource, IngestFetchResult, NormalizedSignal } from '../types'

export const WHO_DON_URL = 'https://www.who.int/api/news/diseaseoutbreaknews?$orderby=PublicationDate%20desc&$top=40'

export function normalizeWhoDon(payload: unknown, now: Date): NormalizedSignal[] {
  const rows = asArray(asRecord(payload)?.value)
  const cutoff = now.getTime() - 45 * 86_400_000
  const out: NormalizedSignal[] = []
  for (const item of rows) {
    const row = asRecord(item)
    if (!row) continue
    const title = typeof row.Title === 'string' ? row.Title : ''
    if (!title) continue
    const published = isoTime(row.PublicationDate ?? row.PublicationDateAndTime)
    if (published && Date.parse(published) < cutoff) continue
    const summary = typeof row.Summary === 'string' ? row.Summary : ''
    const disease = diseaseFromTitle(title)
    const countries = countriesInText(`${title} ${summary}`)
    const donId = typeof row.DonId === 'string' ? row.DonId : typeof row.UrlName === 'string' ? row.UrlName : title
    const path = typeof row.ItemDefaultUrl === 'string' ? row.ItemDefaultUrl : ''
    for (const iso3 of countries) {
      out.push({
        department: 'health',
        source: 'who_don',
        signal_type: 'outbreak',
        title: disease.slice(0, 120),
        lat: null,
        lon: null,
        country_iso3: iso3,
        value_num: 1,
        value_raw: { disease },
        unit_raw: 'outbreak',
        event_time: published,
        url: path ? `https://www.who.int${path}` : 'https://www.who.int/emergencies/disease-outbreak-news',
        dedupe_key: buildDedupeKey({
          source: 'who_don',
          signalType: 'outbreak',
          id: `${donId}|${iso3}`,
          eventTime: published,
        }),
      })
    }
  }
  return out
}

export const whoDonSource: CrisisSource = {
  key: 'who_don',
  department: 'health',
  scheduleMinutes: 360,
  writes: 'signals',
  async fetch(ctx): Promise<IngestFetchResult> {
    const res = await politeFetch(WHO_DON_URL, { sourceKey: 'who_don', minIntervalMs: 1500 })
    if (!res.ok) return { httpCalls: 1, error: res.error ?? `HTTP ${res.status}` }
    const signals = normalizeWhoDon(res.data, ctx.now)
    return { httpCalls: 1, signals, quotaNote: `outbreaks=${signals.length}` }
  },
}
