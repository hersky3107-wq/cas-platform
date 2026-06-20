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
  /**
   * Optional fully-custom fetch path for sources that must call MORE THAN ONE
   * upstream endpoint and merge them (e.g. 중기예보 = 중기기온 + 중기육상예보).
   * When present (and `format === 'json'`), `fetchJejuSource` delegates the
   * ENTIRE fetch+render to this function; `buildUrl` is then only a nominal
   * "primary" endpoint (kept for listing/debugging), and `render`/`filter` are
   * ignored. Returns rendered `text` or an `error` string. Must never throw.
   */
  fetchCustom?: () => Promise<{ text: string } | { error: string }>
}

/**
 * KMA 중기예보 region codes for Jeju. These DIFFER between the two sub-APIs:
 *   - 중기기온(getMidTa) uses a station-like code (제주: 11G00201).
 *   - 중기육상예보(getMidLandFcst) uses a broader land region (제주도: 11G00000).
 *
 * ⚠️ NOT fully verified — if a live test returns resultCode '03' (NODATA) or an
 * empty item, the codes are likely wrong; correct them HERE (single source of
 * truth for both the URL builders and any future caller).
 */
export const JEJU_MIDTA_REGID = '11G00201'
export const JEJU_MIDLAND_REGID = '11G00000'

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
 * Computes the KMA 중기예보 announcement time (tmFc) in KST.
 *
 * 중기예보 is published twice daily at 06:00 and 18:00. The 06:00 release is
 * usable from ~07:00, so: if the current KST hour >= 7 use TODAY 0600, otherwise
 * use YESTERDAY 1800. Returns the string formatted YYYYMMDD0600 / YYYYMMDD1800.
 */
function kmaMidTmFc(now: Date = new Date()): string {
  // Korea is UTC+9, no DST. Shift from epoch to avoid host-timezone issues.
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const year = kst.getUTCFullYear()
  const month = kst.getUTCMonth()
  const day = kst.getUTCDate()
  const hour = kst.getUTCHours()
  const pad = (n: number) => String(n).padStart(2, '0')

  if (hour >= 7) {
    return `${year}${pad(month + 1)}${pad(day)}0600`
  }
  // Yesterday 18:00 — rebuild via UTC math to handle month/year rollover.
  const y = new Date(Date.UTC(year, month, day) - 24 * 60 * 60 * 1000)
  return `${y.getUTCFullYear()}${pad(y.getUTCMonth() + 1)}${pad(y.getUTCDate())}1800`
}

/** Builds the 중기기온(getMidTa) request URL for the given tmFc. */
function buildMidTaUrl(tmFc: string): string {
  // Shares the data.go.kr key with KPX (DATA_GO_KR_KEY override → KPX fallback).
  const key = process.env.DATA_GO_KR_KEY ?? process.env.KPX_SERVICE_KEY ?? ''
  const params = new URLSearchParams({
    serviceKey: key,
    dataType: 'JSON',
    regId: JEJU_MIDTA_REGID,
    tmFc,
    numOfRows: '10',
    pageNo: '1',
  })
  return `https://apis.data.go.kr/1360000/MidFcstInfoService/getMidTa?${params.toString()}`
}

/** Builds the 중기육상예보(getMidLandFcst) request URL for the given tmFc. */
function buildMidLandUrl(tmFc: string): string {
  const key = process.env.DATA_GO_KR_KEY ?? process.env.KPX_SERVICE_KEY ?? ''
  const params = new URLSearchParams({
    serviceKey: key,
    dataType: 'JSON',
    regId: JEJU_MIDLAND_REGID,
    tmFc,
    numOfRows: '10',
    pageNo: '1',
  })
  return `https://apis.data.go.kr/1360000/MidFcstInfoService/getMidLandFcst?${params.toString()}`
}

/**
 * Extracts the single forecast item from a 중기예보 response after checking the
 * nested response.header.resultCode ('00' = success). Both sub-APIs share this
 * envelope shape; the item is normally a single object (occasionally an array).
 */
