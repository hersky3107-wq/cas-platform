import { hazardsFromReliefwebTypes, hazardsOf } from '../../config/hazard-taxonomy'
import { buildDedupeKey } from '../dedupe'
import { asArray, asRecord, isoTime, politeFetch } from '../fetch'
import { loadStateSafe } from '../regions'
import type { CrisisSource, IngestFetchResult, NormalizedSignal } from '../types'
import { collapseSignals } from '../upsert'

/** ReliefWeb API v2 (https://apidoc.reliefweb.int/). POST with an approved appname. */
export const RELIEFWEB_API = 'https://api.reliefweb.int/v2'
export const RELIEFWEB_PAGE = 1000
export const RELIEFWEB_MAX_PAGES = 20
export const RELIEFWEB_BACKFILL_DAYS = 30

const REPORT_FIELDS = [
  'title',
  'url',
  'url_alias',
  'date.created',
  'date.original',
  'primary_country.iso3',
  'country.iso3',
  'disaster_type.name',
  'source.shortname',
  'disaster.name',
]

const DISASTER_FIELDS = [
  'name',
  'url',
  'url_alias',
  'status',
  'glide',
  'date.created',
  'date.event',
  'date.changed',
  'primary_country.iso3',
  'country.iso3',
  'type.name',
]

