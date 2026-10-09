import { asArray, asRecord, finiteNumber, isoTime, politeFetch } from '../fetch'
import { toIso3 } from '../iso'
import { loadCountryIdByIso3 } from '../regions'
import type { CrisisSource, IngestFetchResult, NormalizedSignal } from '../types'
import { collapseSignals } from '../upsert'

/** Official IODA v2 outage endpoints (https://api.ioda.inetintel.cc.gatech.edu/v2/). */
export const IODA_ALERTS_URL = 'https://api.ioda.inetintel.cc.gatech.edu/v2/outages/alerts'
export const IODA_EVENTS_URL = 'https://api.ioda.inetintel.cc.gatech.edu/v2/outages/events'
export const IODA_ROW_CAP = 500

function levelScore(level: string | null): number | null {
  if (!level) return null
  const key = level.toLowerCase()
  if (key === 'critical' || key === 'severe') return 4
  if (key === 'warning' || key === 'major') return 3
  if (key === 'normal' || key === 'minor') return 2
  if (key === 'watch' || key === 'info') return 1
  return null
}

function datasourceLabel(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(datasourceLabel).filter(Boolean).sort().join('+')
  const rec = asRecord(value)
  if (typeof rec?.name === 'string') return rec.name
  if (value == null) return ''
  return String(value)
}

/** Stable key: entity type, entity code, datasource, alert/event start. */
export function iodaDedupeKey(parts: {
  entityType: string | null
  entityCode: string | null
  datasource: string
  start: string | null
}): string {
  return ['ioda', 'internet_outage', parts.entityType ?? '', parts.entityCode ?? '', parts.datasource, parts.start ?? ''].join('|')
}

function entityOf(rec: Record<string, unknown>): { code: string | null; type: string | null; name: string | null } {
  const nested = asRecord(rec.entity)
  const code = typeof rec.entityCode === 'string'
    ? rec.entityCode
    : typeof nested?.code === 'string'
      ? nested.code
      : typeof rec.code === 'string'
        ? rec.code
        : null
  const type = typeof rec.entityType === 'string'
    ? rec.entityType
    : typeof nested?.type === 'string'
      ? nested.type
      : typeof rec.type === 'string'
        ? rec.type
        : null
  const name = typeof rec.entityName === 'string'
    ? rec.entityName
    : typeof nested?.name === 'string'
      ? nested.name
      : typeof rec.name === 'string'
        ? rec.name
        : null
  return { code, type, name }
}

export function normalizeIodaOutages(
  payload: unknown,
  kind: 'alert' | 'event',
  countryIds: Map<string, number>,
  cap = IODA_ROW_CAP,
): NormalizedSignal[] {
  const rec = asRecord(payload)
  const rows = asArray(rec?.data ?? rec?.alerts ?? rec?.events ?? payload)
  const out: NormalizedSignal[] = []
  for (const item of rows) {
    if (out.length >= cap) break
    const row = asRecord(item)
    if (!row) continue
    const entity = entityOf(row)
    const iso3 = toIso3(entity.code)
    const score = finiteNumber(row.score ?? row.value ?? row.severity) ?? levelScore(typeof row.level === 'string' ? row.level : null)
    const from = isoTime(row.from ?? row.start ?? row.time)
    const until = isoTime(row.until ?? row.end)
    const datasource = datasourceLabel(row.datasource ?? row.datasources)
    const regionId = iso3 ? countryIds.get(iso3) ?? null : null
    out.push({
      department: 'connectivity',
      source: 'ioda',
      signal_type: 'internet_outage',
      title: [entity.name ?? entity.code, kind, row.level ?? row.datasource].filter(Boolean).join(' '),
      lat: null,
      lon: null,
      country_iso3: iso3,
      value_num: score,
      value_raw: {
        kind,
        entity_type: entity.type,
        entity_code: entity.code,
        entity_name: entity.name,
        level: row.level ?? null,
        datasource,
        from,
        until,
        region_id: regionId,
        score,
      },
      unit_raw: 'ioda_score',
      event_time: from,
      url: 'https://ioda.inetintel.cc.gatech.edu/',
      dedupe_key: iodaDedupeKey({
        entityType: entity.type,
        entityCode: entity.code,
        datasource,
        start: from,
      }),
    })
  }
  return out
}

function windowUnix(now: Date): { from: number; until: number } {
  const until = Math.floor(now.getTime() / 1000)
  return { from: until - 45 * 60, until }
}

export const iodaSource: CrisisSource = {
  key: 'ioda',
  department: 'connectivity',
  scheduleMinutes: 30,
  writes: 'signals',
  async fetch(ctx): Promise<IngestFetchResult> {
    const countryIds = await loadCountryIdByIso3(ctx.client).catch(() => new Map<string, number>())
    const { from, until } = windowUnix(ctx.now)
    const qs = `from=${from}&until=${until}&limit=${IODA_ROW_CAP}`
    let httpCalls = 0
    const signals: NormalizedSignal[] = []
    const notes: string[] = []

    const alerts = await politeFetch(`${IODA_ALERTS_URL}?${qs}`, {
      sourceKey: 'ioda',
      minIntervalMs: 1500,
    })
    httpCalls += 1
    if (!alerts.ok) notes.push(`alerts HTTP ${alerts.status}`)
    else signals.push(...normalizeIodaOutages(alerts.data, 'alert', countryIds))

    const events = await politeFetch(`${IODA_EVENTS_URL}?${qs}`, {
      sourceKey: 'ioda',
      minIntervalMs: 1500,
    })
    httpCalls += 1
    if (!events.ok) notes.push(`events HTTP ${events.status}`)
    else signals.push(...normalizeIodaOutages(events.data, 'event', countryIds))

    const collapsed = collapseSignals(signals)
    const removed = signals.length - collapsed.length
    if (removed) ctx.log(`[ioda] collapsed ${removed} duplicates`)
    if (!collapsed.length && notes.length) {
      return { httpCalls, error: notes.join('; ') }
    }
    return {
      httpCalls,
      signals: collapsed,
      quotaNote: [`n=${collapsed.length}`, removed ? `collapsed=${removed}` : null, notes.join('; ') || null]
        .filter(Boolean)
        .join('; '),
    }
  },
}