function extractMidItem(
  parsed: unknown
): { ok: true; item: Record<string, unknown> } | { ok: false; error: string } {
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'Unexpected response shape' }
  }
  const response = (parsed as Record<string, unknown>).response
  if (!response || typeof response !== 'object') {
    return { ok: false, error: 'Missing response in payload' }
  }
  const resp = response as Record<string, unknown>

  const header =
    resp.header && typeof resp.header === 'object' ? (resp.header as Record<string, unknown>) : null
  const resultCode = header ? header.resultCode : undefined
  const resultMsg = header && typeof header.resultMsg === 'string' ? header.resultMsg : ''
  const code =
    typeof resultCode === 'string' || typeof resultCode === 'number' ? String(resultCode) : ''
  if (code !== '00') {
    return { ok: false, error: `resultCode ${code || 'missing'}${resultMsg ? `: ${resultMsg}` : ''}` }
  }

  const body =
    resp.body && typeof resp.body === 'object' ? (resp.body as Record<string, unknown>) : null
  const itemsContainer =
    body && body.items && typeof body.items === 'object'
      ? (body.items as Record<string, unknown>)
      : null
  const itemRaw = itemsContainer ? itemsContainer.item : null
  const item = Array.isArray(itemRaw)
    ? (itemRaw[0] as Record<string, unknown> | undefined) ?? null
    : itemRaw && typeof itemRaw === 'object'
      ? (itemRaw as Record<string, unknown>)
      : null
  if (!item) {
    return { ok: false, error: 'No forecast item in response' }
  }
  return { ok: true, item }
}

/**
 * Merges the 중기기온 item (taMin/taMax for days 3–10) and the 중기육상예보 item
 * (wf/rnSt for days 3–10; days 3–7 split into Am/Pm) into per-day Korean lines
 * like "3일후: 최저22℃/최고28℃, 흐림, 강수확률 30%". Tolerates either item being
 * null (renders whatever is available).
 */
function renderMidtermLines(
  taItem: Record<string, unknown> | null,
  landItem: Record<string, unknown> | null
): string[] {
  const get = (item: Record<string, unknown> | null, key: string): string => {
    if (!item) return ''
    const v = item[key]
    return v === null || v === undefined ? '' : String(v).trim()
  }

  const lines: string[] = []
  for (let n = 3; n <= 10; n++) {
    const min = get(taItem, `taMin${n}`)
    const max = get(taItem, `taMax${n}`)
    const tempPart = min || max ? `최저${min || '?'}℃/최고${max || '?'}℃` : ''

    let wxPart = ''
    let rainPart = ''
    if (n <= 7) {
      // Days 3–7 are split into AM/PM.
      const wfAm = get(landItem, `wf${n}Am`)
      const wfPm = get(landItem, `wf${n}Pm`)
      const rnAm = get(landItem, `rnSt${n}Am`)
      const rnPm = get(landItem, `rnSt${n}Pm`)
      if (wfAm || wfPm) {
        wxPart = wfAm === wfPm ? wfAm : `오전 ${wfAm || '?'}/오후 ${wfPm || '?'}`
      }
      if (rnAm || rnPm) {
        rainPart =
          rnAm === rnPm
            ? `강수확률 ${rnAm}%`
            : `강수확률 오전 ${rnAm || '?'}%/오후 ${rnPm || '?'}%`
      }
    } else {
      // Days 8–10 are single values.
      const wf = get(landItem, `wf${n}`)
      const rn = get(landItem, `rnSt${n}`)
      wxPart = wf
      rainPart = rn ? `강수확률 ${rn}%` : ''
    }

    const parts = [tempPart, wxPart, rainPart].filter((p) => p)
    lines.push(`${n}일후: ${parts.length ? parts.join(', ') : '데이터 없음'}`)
  }
  return lines
}

/**
 * Dedicated dual-API fetch path for 중기예보: fetches both getMidTa and
 * getMidLandFcst in parallel, checks each resultCode, and renders a combined
 * Korean 11-day outlook. If ONE sub-API fails, still renders the other with a
 * note. Total failure → `error`. Never throws.
 */
