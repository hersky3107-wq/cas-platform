import 'server-only'

import { extract, type ExtractedContent } from '@/lib/extract'

/**
 * Jeju public-data connector registry.
 *
 * DESIGN CONSTRAINT — loosely coupled & self-contained:
 *   This module is the data backbone for a future Jeju governance site. It may
 *   import from `lib/extract`, but it must NOT be imported by or wired into any
 *   existing AIMANI module, router, or credit system. Keeping the dependency
 *   arrow one-directional (jeju → extract, never extract → jeju, never
 *   aimani → jeju) means the whole `lib/jeju` folder can later be lifted into a
 *   standalone project with only `lib/extract` coming along for the ride.
 */

export type JejuSourceFormat = 'xml' | 'json' | 'csv'

export type JejuMode = 'governance' | 'tourist' | 'resident'

export interface JejuSource {
  /** Stable identifier used by `fetchJejuSource`. */
  id: string
  /** Human-readable label. */
  label: string
  /** Builds the full request URL (including any service key from the env). */
  buildUrl: () => string
  /** Expected response format, routed through the extract json-api adapter. */
  format: JejuSourceFormat
  /** Which Jeju site mode(s) this source serves. */
  modes: JejuMode[]
  /**
   * Optional JSON post-filter. When present (and `format === 'json'`), the
   * source is fetched + filtered + rendered inside this module instead of going
   * through `extract`, so only the trimmed JSON reaches the final text. Used to
   * keep token-heavy APIs (e.g. KAMIS) down to a Jeju-relevant subset.
   *
   * Receives the parsed response JSON and returns a trimmed JSON value.
   */
  filter?: (rawJson: unknown) => unknown
  /**
   * Optional custom renderer. When present (and `format === 'json'`), the source
   * is fetched + rendered inside this module via this function instead of going
   * through `extract`. Used for APIs whose success check and output shape are
   * bespoke (e.g. KMA weather: nested resultCode + cryptic category codes).
   *
   * Receives the parsed response JSON and returns either rendered `text` or an
   * `error` string (e.g. when the API's nested resultCode signals failure).
   */
  render?: (rawJson: unknown) => { text: string } | { error: string }
}

/**
 * Jeju product allowlist for the KAMIS price feed. Matched as a substring
 * against `item_name` (e.g. "갈치/국산(냉장)(大)" matches "갈치"). Edit freely.
 */
export const JEJU_KAMIS_ITEMS: readonly string[] = [
  '양배추',
  '당근',
  '무',
  '깐마늘',
  '마늘',
  '양파',
  '브로콜리',
  '감자',
  '고구마',
  '갈치',
  '고등어',
  '전복',
  '돼지',
  '한라봉',
  '감귤',
] as const

/** Keeps only KAMIS price items whose item_name matches the Jeju allowlist. */
function filterKamisJejuItems(rawJson: unknown): unknown {
  if (!rawJson || typeof rawJson !== 'object') return rawJson
  const obj = rawJson as Record<string, unknown>

  const price = Array.isArray(obj.price) ? (obj.price as Record<string, unknown>[]) : null
  if (!price) return rawJson

  const kept = price.filter((row) => {
    const name = typeof row?.item_name === 'string' ? row.item_name : ''
    return JEJU_KAMIS_ITEMS.some((allowed) => name.includes(allowed))
  })

  return { error_code: obj.error_code, price: kept }
}

/**
 * Computes the KMA 초단기실황 base_date/base_time at call time.
 *
 * 초단기실황 publishes hourly at HH00 and is available ~40min later, so if the
 * current Korea-time minute is < 45 we step back one hour (handling the midnight
 * date rollover). Returns { baseDate: 'YYYYMMDD', baseTime: 'HH00' }.
 */
function kmaBaseDateTime(now: Date = new Date()): { baseDate: string; baseTime: string } {
  // Korea is UTC+9, with no DST. Shift from epoch to avoid host-timezone issues.
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  let year = kst.getUTCFullYear()
  let month = kst.getUTCMonth()
  let day = kst.getUTCDate()
  let hour = kst.getUTCHours()
  const minute = kst.getUTCMinutes()

  if (minute < 45) {
    // Step back one hour; rebuild via UTC math to handle midnight/month rollover.
    const stepped = new Date(Date.UTC(year, month, day, hour, 0, 0) - 60 * 60 * 1000)
    year = stepped.getUTCFullYear()
    month = stepped.getUTCMonth()
    day = stepped.getUTCDate()
    hour = stepped.getUTCHours()
  }

  const pad = (n: number) => String(n).padStart(2, '0')
  const baseDate = `${year}${pad(month + 1)}${pad(day)}`
  const baseTime = `${pad(hour)}00`
  return { baseDate, baseTime }
}