function names(value: unknown, key: string): string[] {
  return asArray(value)
    .map((item) => asRecord(item)?.[key])
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function iso3Of(value: unknown): string | null {
  const iso3 = asRecord(value)?.iso3
  return typeof iso3 === 'string' && iso3.length === 3 ? iso3.toUpperCase() : null
}

export function normalizeReliefwebReports(payload: unknown): NormalizedSignal[] {
  const out: NormalizedSignal[] = []
  for (const item of asArray(asRecord(payload)?.data)) {
    const row = asRecord(item)
    const fields = asRecord(row?.fields)
    if (!row || !fields || typeof fields.title !== 'string') continue
    const id = String(row.id ?? '')
    const date = asRecord(fields.date)
    const created = isoTime(date?.created)
    const original = isoTime(date?.original)
    const countries = asArray(fields.country).map(iso3Of).filter((iso3): iso3 is string => iso3 !== null)
    const primary = iso3Of(fields.primary_country) ?? countries[0] ?? null
    const types = names(fields.disaster_type, 'name')
    const hazards = [...new Set([...hazardsFromReliefwebTypes(types), ...hazardsOf(fields.title)])]
    out.push({
      department: 'humanitarian',
      source: 'reliefweb',
      signal_type: 'reliefweb_report',
      title: fields.title.slice(0, 300),
      lat: null,
      lon: null,
      country_iso3: primary,
      value_num: null,
      value_raw: {
        kind: 'report',
        id,
        countries,
        disaster_types: types,
        hazards,
        sources: names(fields.source, 'shortname').slice(0, 4),
        disasters: names(fields.disaster, 'name').slice(0, 3),
        date_original: original,
      },
      unit_raw: null,
      event_time: original ?? created,
      url: typeof fields.url_alias === 'string' ? fields.url_alias : typeof fields.url === 'string' ? fields.url : null,
      dedupe_key: buildDedupeKey({ source: 'reliefweb', signalType: 'reliefweb_report', id: `report:${id}` }),
    })
  }
  return out
}

export function normalizeReliefwebDisasters(payload: unknown): NormalizedSignal[] {
  const out: NormalizedSignal[] = []
  for (const item of asArray(asRecord(payload)?.data)) {
    const row = asRecord(item)
    const fields = asRecord(row?.fields)
    if (!row || !fields || typeof fields.name !== 'string') continue
    const id = String(row.id ?? '')
    const date = asRecord(fields.date)
    const countries = asArray(fields.country).map(iso3Of).filter((iso3): iso3 is string => iso3 !== null)
    const types = names(fields.type, 'name')
    const hazards = [...new Set([...hazardsFromReliefwebTypes(types), ...hazardsOf(fields.name)])]
    out.push({
      department: 'humanitarian',
      source: 'reliefweb',
      signal_type: 'reliefweb_report',
      title: fields.name.slice(0, 300),
      lat: null,
      lon: null,
      country_iso3: iso3Of(fields.primary_country) ?? countries[0] ?? null,
      value_num: null,
      value_raw: {
        kind: 'disaster',
        id,
        status: typeof fields.status === 'string' ? fields.status : null,
        glide: typeof fields.glide === 'string' ? fields.glide : null,
        countries,
        disaster_types: types,
        hazards,
        changed: isoTime(date?.changed),
      },
      unit_raw: null,
      event_time: isoTime(date?.event) ?? isoTime(date?.created),
      url: typeof fields.url_alias === 'string' ? fields.url_alias : typeof fields.url === 'string' ? fields.url : null,
      dedupe_key: buildDedupeKey({ source: 'reliefweb', signalType: 'reliefweb_report', id: `disaster:${id}` }),
    })
  }
  return out
}

/** ReliefWeb range filters reject milliseconds ("Invalid range 'from' value ... ISO 8601"). */
export function reliefwebDate(iso: string): string {
  return iso.replace(/\.\d{3}Z$/, '+00:00').replace(/Z$/, '+00:00')
}

export function reportsSince(cursor: Record<string, unknown> | null | undefined, now: Date): string {
  const stored = typeof cursor?.reports_since === 'string' ? Date.parse(cursor.reports_since) : NaN
  const floor = now.getTime() - RELIEFWEB_BACKFILL_DAYS * 86_400_000
  return new Date(Number.isFinite(stored) ? Math.max(stored - 3_600_000, floor) : floor).toISOString()
}

export const reliefwebSource: CrisisSource = {
  key: 'reliefweb',
  department: 'humanitarian',
  scheduleMinutes: 180,
  writes: 'signals',
  requiredEnv: ['RELIEFWEB_APPNAME'],
  async fetch(ctx): Promise<IngestFetchResult> {
    const app = encodeURIComponent(ctx.env.RELIEFWEB_APPNAME?.trim() ?? '')
    const state = ctx.dryRun ? null : await loadStateSafe(ctx.client, 'reliefweb')
    const since = reportsSince(state?.cursor, ctx.now)
    const signals: NormalizedSignal[] = []
    const notes: string[] = []
    let httpCalls = 0
    let newest = since
    let pages = 0
    for (let offset = 0; pages < RELIEFWEB_MAX_PAGES; offset += RELIEFWEB_PAGE) {
      const res = await politeFetch(`${RELIEFWEB_API}/reports?appname=${app}`, {
        sourceKey: 'reliefweb',
        minIntervalMs: 1000,
        timeoutMs: 45_000,
        method: 'POST',
        body: JSON.stringify({
          limit: RELIEFWEB_PAGE,
          offset,
          sort: ['date.created:desc'],
          fields: { include: REPORT_FIELDS },
          filter: { field: 'date.created', value: { from: reliefwebDate(since) } },
        }),
      })
      httpCalls += 1
      pages += 1
      if (!res.ok) {
        notes.push(`reports HTTP ${res.status}`)
        break
      }
      const rows = normalizeReliefwebReports(res.data)
      signals.push(...rows)
      for (const item of asArray(asRecord(res.data)?.data)) {
        const created = isoTime(asRecord(asRecord(asRecord(item)?.fields)?.date)?.created)
        if (created && created > newest) newest = created
      }
      if (rows.length < RELIEFWEB_PAGE) break
    }
    if (pages >= RELIEFWEB_MAX_PAGES) notes.push(`page cap ${RELIEFWEB_MAX_PAGES}`)

    const changedSince = new Date(ctx.now.getTime() - RELIEFWEB_BACKFILL_DAYS * 86_400_000).toISOString()
    const disasters = await politeFetch(`${RELIEFWEB_API}/disasters?appname=${app}`, {
      sourceKey: 'reliefweb',
      minIntervalMs: 1000,
      timeoutMs: 45_000,
      method: 'POST',
      body: JSON.stringify({
        limit: 500,
        sort: ['date.changed:desc'],
        fields: { include: DISASTER_FIELDS },
        filter: { field: 'date.changed', value: { from: reliefwebDate(changedSince) } },
      }),
    })
    httpCalls += 1
    if (disasters.ok) signals.push(...normalizeReliefwebDisasters(disasters.data))
    else notes.push(`disasters HTTP ${disasters.status}`)

    const collapsed = collapseSignals(signals)
    if (!collapsed.length && notes.length) return { httpCalls, error: notes.join('; ') }
    return {
      httpCalls,
      signals: collapsed,
      cursor: { reports_since: newest },
      quotaNote: [`n=${collapsed.length}`, `since=${since.slice(0, 16)}`, notes.join('; ') || null].filter(Boolean).join('; '),
    }
  },
}