async function fetchKmaMidterm(): Promise<{ text: string } | { error: string }> {
  const tmFc = kmaMidTmFc()

  const [taRes, landRes] = await Promise.all([
    fetchJsonAt(buildMidTaUrl(tmFc)),
    fetchJsonAt(buildMidLandUrl(tmFc)),
  ])

  const ta = taRes.ok
    ? extractMidItem(taRes.parsed)
    : ({ ok: false, error: taRes.error } as const)
  const land = landRes.ok
    ? extractMidItem(landRes.parsed)
    : ({ ok: false, error: landRes.error } as const)

  const taItem = ta.ok ? ta.item : null
  const landItem = land.ok ? land.item : null

  if (!taItem && !landItem) {
    const taErr = ta.ok ? '' : ta.error
    const landErr = land.ok ? '' : land.error
    return {
      error: `중기기온(getMidTa) 실패: ${taErr}; 중기육상예보(getMidLandFcst) 실패: ${landErr}`,
    }
  }

  const notes: string[] = []
  if (!taItem) notes.push(`※ 중기기온(getMidTa) 수집 실패: ${ta.ok ? '' : ta.error}`)
  if (!landItem) notes.push(`※ 중기육상예보(getMidLandFcst) 수집 실패: ${land.ok ? '' : land.error}`)

  const lines = renderMidtermLines(taItem, landItem)
  const headerLine = `제주 중기예보 (발표시각: ${tmFc}, 기온 regId ${JEJU_MIDTA_REGID} / 육상 regId ${JEJU_MIDLAND_REGID})`
  const text = [headerLine, ...notes, '', ...lines].join('\n')
  return { text }
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

  {
    id: 'kma-jeju-midterm',
    label: 'KMA Jeju 11-day Outlook (중기예보)',
    format: 'json',
    modes: ['governance', 'resident'],
    // Nominal "primary" endpoint (used for listing/debugging only). The real
    // work happens in `fetchCustom`, which calls BOTH getMidTa + getMidLandFcst.
    buildUrl: () => buildMidTaUrl(kmaMidTmFc()),
    fetchCustom: fetchKmaMidterm,
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
 * Low-level: fetch + JSON-parse a single URL with timeout. Returns the parsed
 * value or a plain error string. Never throws. Used directly by multi-endpoint
 * paths (e.g. 중기예보) and indirectly by `fetchAndParseJson` (single-source).
 */
async function fetchJsonAt(
  rawUrl: string
): Promise<{ ok: true; parsed: unknown } | { ok: false; error: string }> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { ok: false, error: 'Invalid URL' }
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
      error: aborted
        ? `Request timed out after ${FETCH_TIMEOUT_MS}ms`
        : `Network error: ${e instanceof Error ? e.message : 'unknown error'}`,
    }
  } finally {
    clearTimeout(timeout)
  }

  if (!res.ok) {
    return { ok: false, error: `Fetch failed: HTTP ${res.status} ${res.statusText}`.trim() }
  }

  let raw: string
  try {
    raw = await res.text()
  } catch (e: unknown) {
    return {
      ok: false,
      error: `Could not read response body: ${e instanceof Error ? e.message : 'unknown error'}`,
    }
  }

  if (raw.trim() === '') {
    return { ok: false, error: 'Empty response body' }
  }

  try {
    return { ok: true, parsed: JSON.parse(raw) }
  } catch (e: unknown) {
    return {
      ok: false,
      error: `JSON parse error: ${e instanceof Error ? e.message : 'unknown error'}`,
    }
  }
}

/**
 * Shared single-source fetch + JSON parse used by the dedicated source paths.
 * Builds the URL from `source.buildUrl()` and delegates to `fetchJsonAt`, then
 * maps any error to a standard ExtractedContent. Kept inside this module (rather
 * than threaded into `extract`) so the generic extract layer stays unaware of
 * Jeju-specific trimming/rendering. Never throws.
 */
async function fetchAndParseJson(
  source: JejuSource
): Promise<{ ok: true; parsed: unknown } | { ok: false; result: ExtractedContent }> {
  const r = await fetchJsonAt(source.buildUrl())
  if (!r.ok) {
    return { ok: false, result: failResult(source.id, source.label, r.error) }
  }
  return { ok: true, parsed: r.parsed }
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
 * Dedicated path for sources that declare a fully-custom `fetchCustom` (e.g. the
 * dual-API 중기예보). Delegates the entire fetch+merge to the source, then wraps
 * the rendered text / error into a standard ExtractedContent. Never throws even
 * if the custom function does.
 */
async function fetchCustomJson(source: JejuSource): Promise<ExtractedContent> {
  let rendered: { text: string } | { error: string }
  try {
    rendered = await source.fetchCustom!()
  } catch (e: unknown) {
    return failResult(
      source.id,
      source.label,
      `Custom fetch failed: ${e instanceof Error ? e.message : 'unknown error'}`
    )
  }
  if ('error' in rendered) {
    return failResult(source.id, source.label, rendered.error)
  }
  return okResult(source.id, source.label, rendered.text)
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

  if (source.format === 'json' && source.fetchCustom) {
    return fetchCustomJson(source)
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