/** KMA short-term observation category codes → Korean label + unit. */
const KMA_CATEGORY_LABELS: Record<string, { label: string; unit: string }> = {
  T1H: { label: '기온', unit: '℃' },
  RN1: { label: '1시간 강수량', unit: 'mm' },
  REH: { label: '습도', unit: '%' },
  WSD: { label: '풍속', unit: 'm/s' },
  VEC: { label: '풍향', unit: '°' },
  PTY: { label: '강수형태', unit: '' },
  UUU: { label: '동서바람성분', unit: 'm/s' },
  VVV: { label: '남북바람성분', unit: 'm/s' },
}

/** PTY (강수형태) code → Korean description. */
const KMA_PTY_LABELS: Record<string, string> = {
  '0': '없음',
  '1': '비',
  '2': '비/눈',
  '3': '눈',
  '5': '빗방울',
  '6': '빗방울눈날림',
  '7': '눈날림',
}

/**
 * Renders KMA 초단기실황 JSON into a clean, AI-readable Korean summary.
 * Checks the nested response.header.resultCode ('00' = success).
 */
function renderKmaWeather(rawJson: unknown): { text: string } | { error: string } {
  if (!rawJson || typeof rawJson !== 'object') {
    return { error: 'Unexpected KMA response shape' }
  }

  const response = (rawJson as Record<string, unknown>).response
  if (!response || typeof response !== 'object') {
    return { error: 'Missing response in KMA payload' }
  }
  const resp = response as Record<string, unknown>

  const header =
    resp.header && typeof resp.header === 'object' ? (resp.header as Record<string, unknown>) : null
  const resultCode = header ? header.resultCode : undefined
  const resultMsg = header && typeof header.resultMsg === 'string' ? header.resultMsg : ''
  const code = typeof resultCode === 'string' || typeof resultCode === 'number' ? String(resultCode) : ''

  if (code !== '00') {
    return { error: `KMA resultCode ${code || 'missing'}${resultMsg ? `: ${resultMsg}` : ''}` }
  }

  const body =
    resp.body && typeof resp.body === 'object' ? (resp.body as Record<string, unknown>) : null
  const itemsContainer =
    body && body.items && typeof body.items === 'object'
      ? (body.items as Record<string, unknown>)
      : null
  const itemRaw = itemsContainer ? itemsContainer.item : null
  const items: Record<string, unknown>[] = Array.isArray(itemRaw)
    ? (itemRaw as Record<string, unknown>[])
    : itemRaw && typeof itemRaw === 'object'
      ? [itemRaw as Record<string, unknown>]
      : []

  if (items.length === 0) {
    return { error: 'No observation items in KMA response' }
  }

  let baseDate = ''
  let baseTime = ''
  const readings: string[] = []
  for (const item of items) {
    const category = typeof item.category === 'string' ? item.category : ''
    const value = item.obsrValue
    if (typeof item.baseDate === 'string') baseDate = item.baseDate
    if (typeof item.baseTime === 'string') baseTime = item.baseTime
    if (!category) continue

    const meta = KMA_CATEGORY_LABELS[category]
    const valueStr = value === null || value === undefined ? '' : String(value)

    if (category === 'PTY') {
      const desc = KMA_PTY_LABELS[valueStr] ?? valueStr
      readings.push(`${meta?.label ?? category}: ${desc}`)
    } else if (meta) {
      readings.push(`${meta.label}: ${valueStr}${meta.unit}`)
    } else {
      readings.push(`${category}: ${valueStr}`)
    }
  }

  if (readings.length === 0) {
    return { error: 'No recognizable readings in KMA response' }
  }

  const when = baseDate && baseTime ? `${baseDate} ${baseTime}` : ''
  const headerLine = `제주시 초단기실황${when ? ` (관측: ${when})` : ''}`
  return { text: `${headerLine}\n${readings.join(', ')}` }
}

/**
 * Registered Jeju data sources.
 *
 * To add a source: append a `JejuSource` entry below. `buildUrl` should read any
 * secret strictly from `process.env` (never hardcode keys). Once registered, the
 * source is immediately fetchable via `fetchJejuSource(id)` and listable via
 * `listJejuSources(mode)`.
 */
const JEJU_SOURCES: readonly JejuSource[] = [
  {
    id: 'kpx-jeju-power',
    label: 'KPX Jeju 5-minute Power Supply',
    format: 'xml',
    modes: ['governance', 'resident'],
    buildUrl: () => {
      const key = process.env.KPX_SERVICE_KEY ?? ''
      return `https://openapi.kpx.or.kr/openapi/chejusukub5mToday/getChejuSukub5mToday?serviceKey=${encodeURIComponent(key)}`
    },
  },

  {
    id: 'kamis-jeju-products',
    label: 'KAMIS Jeju Agricultural & Marine Prices',
    format: 'json',
    modes: ['governance', 'resident'],
    buildUrl: () => {
      const certKey = process.env.KAMIS_CERT_KEY ?? ''
      const certId = process.env.KAMIS_CERT_ID ?? ''
      const params = new URLSearchParams({
        action: 'dailySalesList',
        p_cert_key: certKey,
        p_cert_id: certId,
        p_returntype: 'json',
      })
      return `http://www.kamis.or.kr/service/price/xml.do?${params.toString()}`
    },
    filter: filterKamisJejuItems,
  },

  {
    id: 'kma-jeju-weather',
    label: 'KMA Jeju Short-term Weather (초단기실황)',
    format: 'json',
    modes: ['governance', 'resident', 'tourist'],
    buildUrl: () => {
      // Shares the data.go.kr key with KPX. DATA_GO_KR_KEY can override later
      // if the keys ever diverge; defaults to KPX_SERVICE_KEY today.
      const key = process.env.DATA_GO_KR_KEY ?? process.env.KPX_SERVICE_KEY ?? ''
      const { baseDate, baseTime } = kmaBaseDateTime()
      const params = new URLSearchParams({
        serviceKey: key,
        dataType: 'JSON',
        base_date: baseDate,
        base_time: baseTime,
        nx: '52',
        ny: '38',
        numOfRows: '100',
        pageNo: '1',
      })
      return `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst?${params.toString()}`
    },
    render: renderKmaWeather,
  },

  // ── Registry slots for upcoming sources (NOT yet implemented) ─────────────
  // Add each as a JejuSource entry following the patterns above. Read the
  // service key from process.env; pick the correct `format`; set `modes`.
  //
  // TODO: 제주 traffic — real-time road/traffic conditions
  //   env: JEJU_TRAFFIC_SERVICE_KEY
  //   format: 'json' ; modes: ['governance','resident','tourist']
] as const

/** Returns the registered source for `id`, or null if unknown. */
function getJejuSource(id: string): JejuSource | null {
  return JEJU_SOURCES.find((s) => s.id === id) ?? null
}

/**
 * Lists registered Jeju sources, optionally filtered by mode.
 * Returns lightweight descriptors (no `buildUrl`) safe to expose to a UI.
 */
export function listJejuSources(
  mode?: JejuMode
): Array<Pick<JejuSource, 'id' | 'label' | 'format' | 'modes'>> {
  const filtered = mode ? JEJU_SOURCES.filter((s) => s.modes.includes(mode)) : JEJU_SOURCES
  return filtered.map(({ id, label, format, modes }) => ({ id, label, format, modes }))
}

const MAX_TEXT_LENGTH = 20_000
const FETCH_TIMEOUT_MS = 10_000

/** Builds a failed ExtractedContent without throwing. */
function failResult(sourceLabel: string, title: string | null, error: string): ExtractedContent {
  return {
    sourceType: 'json-api',
    title,
    text: '',
    fetchedAt: new Date().toISOString(),
    sourceLabel,
    truncated: false,
    ok: false,
    error,
  }
}

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return ''
    }
  }
  return String(value).replace(/\s+/g, ' ').trim()
}

/** Renders an array of row objects as a markdown table (union of keys, first-seen order). */
function rowsToTable(rows: Record<string, unknown>[]): string {
  const columns: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key)
        columns.push(key)
      }
    }
  }
  if (columns.length === 0) return ''

  const header = `| ${columns.join(' | ')} |`
  const divider = `| ${columns.map(() => '---').join(' | ')} |`
  const body = rows.map((row) => `| ${columns.map((c) => renderCell(row[c])).join(' | ')} |`)
  return [header, divider, ...body].join('\n')
}

/** Wraps rendered text into a standard ExtractedContent (applies truncation). */
function okResult(sourceLabel: string, title: string | null, fullText: string): ExtractedContent {
  const truncated = fullText.length > MAX_TEXT_LENGTH
  return {
    sourceType: 'json-api',
    title,
    text: truncated ? fullText.slice(0, MAX_TEXT_LENGTH) : fullText,
    fetchedAt: new Date().toISOString(),
    sourceLabel,
    truncated,
    ok: true,
  }
}

/**
 * Shared network fetch + JSON parse used by the dedicated source paths. Kept
 * inside this module (rather than threaded into `extract`) so the generic
 * extract layer stays unaware of Jeju-specific trimming/rendering. Never throws.
 */
async function fetchAndParseJson(
  source: JejuSource
): Promise<{ ok: true; parsed: unknown } | { ok: false; result: ExtractedContent }> {
  const sourceLabel = source.id
  const title = source.label

  let url: URL
  try {
    url = new URL(source.buildUrl())
  } catch {
    return { ok: false, result: failResult(sourceLabel, title, `Invalid URL for source: ${source.id}`) }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AIMANI-Extractor/1.0)',
        Accept: 'application/json,text/json,*/*;q=0.8',
      },
    })
  } catch (e: unknown) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    return {
      ok: false,
      result: failResult(
        sourceLabel,
        title,
        aborted
          ? `Request timed out after ${FETCH_TIMEOUT_MS}ms`
          : `Network error: ${e instanceof Error ? e.message : 'unknown error'}`
      ),
    }
  } finally {
    clearTimeout(timeout)
  }

  if (!res.ok) {
    return {
      ok: false,
      result: failResult(sourceLabel, title, `Fetch failed: HTTP ${res.status} ${res.statusText}`.trim()),
    }
  }

  let raw: string
  try {
    raw = await res.text()
  } catch (e: unknown) {
    return {
      ok: false,
      result: failResult(
        sourceLabel,
        title,
        `Could not read response body: ${e instanceof Error ? e.message : 'unknown error'}`
      ),
    }
  }

  if (raw.trim() === '') {
    return { ok: false, result: failResult(sourceLabel, title, 'Empty response body') }
  }

  try {
    return { ok: true, parsed: JSON.parse(raw) }
  } catch (e: unknown) {
    return {
      ok: false,
      result: failResult(
        sourceLabel,
        title,
        `JSON parse error: ${e instanceof Error ? e.message : 'unknown error'}`
      ),
    }
  }
}

/**
 * Dedicated path for JSON sources that declare a `filter`: fetch, check the
 * KAMIS-style top-level error_code, apply the filter, render as a table.
 */
async function fetchFilteredJson(source: JejuSource): Promise<ExtractedContent> {
  const sourceLabel = source.id
  const title = source.label

  const fetched = await fetchAndParseJson(source)
  if (!fetched.ok) return fetched.result
  const parsed = fetched.parsed

  // KAMIS surfaces auth/quota problems via error_code (success is "000").
  const errorCode =
    parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>).error_code
      : undefined
  if (typeof errorCode === 'string' && errorCode.trim() !== '' && errorCode.trim() !== '000') {
    return failResult(sourceLabel, title, `API error_code ${errorCode}`)
  }

  const filtered = source.filter ? source.filter(parsed) : parsed

  // Render the filtered JSON: prefer a table when there is a row array.
  const filteredObj =
    filtered && typeof filtered === 'object' ? (filtered as Record<string, unknown>) : null
  const rows =
    filteredObj && Array.isArray(filteredObj.price)
      ? (filteredObj.price as Record<string, unknown>[])
      : Array.isArray(filtered)
        ? (filtered as Record<string, unknown>[])
        : null

  if (rows && rows.length === 0) {
    return failResult(sourceLabel, title, 'No matching items after Jeju filter')
  }

  let fullText: string
  if (rows && rows.length > 0) {
    fullText = rowsToTable(rows)
  } else {
    try {
      fullText = JSON.stringify(filtered, null, 2).trim()
    } catch {
      fullText = String(filtered)
    }
  }

  return okResult(sourceLabel, title, fullText)
}

/**
 * Dedicated path for JSON sources that declare a custom `render`: fetch, then
 * delegate success-check + formatting to the source's renderer (e.g. KMA's
 * nested resultCode + category-code mapping).
 */
async function fetchRenderedJson(source: JejuSource): Promise<ExtractedContent> {
  const sourceLabel = source.id
  const title = source.label

  const fetched = await fetchAndParseJson(source)
  if (!fetched.ok) return fetched.result

  const rendered = source.render!(fetched.parsed)
  if ('error' in rendered) {
    return failResult(sourceLabel, title, rendered.error)
  }
  return okResult(sourceLabel, title, rendered.text)
}

/**
 * Fetches a registered Jeju source by id.
 *
 * Sources with a `render` or `filter` (and `format === 'json'`) use a dedicated
 * fetch+format path in this module (so `extract` stays generic and
 * Jeju-agnostic). All others go through the shared `extract` json-api adapter.
 *
 * Never throws: an unknown id or any fetch/parse failure comes back as an
 * `ExtractedContent` with `ok: false` (including Korean public-API resultCode /
 * error_code failures).
 */
export async function fetchJejuSource(id: string): Promise<ExtractedContent> {
  const source = getJejuSource(id)
  if (!source) {
    return failResult(id, null, `unknown Jeju source: ${id}`)
  }

  if (source.format === 'json' && source.render) {
    return fetchRenderedJson(source)
  }

  if (source.format === 'json' && source.filter) {
    return fetchFilteredJson(source)
  }

  return extract({
    type: 'json-api',
    value: source.buildUrl(),
    meta: {
      format: source.format,
      title: source.label,
      sourceLabel: source.id,
    },
  })
}
