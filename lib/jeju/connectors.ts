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

/** YYYYMMDD in KST (no hour stepping) — for date-stamped data.go.kr params. */
function kstYmd(now: Date = new Date()): string {
  // Korea is UTC+9, no DST. Shift from epoch to avoid host-timezone issues.
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${kst.getUTCFullYear()}${pad(kst.getUTCMonth() + 1)}${pad(kst.getUTCDate())}`
}

/** Parses a JSON number or numeric string; returns null when not a finite number. */
function parseNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/**
 * Shared data.go.kr envelope reader for the standard 1360000 / B552115 shape:
 * response.header.{resultCode,resultMsg} + response.body.items.item[]. Returns
 * the raw resultCode/resultMsg and the normalized item list (single-object →
 * one-element array) WITHOUT judging the code, so each renderer decides whether
 * a given code (e.g. '03' NODATA) is an error or a benign empty result.
 */
function readDataGoKrEnvelope(
  rawJson: unknown
): { ok: true; code: string; msg: string; items: Record<string, unknown>[] } | { ok: false; error: string } {
  if (!rawJson || typeof rawJson !== 'object') {
    return { ok: false, error: 'Unexpected response shape' }
  }
  const response = (rawJson as Record<string, unknown>).response
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

  return { ok: true, code, msg: resultMsg, items }
}

/**
 * Renders the KPX SMP + demand-forecast JSON for JEJU only. Checks the nested
 * resultCode ('00' = success), keeps only areaName === '제주' items, and renders
 * a compact Korean summary (min/max/avg SMP, peak hour, hourly series).
 *
 * HONESTY: Jeju SMP frequently equals the mainland value here because the HVDC
 * interconnection couples the two markets. Values are presented as-is; the header
 * warns the reader NOT to treat them as uniquely Jeju-determined.
 */
function renderJejuSmp(rawJson: unknown): { text: string } | { error: string } {
  const env = readDataGoKrEnvelope(rawJson)
  if (!env.ok) return { error: env.error }
  if (env.code !== '00') {
    return { error: `resultCode ${env.code || 'missing'}${env.msg ? `: ${env.msg}` : ''}` }
  }

  const jeju = env.items.filter((it) => String(it.areaName ?? '').trim() === '제주')
  if (jeju.length === 0) {
    return { error: '제주(areaName=제주) SMP 항목이 없습니다.' }
  }

  // Sort by hour (1–24) and collect (hour, smp, jlfd) rows.
  const rows = jeju
    .map((it) => ({
      hour: parseNum(it.hour),
      smp: parseNum(it.smp),
      jlfd: parseNum(it.jlfd),
    }))
    .filter((r) => r.hour !== null)
    .sort((a, b) => (a.hour ?? 0) - (b.hour ?? 0))

  const smps = rows.map((r) => r.smp).filter((v): v is number => v !== null)
  const date = String(jeju[0]?.date ?? kstYmd()).trim()

  const headerLine =
    `제주 계통한계가격(SMP)·수요예측 — ${date} 기준` +
    '\n※ 주의: 제주 SMP는 HVDC 연계로 육지값과 동일한 경우가 많음. 제주 계통 고유값으로 단정하지 말고 사실 그대로 참고할 것.'

  let summaryLine = '제주 계통한계가격(SMP, 원/kWh): (수치 없음)'
  if (smps.length > 0) {
    const min = Math.min(...smps)
    const max = Math.max(...smps)
    const avg = smps.reduce((s, v) => s + v, 0) / smps.length
    const peak = rows.find((r) => r.smp === max)
    const round = (n: number) => Math.round(n * 100) / 100
    summaryLine =
      `제주 계통한계가격(SMP, 원/kWh) 최저 ${round(min)} / 최고 ${round(max)} / 평균 ${round(avg)}` +
      (peak?.hour != null ? ` · 최고가 시간대 ${peak.hour}시` : '')
  }

  const hourLines = rows.map((r) => {
    const parts: string[] = []
    parts.push(
      `제주 계통한계가격(SMP, 원/kWh) ${r.smp != null ? r.smp : '?'}`
    )
    if (r.jlfd != null) parts.push(`제주 수요예측(KPX 추정) ${r.jlfd}`)
    return `${String(r.hour).padStart(2, '0')}시: ${parts.join(', ')}`
  })

  return { text: [headerLine, '', summaryLine, '', ...hourLines].join('\n') }
}

/**
 * Reads the odcloud envelope: { currentCount, matchCount, page, perPage, totalCount, data:[] }.
 * Success = HTTP 200 + data array present — there is no resultCode field.
 * Returns the data rows directly (each row has Korean field names).
 */
function readOdcloudEnvelope(rawJson: unknown): {
  ok: true
  totalCount: number | null
  rows: Record<string, unknown>[]
} | { ok: false; error: string } {
  if (!rawJson || typeof rawJson !== 'object') {
    return { ok: false, error: '응답 형식 오류 (non-object)' }
  }
  const root = rawJson as Record<string, unknown>
  const dataRaw = root.data
  if (!Array.isArray(dataRaw)) {
    return { ok: false, error: 'odcloud 응답에 data 배열 없음' }
  }
  const totalCountRaw = root.totalCount
  const totalCount =
    typeof totalCountRaw === 'number'
      ? totalCountRaw
      : typeof totalCountRaw === 'string' && totalCountRaw.trim() !== ''
        ? Number(totalCountRaw)
        : null
  return { ok: true, totalCount, rows: dataRaw as Record<string, unknown>[] }
}

const CITRUS_VARIETIES: readonly string[] = [
  '노지 온주밀감',
  '하우스 온주밀감',
  '월동 온주밀감',
  '노지 만감류',
  '하우스 만감류',
] as const

/**
 * Renders the odcloud 품종별감귤생산현황 dataset into a compact Korean summary.
 * Rows come as pairs: 면적(ha) + 생산량(톤) per year × variety. Focuses on:
 *   - Latest year (2023) production by variety
 *   - 5-year trend of 노지 온주밀감 (dominant variety)
 *   - Annual total 감귤 생산량 across varieties for last 5 years
 * HONESTY: notes that these are confirmed final statistics (익년 확정 기준).
 */
function renderJejuCitrus(rawJson: unknown): { text: string } | { error: string } {
  const env = readOdcloudEnvelope(rawJson)
  if (!env.ok) return { error: env.error }
  if (env.rows.length === 0) return { error: '제주 감귤 생산현황 데이터 없음 (빈 응답)' }

  const num = (v: unknown): number | null => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v)
      return Number.isFinite(n) ? n : null
    }
    return null
  }

  // Partition rows into production (생산량) and area (면적) by year.
  type YearData = {
    year: number
    production: Partial<Record<string, number>>
    area: Partial<Record<string, number>>
  }
  const byYear = new Map<number, YearData>()

  for (const row of env.rows) {
    const yearRaw = row['연도별']
    const year = num(yearRaw)
    if (year === null) continue

    const gubun = typeof row['구분'] === 'string' ? row['구분'].trim() : ''
    const isProduction = gubun.includes('생산량')

    if (!byYear.has(year)) {
      byYear.set(year, { year, production: {}, area: {} })
    }
    const entry = byYear.get(year)!
    const target = isProduction ? entry.production : entry.area

    for (const variety of CITRUS_VARIETIES) {
      const v = num(row[variety])
      if (v !== null) target[variety] = v
    }
  }

  const sortedYears = Array.from(byYear.keys()).sort((a, b) => b - a)
  if (sortedYears.length === 0) return { error: '연도 데이터 파싱 실패' }

  const latestYear = sortedYears[0]!
  const trendYears = sortedYears.slice(0, 5).reverse() // oldest→newest for trend display

  const header =
    `제주 품종별 감귤 생산현황 (출처: odcloud 15010584, 데이터기준일자 2024-12-31)` +
    `\n※ 확정 통계 최신=2023년산 (당해년산은 다음해 확정)`

  // Latest year production summary
  const latestEntry = byYear.get(latestYear)!
  const latestLines: string[] = [`\n[${latestYear}년산 품종별 생산량]`]
  let latestTotal = 0
  for (const variety of CITRUS_VARIETIES) {
    const v = latestEntry.production[variety]
    if (v !== undefined) {
      latestLines.push(`  ${variety}: ${v.toLocaleString()}톤`)
      latestTotal += v
    }
  }
  if (latestTotal > 0) {
    latestLines.push(`  합계: ${latestTotal.toLocaleString()}톤`)
  }

  // 5-year trend for 노지 온주밀감 (dominant)
  const trendLines: string[] = ['\n[노지 온주밀감 생산량 추세 (최근 5년)]']
  for (const yr of trendYears) {
    const v = byYear.get(yr)?.production['노지 온주밀감']
    trendLines.push(`  ${yr}년: ${v !== undefined ? `${v.toLocaleString()}톤` : '(없음)'}`)
  }

  // Annual total for last 5 years
  const totalLines: string[] = ['\n[연도별 감귤 총 생산량 (최근 5년)]']
  for (const yr of trendYears) {
    const entry = byYear.get(yr)
    if (!entry) continue
    const total = CITRUS_VARIETIES.reduce((s, k) => s + (entry.production[k] ?? 0), 0)
    totalLines.push(`  ${yr}년: ${total > 0 ? `${total.toLocaleString()}톤` : '(없음)'}`)
  }

  return {
    text: [header, ...latestLines, ...trendLines, ...totalLines].join('\n'),
  }
}

// Inbound (입항) commodity field names — confirmed by live probe 2025-05-14.
const CARGO_INBOUND_FIELDS: readonly string[] = [
  '입항 유류(톤)',
  '입항 시멘트(톤)',
  '입항 철재(톤)',
  '입항 모래(톤)',
  '입항 자갈(톤)',
  '입항 비료(톤)',
  '입항 목재(톤)',
  '입항 기타(톤)',
] as const

// Outbound (출항) commodity field names.
const CARGO_OUTBOUND_FIELDS: readonly string[] = [
  '출항 감귤채소(톤)',
  '출항 기타(톤)',
] as const

/**
 * Renders the odcloud 제주 항만 화물물동량 dataset into a compact Korean summary.
 * Each row: { 구분(무역항/연안항), 상세(항만명), 해당연월(YYYY-MM), 데이터기준일자,
 *             입항 유류(톤)/시멘트(톤)/.../기타(톤), 출항 감귤채소(톤)/기타(톤) }.
 * 600 rows = 6 ports × 100 months. Summarises:
 *   - Latest available year: per-port totals (inbound / outbound).
 *   - Inbound commodity breakdown for the latest year (all ports combined).
 *   - 출항 감귤채소 annual trend (last 5 years, all ports combined).
 *   - Annual total throughput trend (last 5 years).
 * DEFENSIVE: if expected keys are absent, lists the actual keys found instead of failing.
 */
function renderJejuCargo(rawJson: unknown): { text: string } | { error: string } {
  const env = readOdcloudEnvelope(rawJson)
  if (!env.ok) return { error: env.error }
  if (env.rows.length === 0) return { error: '제주 항만 물동량 데이터 없음 (빈 응답)' }

  const num = (v: unknown): number => {
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v)
      return Number.isFinite(n) ? n : 0
    }
    return 0
  }

  // Defensive check: verify expected key set against actual keys.
  const actualKeys = Object.keys(env.rows[0]!)
  const expectedKeys = ['상세', '해당연월', ...CARGO_INBOUND_FIELDS, ...CARGO_OUTBOUND_FIELDS]
  const missingKeys = expectedKeys.filter((k) => !actualKeys.includes(k))
  if (missingKeys.length > 3) {
    return {
      error:
        `예상 필드가 많이 없음 (실제 키: ${actualKeys.join(', ')})` +
        ` — 누락 필드: ${missingKeys.join(', ')}`,
    }
  }

  // Parse rows into { year → port → { inbound: Record<field,number>, outbound: Record<field,number> } }.
  type PortData = {
    inbound: Record<string, number>
    outbound: Record<string, number>
  }
  const byYear = new Map<number, Map<string, PortData>>()
  let baseDateNote = ''

  for (const row of env.rows) {
    const ym = typeof row['해당연월'] === 'string' ? row['해당연월'].trim() : ''
    if (!ym) continue
    const year = parseInt(ym.slice(0, 4), 10)
    if (!Number.isFinite(year)) continue

    const port = typeof row['상세'] === 'string' ? row['상세'].trim() : '(미상)'
    if (!baseDateNote && typeof row['데이터기준일자'] === 'string') {
      baseDateNote = row['데이터기준일자'].trim()
    }

    if (!byYear.has(year)) byYear.set(year, new Map())
    const portMap = byYear.get(year)!
    if (!portMap.has(port)) portMap.set(port, { inbound: {}, outbound: {} })
    const portData = portMap.get(port)!

    for (const f of CARGO_INBOUND_FIELDS) {
      portData.inbound[f] = (portData.inbound[f] ?? 0) + num(row[f])
    }
    for (const f of CARGO_OUTBOUND_FIELDS) {
      portData.outbound[f] = (portData.outbound[f] ?? 0) + num(row[f])
    }
  }

  const sortedYears = Array.from(byYear.keys()).sort((a, b) => b - a)
  if (sortedYears.length === 0) return { error: '연도 파싱 실패' }

  const latestYear = sortedYears[0]!
  const trendYears = sortedYears.slice(0, 5).reverse()

  const header =
    `제주 항만 화물 물동량 (출처: odcloud 15056447, 데이터기준일자 ${baseDateNote || '미상'})` +
    `\n※ 6개 항만(제주항·서귀포항·애월항·한림항·성산포항·화순항) 월별 누계 기준`

  // Latest year: per-port summary
  const latestPortMap = byYear.get(latestYear)!
  const portLines: string[] = [`\n[${latestYear}년 항만별 물동량]`]
  const inboundTotalByField: Record<string, number> = {}
  let grandInbound = 0
  let grandOutbound = 0

  for (const [port, data] of Array.from(latestPortMap.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    const inTotal = Object.values(data.inbound).reduce((s, v) => s + v, 0)
    const outTotal = Object.values(data.outbound).reduce((s, v) => s + v, 0)
    portLines.push(`  ${port}: 입항 ${inTotal.toLocaleString()}톤 / 출항 ${outTotal.toLocaleString()}톤`)
    grandInbound += inTotal
    grandOutbound += outTotal
    for (const f of CARGO_INBOUND_FIELDS) {
      inboundTotalByField[f] = (inboundTotalByField[f] ?? 0) + (data.inbound[f] ?? 0)
    }
  }
  portLines.push(`  전체합계: 입항 ${grandInbound.toLocaleString()}톤 / 출항 ${grandOutbound.toLocaleString()}톤`)

  // Inbound commodity breakdown for latest year (all ports)
  const commodityLines: string[] = [`\n[${latestYear}년 입항 품목별 (전 항만 합계)]`]
  const commoditySorted = CARGO_INBOUND_FIELDS
    .map((f) => ({ label: f.replace('입항 ', '').replace('(톤)', ''), val: inboundTotalByField[f] ?? 0 }))
    .sort((a, b) => b.val - a.val)
  for (const { label, val } of commoditySorted) {
    if (val > 0) commodityLines.push(`  ${label}: ${val.toLocaleString()}톤`)
  }

  // 출항 감귤채소 annual trend (last 5 years)
  const citrusField = '출항 감귤채소(톤)'
  const citrusTrendLines: string[] = ['\n[출항 감귤채소 연간 합계 (최근 5년)]']
  for (const yr of trendYears) {
    let yrTotal = 0
    for (const data of (byYear.get(yr) ?? new Map()).values()) {
      yrTotal += data.outbound[citrusField] ?? 0
    }
    citrusTrendLines.push(`  ${yr}년: ${yrTotal > 0 ? `${yrTotal.toLocaleString()}톤` : '(없음)'}`)
  }

  // Annual total throughput trend
  const throughputLines: string[] = ['\n[연간 총 물동량 추세 (최근 5년, 입항+출항)]']
  for (const yr of trendYears) {
    let total = 0
    for (const data of (byYear.get(yr) ?? new Map()).values()) {
      total += (Object.values(data.inbound) as number[]).reduce((s: number, v: number) => s + v, 0)
      total += (Object.values(data.outbound) as number[]).reduce((s: number, v: number) => s + v, 0)
    }
    throughputLines.push(`  ${yr}년: ${total > 0 ? `${total.toLocaleString()}톤` : '(없음)'}`)
  }

  // Partial-year note: if latestYear data seems incomplete (< 12 months per port).
  const firstPortMonths = env.rows.filter((r) =>
    typeof r['상세'] === 'string' &&
    r['상세'] === Array.from(latestPortMap.keys())[0] &&
    typeof r['해당연월'] === 'string' &&
    (r['해당연월'] as string).startsWith(String(latestYear))
  ).length
  const partialNote =
    firstPortMonths > 0 && firstPortMonths < 12
      ? `\n※ ${latestYear}년은 ${firstPortMonths}개월치만 수집됨 (연간 합계 아님)`
      : ''

  return {
    text: [header, partialNote, ...portLines, ...commodityLines, ...citrusTrendLines, ...throughputLines]
      .filter((l) => l !== '')
      .join('\n'),
  }
}

const FOREIGN_NATIONALITIES: readonly string[] = [
  '일본',
  '중국',
  '대만',
  '홍콩',
  '미국',
  '싱가폴',
  '태국',
  '말레이시아',
  '인도네시아',
  '베트남',
  '아시아 기타',
  '서구 기타',
] as const

const DOMESTIC_TRAVEL_FIELDS: readonly string[] = [
  '행태별(개별여행)',
  '행태별(부분패키지)',
  '행태별(패키지)',
] as const

const DOMESTIC_PURPOSE_FIELDS: readonly string[] = [
  '목적별(휴양및관람)',
  '목적별(레저스포츠)',
  '목적별(친지방문)',
  '목적별(회의및업무)',
  '목적별(교육여행)',
  '목적별(기타방문)',
] as const

function odcloudNum(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function checkMissingKeys(
  actualKeys: string[],
  expectedKeys: readonly string[],
  maxMissing = 3
): string | null {
  const missing = expectedKeys.filter((k) => !actualKeys.includes(k))
  if (missing.length > maxMissing) {
    return `예상 필드가 많이 없음 (실제 키: ${actualKeys.join(', ')}) — 누락: ${missing.join(', ')}`
  }
  return null
}

function inferDataYear(monthValues: string[]): number | null {
  const years = monthValues
    .map((ym) => parseInt(ym.slice(0, 4), 10))
    .filter((y) => Number.isFinite(y))
  if (years.length === 0) return null
  return Math.max(...years)
}

/**
 * Renders odcloud 제주 외국인 관광객 (국적별 월별) into a compact Korean summary.
 * Rows: { 해당연월, 일본/중국/... (numeric visitor counts) }.
 */
function renderJejuForeignTourists(rawJson: unknown): { text: string } | { error: string } {
  const env = readOdcloudEnvelope(rawJson)
  if (!env.ok) return { error: env.error }
  if (env.rows.length === 0) return { error: '제주 외국인 관광객 데이터 없음 (빈 응답)' }

  const actualKeys = Object.keys(env.rows[0]!)
  const keyErr = checkMissingKeys(actualKeys, ['해당연월', ...FOREIGN_NATIONALITIES])
  if (keyErr) return { error: keyErr }

  const annualByNat: Record<string, number> = {}
  for (const nat of FOREIGN_NATIONALITIES) annualByNat[nat] = 0

  const monthlyRows: { month: string; byNat: Record<string, number>; total: number }[] = []

  for (const row of env.rows) {
    const month = typeof row['해당연월'] === 'string' ? row['해당연월'].trim() : ''
    if (!month) continue

    const byNat: Record<string, number> = {}
    let rowTotal = 0
    for (const nat of FOREIGN_NATIONALITIES) {
      const v = odcloudNum(row[nat])
      byNat[nat] = v
      annualByNat[nat] = (annualByNat[nat] ?? 0) + v
      rowTotal += v
    }
    monthlyRows.push({ month, byNat, total: rowTotal })
  }

  if (monthlyRows.length === 0) return { error: '월별 데이터 파싱 실패' }

  const dataYear = inferDataYear(monthlyRows.map((r) => r.month)) ?? 2024
  const annualTotal = Object.values(annualByNat).reduce((s, v) => s + v, 0)

  const ranked = FOREIGN_NATIONALITIES.map((nat) => ({
    nat,
    total: annualByNat[nat] ?? 0,
    share: annualTotal > 0 ? ((annualByNat[nat] ?? 0) / annualTotal) * 100 : 0,
  }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total)

  const latest = [...monthlyRows].sort((a, b) => a.month.localeCompare(b.month)).at(-1)!
  const latestRanked = FOREIGN_NATIONALITIES.map((nat) => ({
    nat,
    total: latest.byNat[nat] ?? 0,
  }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 5)

  const chinaShare = ranked.find((r) => r.nat === '중국')?.share ?? 0

  const header =
    `제주 외국인 관광객 현황 (출처: odcloud 15061970, 데이터 기준 연도 ${dataYear}년)` +
    `\n※ 월별 국적별 입도객 수; ${dataYear}년 연간 합계 기준`

  const totalLine = `\n연간 외국인 관광객 합계: ${annualTotal.toLocaleString()}명`

  const rankLines = [`\n[국적별 연간 순위 (상위 ${Math.min(5, ranked.length)})]`]
  for (const { nat, total, share } of ranked.slice(0, 5)) {
    rankLines.push(`  ${nat}: ${total.toLocaleString()}명 (${share.toFixed(1)}%)`)
  }

  const chinaNote =
    chinaShare >= 40
      ? `\n※ 중국 비중 ${chinaShare.toFixed(1)}% — 외국인 관광 수요가 중국에 크게 의존하는 구조 (사실 기록)`
      : ''

  const latestLines = [`\n[최신 월 ${latest.month} — 상위 국적]`]
  for (const { nat, total } of latestRanked) {
    latestLines.push(`  ${nat}: ${total.toLocaleString()}명`)
  }
  latestLines.push(`  해당월 합계: ${latest.total.toLocaleString()}명`)

  return {
    text: [header, totalLine, ...rankLines, chinaNote, ...latestLines].filter((l) => l !== '').join('\n'),
  }
}

/**
 * Renders odcloud 제주 내국인 관광객 (형태·목적별 월별) into a compact Korean summary.
 * Rows: { 구분연월, 행태별(...), 목적별(...) }.
 */
function renderJejuDomesticTourists(rawJson: unknown): { text: string } | { error: string } {
  const env = readOdcloudEnvelope(rawJson)
  if (!env.ok) return { error: env.error }
  if (env.rows.length === 0) return { error: '제주 내국인 관광객 데이터 없음 (빈 응답)' }

  const actualKeys = Object.keys(env.rows[0]!)
  const keyErr = checkMissingKeys(actualKeys, ['구분연월', ...DOMESTIC_TRAVEL_FIELDS, ...DOMESTIC_PURPOSE_FIELDS])
  if (keyErr) return { error: keyErr }

  const travelAnnual: Record<string, number> = {}
  const purposeAnnual: Record<string, number> = {}
  for (const f of DOMESTIC_TRAVEL_FIELDS) travelAnnual[f] = 0
  for (const f of DOMESTIC_PURPOSE_FIELDS) purposeAnnual[f] = 0

  const months: string[] = []

  for (const row of env.rows) {
    const month = typeof row['구분연월'] === 'string' ? row['구분연월'].trim() : ''
    if (!month) continue
    months.push(month)

    for (const f of DOMESTIC_TRAVEL_FIELDS) {
      travelAnnual[f] = (travelAnnual[f] ?? 0) + odcloudNum(row[f])
    }
    for (const f of DOMESTIC_PURPOSE_FIELDS) {
      purposeAnnual[f] = (purposeAnnual[f] ?? 0) + odcloudNum(row[f])
    }
  }

  if (months.length === 0) return { error: '월별 데이터 파싱 실패' }

  const dataYear = inferDataYear(months) ?? 2024
  const annualTotal = DOMESTIC_TRAVEL_FIELDS.reduce((s, f) => s + (travelAnnual[f] ?? 0), 0)

  const travelRanked = DOMESTIC_TRAVEL_FIELDS.map((f) => ({
    label: f.replace('행태별(', '').replace(')', ''),
    total: travelAnnual[f] ?? 0,
    share: annualTotal > 0 ? ((travelAnnual[f] ?? 0) / annualTotal) * 100 : 0,
  }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total)

  const purposeTotal = DOMESTIC_PURPOSE_FIELDS.reduce((s, f) => s + (purposeAnnual[f] ?? 0), 0)
  const purposeRanked = DOMESTIC_PURPOSE_FIELDS.map((f) => ({
    label: f.replace('목적별(', '').replace(')', ''),
    total: purposeAnnual[f] ?? 0,
    share: purposeTotal > 0 ? ((purposeAnnual[f] ?? 0) / purposeTotal) * 100 : 0,
  }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total)

  const header =
    `제주 내국인 관광객 현황 (출처: odcloud 3083546, 데이터 기준 연도 ${dataYear}년)` +
    `\n※ 월별 형태·목적별 입도객 수; ${dataYear}년 연간 합계 기준`

  const totalLine = `\n연간 내국인 관광객 합계(행태별 합): ${annualTotal.toLocaleString()}명`

  const travelLines = ['\n[여행 형태별 (연간)]']
  for (const { label, total, share } of travelRanked) {
    travelLines.push(`  ${label}: ${total.toLocaleString()}명 (${share.toFixed(1)}%)`)
  }

  const purposeLines = ['\n[방문 목적별 (연간)]']
  for (const { label, total, share } of purposeRanked) {
    purposeLines.push(`  ${label}: ${total.toLocaleString()}명 (${share.toFixed(1)}%)`)
  }

  return {
    text: [header, totalLine, ...travelLines, ...purposeLines].join('\n'),
  }
}

/**
 * Reads the FLAT data.go.kr envelope used by B552584/pbnstFstChrgrChgcpcyInfo APIs:
 * { header:{resultCode,resultMsg}, body:{items:[...], totalCount, ...} }.
 * Unlike readDataGoKrEnvelope this does NOT expect a nested `response` wrapper.
 * resultCode "200" (this API's success code) or "00" are both treated as success.
 */
function readFlatDataGoKrEnvelope(rawJson: unknown): {
  ok: true
  code: string
  msg: string
  totalCount: number | null
  items: Record<string, unknown>[]
} | { ok: false; error: string } {
  if (!rawJson || typeof rawJson !== 'object') {
    return { ok: false, error: '응답 형식 오류 (non-object)' }
  }
  const root = rawJson as Record<string, unknown>
  const header =
    root.header && typeof root.header === 'object' ? (root.header as Record<string, unknown>) : null
  if (!header) {
    return { ok: false, error: 'Missing header in flat response' }
  }
  const resultCodeRaw = header.resultCode
  const code =
    typeof resultCodeRaw === 'string' || typeof resultCodeRaw === 'number'
      ? String(resultCodeRaw)
      : ''
  const msg = typeof header.resultMsg === 'string' ? header.resultMsg : ''

  const body =
    root.body && typeof root.body === 'object' ? (root.body as Record<string, unknown>) : null
  const totalCountRaw = body?.totalCount
  const totalCount =
    typeof totalCountRaw === 'number'
      ? totalCountRaw
      : typeof totalCountRaw === 'string' && totalCountRaw.trim() !== ''
        ? Number(totalCountRaw)
        : null

  const itemsRaw = body?.items
  let items: Record<string, unknown>[] = []
  if (Array.isArray(itemsRaw)) {
    items = itemsRaw as Record<string, unknown>[]
  } else if (itemsRaw && typeof itemsRaw === 'object') {
    const container = itemsRaw as Record<string, unknown>
    const itemNested = container.item
    items = Array.isArray(itemNested)
      ? (itemNested as Record<string, unknown>[])
      : itemNested && typeof itemNested === 'object'
        ? [itemNested as Record<string, unknown>]
        : []
  }

  return { ok: true, code, msg, totalCount, items }
}

/**
 * Core aggregation for KECO EV charger data. Receives the combined item array
 * (possibly spanning multiple pages), totalCount from the API, and a pageNote
 * string describing how many pages were fetched vs requested (for honesty header).
 * Never throws.
 */
function aggregateKecoEvChargerItems(
  items: Record<string, unknown>[],
  totalCount: number | null,
  pageNote: string
): { text: string } | { error: string } {
  if (items.length === 0) {
    return { error: '제주 전기차 충전기 데이터 없음 (빈 응답)' }
  }

  const fetchedCount = items.length
  const sampleNote =
    totalCount != null && totalCount > fetchedCount
      ? `표본 약 ${fetchedCount.toLocaleString()}건 (전체 ${totalCount.toLocaleString()}건 중)`
      : `${fetchedCount.toLocaleString()}건`

  const stationSet = new Set<string>()
  const sggCounts: Record<string, number> = {}
  const frmCounts: Record<string, number> = {}
  const capacities: number[] = []
  const yrCounts: Record<string, number> = {}

  for (const item of items) {
    const stationId = typeof item.chgstnId === 'string' ? item.chgstnId.trim() : ''
    if (stationId) stationSet.add(stationId)

    const sgg = typeof item.sggNm === 'string' ? item.sggNm.trim() : '(미상)'
    sggCounts[sgg] = (sggCounts[sgg] ?? 0) + 1

    const frm = typeof item.chrgrFrm === 'string' ? item.chrgrFrm.trim() : '(미상)'
    frmCounts[frm] = (frmCounts[frm] ?? 0) + 1

    const cpct = parseNum(item.chrgrCpct)
    if (cpct != null) capacities.push(cpct)

    const yr = typeof item.rlvtYr === 'string' ? item.rlvtYr.trim() : ''
    if (yr) yrCounts[yr] = (yrCounts[yr] ?? 0) + 1
  }

  const headerLine =
    `제주 전기차 충전 인프라 현황` +
    ` (출처: 환경부/KECO getYrMnChgcpcyInfo, rgnNm=제주특별자치도, ${pageNote})`

  const countLine = `수신 건수: ${sampleNote}`
  const stationLine = `고유 충전소 수: ${stationSet.size.toLocaleString()}개소`

  const sggSorted = Object.entries(sggCounts).sort((a, b) => b[1] - a[1])
  const sggLine = `시군구별 분포: ${sggSorted.map(([k, v]) => `${k} ${v}건`).join(', ')}`

  const frmSorted = Object.entries(frmCounts).sort((a, b) => b[1] - a[1])
  const frmTop = frmSorted.slice(0, 5)
  const frmLine =
    `충전 방식 분포: ${frmTop.map(([k, v]) => `${k} ${v}건`).join(', ')}` +
    (frmSorted.length > 5 ? ` (외 ${frmSorted.length - 5}종)` : '')

  let capacityLine = '충전기 용량: (데이터 없음)'
  if (capacities.length > 0) {
    const avg = capacities.reduce((s, v) => s + v, 0) / capacities.length
    const max = Math.max(...capacities)
    capacityLine = `충전기 용량: 평균 ${Math.round(avg)}kW, 최대 ${max}kW`
  }

  const yrSorted = Object.entries(yrCounts)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 8)
  const yrLine =
    `설치연도 분포: ${yrSorted.map(([k, v]) => `${k}년 ${v}건`).join(', ')}` +
    (Object.keys(yrCounts).length > 8 ? ' …' : '')

  return {
    text: [headerLine, '', countLine, stationLine, sggLine, frmLine, capacityLine, yrLine].join(
      '\n'
    ),
  }
}

/**
 * Multi-page custom fetcher for KECO EV charger data.
 *
 * The API hard-caps numOfRows at 100. We fetch pages 1–5 sequentially (500 rows
 * total) with rgnNm=제주특별자치도. Pages are fetched one at a time to avoid
 * hammering the government server. If any individual page fails (network error OR
 * a non-200 resultCode) it is silently skipped and the remaining pages are still
 * used. Zero successful pages → returns an error. Never throws.
 */
async function fetchKecoEvCharger(): Promise<{ text: string } | { error: string }> {
  const key = process.env.DATA_GO_KR_KEY ?? process.env.KPX_SERVICE_KEY ?? ''
  const baseParams = {
    serviceKey: key,
    returnType: 'JSON',
    numOfRows: '100',
    rgnNm: '제주특별자치도',
  }
  const PAGES_REQUESTED = 5

  const combined: Record<string, unknown>[] = []
  let totalCount: number | null = null
  let pagesSucceeded = 0
  const errors: string[] = []

  for (let page = 1; page <= PAGES_REQUESTED; page++) {
    const params = new URLSearchParams({ ...baseParams, pageNo: String(page) })
    const url = `https://apis.data.go.kr/B552584/pbnstFstChrgrChgcpcyInfo/getYrMnChgcpcyInfo?${params.toString()}`

    const res = await fetchJsonAt(url)
    if (!res.ok) {
      errors.push(`page ${page}: ${res.error}`)
      continue
    }

    const env = readFlatDataGoKrEnvelope(res.parsed)
    if (!env.ok) {
      errors.push(`page ${page}: ${env.error}`)
      continue
    }
    if (env.code !== '200' && env.code !== '00') {
      errors.push(`page ${page}: resultCode ${env.code}${env.msg ? ` (${env.msg})` : ''}`)
      continue
    }

    // Capture totalCount from the first successful page.
    if (totalCount === null && env.totalCount !== null) {
      totalCount = env.totalCount
    }

    combined.push(...env.items)
    pagesSucceeded++

    // Stop early if we've already collected all available rows.
    if (totalCount !== null && combined.length >= totalCount) {
      break
    }
  }

  if (pagesSucceeded === 0) {
    return {
      error: `KECO EV charger: 모든 페이지 수집 실패 — ${errors.join('; ')}`,
    }
  }

  const pageNote =
    pagesSucceeded < PAGES_REQUESTED
      ? `${PAGES_REQUESTED}페이지 요청 중 ${pagesSucceeded}페이지 성공`
      : `${PAGES_REQUESTED}페이지 수집`

  return aggregateKecoEvChargerItems(combined, totalCount, pageNote)
}

/**
 * Renders the KMA 기상특보(getWthrWrnList) JSON for Jeju (stnId=184). Checks the
 * nested resultCode; treats '00' as success and '03' (NODATA) as a benign
 * no-warning case. ZERO items is NOT an error — it renders the standard
 * "현재 발효 중인 기상특보 없음" line. Otherwise lists warning titles, newest first.
 */
function renderJejuWarning(rawJson: unknown): { text: string } | { error: string } {
  const env = readDataGoKrEnvelope(rawJson)
  if (!env.ok) return { error: env.error }
  // '03' = NODATA is the API's "no rows" signal — a normal no-warning state.
  if (env.code !== '00' && env.code !== '03') {
    return { error: `resultCode ${env.code || 'missing'}${env.msg ? `: ${env.msg}` : ''}` }
  }

  if (env.items.length === 0) {
    return { text: '제주 기상특보: 현재 발효 중인 기상특보 없음' }
  }

  // Newest first by tmFc (발표시각, numeric).
  const sorted = [...env.items].sort((a, b) => (parseNum(b.tmFc) ?? 0) - (parseNum(a.tmFc) ?? 0))
  const lines = sorted
    .map((it) => {
      const title = typeof it.title === 'string' ? it.title.trim() : ''
      const tmFc = parseNum(it.tmFc)
      if (!title) return ''
      return tmFc != null ? `- (${tmFc}) ${title}` : `- ${title}`
    })
    .filter((l) => l !== '')

  if (lines.length === 0) {
    return { text: '제주 기상특보: 현재 발효 중인 기상특보 없음' }
  }
  return { text: ['제주 기상특보 (최근 발표순)', ...lines].join('\n') }
}

/**
 * Renders the VisitJeju 관광지 검색 API (searchList) into a compact Korean summary.
 *
 * ⚠️ This API does NOT match the other Jeju sources' envelopes:
 *   - NOT wrapped in `response.body` (unlike KMA/data.go.kr → readDataGoKrEnvelope).
 *   - NOT a `data[]` array (unlike odcloud → readOdcloudEnvelope).
 *   - FLAT shape: { result, resultMessage, totalCount, resultCount, pageSize,
 *     pageCount, currentPage, items: [...] }.
 *
 * Success is judged by DATA, not the result code (the official guide is
 * internally inconsistent: spec table says "00", the live server returns "200").
 * LIVE = totalCount > 0 AND Array.isArray(items) AND items.length > 0.
 *
 * Each item (Korean values): title, contentscd.label (분류), address, roadaddress,
 * introduction (간단소개), tag (쉼표구분), latitude/longitude (테마여행 entries may be
 * null), region1cd.label (시), region2cd.label (구역).
 */
function renderVisitJejuAttractions(rawJson: unknown): { text: string } | { error: string } {
  if (!rawJson || typeof rawJson !== 'object') {
    return { error: 'VisitJeju 관광지: 응답 형식 오류 (객체 아님)' }
  }
  const obj = rawJson as Record<string, unknown>

  const totalCount = Number(obj.totalCount ?? 0)
  const items = Array.isArray(obj.items) ? (obj.items as Record<string, unknown>[]) : null

  if (!Number.isFinite(totalCount) || totalCount <= 0 || !items || items.length === 0) {
    return { error: `VisitJeju 관광지: 데이터 없음 (totalCount=${obj.totalCount ?? '없음'}, items=${items ? items.length : '없음'})` }
  }

  // Reads `.label` from a {value,label,refId} code object; '' when absent.
  const codeLabel = (v: unknown): string => {
    if (v && typeof v === 'object') {
      const label = (v as Record<string, unknown>).label
      if (typeof label === 'string') return label.trim()
    }
    return ''
  }
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  const numOrNull = (v: unknown): number | null => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v)
      return Number.isFinite(n) ? n : null
    }
    return null
  }

  const RENDER_CAP = 100
  const rendered = items.slice(0, RENDER_CAP)

  const lines = rendered
    .map((item) => {
      const title = str(item.title) || '(제목 없음)'
      const category = codeLabel(item.contentscd) || '미분류'
      const region1 = codeLabel(item.region1cd)
      const region2 = codeLabel(item.region2cd)
      const region = [region1, region2].filter((r) => r !== '').join('·')

      const parts: string[] = [`- [${category}] ${title}${region ? ` (${region})` : ''}`]

      const tag = str(item.tag)
      if (tag) parts.push(`태그: ${tag}`)

      const lat = numOrNull(item.latitude)
      const lng = numOrNull(item.longitude)
      if (lat !== null && lng !== null) parts.push(`좌표: ${lat},${lng}`)

      const intro = str(item.introduction)
      if (intro) parts.push(`소개: ${intro.length > 60 ? `${intro.slice(0, 60)}…` : intro}`)

      return parts.join(' | ')
    })
    .filter((l) => l !== '')

  const header =
    `VisitJeju 관광지·맛집·축제 검색 (출처: api.visitjeju.net, 전체 ${totalCount.toLocaleString()}건` +
    `${rendered.length < totalCount ? `, 상위 ${rendered.length}건 표시` : ''})`

  return { text: [header, ...lines].join('\n') }
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

  {
    id: 'kpx-jeju-smp',
    label: 'KPX Jeju SMP & Demand Forecast (계통한계가격·수요예측)',
    format: 'json',
    modes: ['governance', 'resident'],
    buildUrl: () => {
      const key = process.env.DATA_GO_KR_KEY ?? process.env.KPX_SERVICE_KEY ?? ''
      const params = new URLSearchParams({
        serviceKey: key,
        pageNo: '1',
        numOfRows: '48',
        dataType: 'JSON',
        // NOTE: this endpoint's date param is `date` (the 발전원별 API uses
        // `baseDate`); `date` is what the probe confirmed working.
        date: kstYmd(),
      })
      return `https://apis.data.go.kr/B552115/SmpWithForecastDemand/getSmpWithForecastDemand?${params.toString()}`
    },
    render: renderJejuSmp,
  },

  {
    id: 'kma-jeju-warning',
    label: 'KMA Jeju Weather Warnings (기상특보)',
    format: 'json',
    modes: ['governance', 'resident', 'tourist'],
    buildUrl: () => {
      const key = process.env.DATA_GO_KR_KEY ?? process.env.KPX_SERVICE_KEY ?? ''
      const params = new URLSearchParams({
        ServiceKey: key,
        pageNo: '1',
        numOfRows: '20',
        dataType: 'JSON',
        stnId: '184', // 184 = 제주
      })
      return `https://apis.data.go.kr/1360000/WthrWrnInfoService/getWthrWrnList?${params.toString()}`
    },
    render: renderJejuWarning,
  },

  {
    id: 'keco-jeju-evcharger',
    label: 'KECO Jeju EV Charger Infrastructure (전기차 충전 인프라)',
    format: 'json',
    modes: ['governance', 'resident'],
    // Nominal primary URL (page 1 only, for listing/debugging). The actual fetch
    // uses fetchCustom which pages through 1–5 (numOfRows=100 is the API hard max).
    buildUrl: () => {
      const key = process.env.DATA_GO_KR_KEY ?? process.env.KPX_SERVICE_KEY ?? ''
      const params = new URLSearchParams({
        serviceKey: key,
        returnType: 'JSON',
        numOfRows: '100',
        pageNo: '1',
        rgnNm: '제주특별자치도',
      })
      return `https://apis.data.go.kr/B552584/pbnstFstChrgrChgcpcyInfo/getYrMnChgcpcyInfo?${params.toString()}`
    },
    fetchCustom: fetchKecoEvCharger,
  },

  {
    id: 'jeju-citrus-production',
    label: 'Jeju Citrus Production by Variety (품종별감귤생산현황)',
    format: 'json',
    modes: ['governance', 'resident'],
    buildUrl: () => {
      // odcloud system (api.odcloud.kr), NOT apis.data.go.kr. Auth via serviceKey
      // query param (Authorization header also works but query is simpler).
      // perPage=50 fetches all 32 rows (16 years × 2 metrics) in one request.
      const key = process.env.DATA_GO_KR_KEY ?? process.env.KPX_SERVICE_KEY ?? ''
      const params = new URLSearchParams({
        page: '1',
        perPage: '50',
        serviceKey: key,
      })
      return `https://api.odcloud.kr/api/15010584/v1/uddi:eba2a3ef-a809-4516-854b-94a342fd2af1?${params.toString()}`
    },
    render: renderJejuCitrus,
  },

  {
    id: 'jeju-cargo-throughput',
    label: 'Jeju Port Cargo Throughput (항만 화물 물동량)',
    format: 'json',
    modes: ['governance'],
    buildUrl: () => {
      // odcloud system. perPage=600 fetches all rows (6 ports × 100 months) in one call.
      const key = process.env.DATA_GO_KR_KEY ?? process.env.KPX_SERVICE_KEY ?? ''
      const params = new URLSearchParams({
        page: '1',
        perPage: '600',
        serviceKey: key,
      })
      return `https://api.odcloud.kr/api/15056447/v1/uddi:1d9ca1d7-0576-4145-9567-fd4038aa3648?${params.toString()}`
    },
    render: renderJejuCargo,
  },

  {
    id: 'jeju-foreign-tourists',
    label: 'Jeju Foreign Tourists by Nationality (외국인 관광객)',
    format: 'json',
    modes: ['governance', 'tourist'],
    buildUrl: () => {
      const key = process.env.DATA_GO_KR_KEY ?? process.env.KPX_SERVICE_KEY ?? ''
      const params = new URLSearchParams({
        page: '1',
        perPage: '20',
        serviceKey: key,
      })
      return `https://api.odcloud.kr/api/15061970/v1/uddi:a9a0b107-db41-4adc-a489-dcba0e474986?${params.toString()}`
    },
    render: renderJejuForeignTourists,
  },

  {
    id: 'jeju-domestic-tourists',
    label: 'Jeju Domestic Tourists by Type/Purpose (내국인 관광객)',
    format: 'json',
    modes: ['governance', 'resident'],
    buildUrl: () => {
      const key = process.env.DATA_GO_KR_KEY ?? process.env.KPX_SERVICE_KEY ?? ''
      const params = new URLSearchParams({
        page: '1',
        perPage: '20',
        serviceKey: key,
      })
      return `https://api.odcloud.kr/api/3083546/v1/uddi:7ef5b5b5-e00d-490f-8624-bb2d543d0904?${params.toString()}`
    },
    render: renderJejuDomesticTourists,
  },

  {
    id: 'visitjeju-attractions',
    label: 'VisitJeju Tourist Attractions (비짓제주 관광지·맛집·축제)',
    format: 'json',
    modes: ['tourist'],
    buildUrl: () => {
      // Dedicated key (NOT the data.go.kr / KPX shared key). MUST be https://:
      // the official guide PDF lists http:// but the live server silently drops
      // http requests. Auth param is `apiKey` (capital K) + locale=kr.
      const key = process.env.VISITJEJU_API_KEY ?? ''
      const params = new URLSearchParams({
        apiKey: key,
        locale: 'kr',
        page: '1',
      })
      return `https://api.visitjeju.net/vsjApi/contents/searchList?${params.toString()}`
    },
    render: renderVisitJejuAttractions,
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

/**
 * KPX-only fetch resilience. The KPX/data.go.kr endpoints are intermittently
 * flaky under load (observed: kpx-jeju-power → HTTP 500, kpx-jeju-smp → 10s
 * timeout) while being perfectly healthy minutes later. These two sources get a
 * longer timeout + a couple of retries with backoff so a transient hiccup does
 * not blank out the brief. NOTHING here changes parsing or the snapshot shape —
 * only the fetch attempt count/timeout for these two ids. All other connectors
 * keep the default 10s / no-retry behavior.
 */
const KPX_SOURCE_IDS: ReadonlySet<string> = new Set(['kpx-jeju-power', 'kpx-jeju-smp'])
const KPX_FETCH_TIMEOUT_MS = 28_000
/** Backoff before retry 1 and retry 2 (2 retries ⇒ up to 3 attempts total). */
const KPX_RETRY_DELAYS_MS = [1_000, 3_000]

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Per-fetch resilience options. Omitted fields fall back to legacy behavior. */
type FetchResilience = {
  timeoutMs?: number
  /** Number of RETRIES (extra attempts) on HTTP 5xx / timeout / network error. */
  retries?: number
  /** Backoff before each retry; index i is used before retry i+1. */
  retryDelaysMs?: number[]
}

/** Resilience opts for a given source id — KPX gets retries, everyone else legacy. */
function resilienceForSource(id: string): FetchResilience | undefined {
  if (KPX_SOURCE_IDS.has(id)) {
    return { timeoutMs: KPX_FETCH_TIMEOUT_MS, retries: 2, retryDelaysMs: KPX_RETRY_DELAYS_MS }
  }
  return undefined
}

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
/**
 * ONE fetch+parse attempt. `retryable` marks failures worth re-trying (HTTP 5xx,
 * timeout, network) vs. terminal ones (bad URL, empty body, JSON parse) that a
 * retry can't fix. Parsing logic is unchanged from the original single-shot fn.
 */
async function fetchJsonOnce(
  url: URL,
  timeoutMs: number
): Promise<
  { ok: true; parsed: unknown } | { ok: false; error: string; retryable: boolean }
> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

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
      retryable: true,
      error: aborted
        ? `Request timed out after ${timeoutMs}ms`
        : `Network error: ${e instanceof Error ? e.message : 'unknown error'}`,
    }
  } finally {
    clearTimeout(timeout)
  }

  if (!res.ok) {
    // Server errors (5xx) are transient and worth retrying; 4xx are not.
    return {
      ok: false,
      retryable: res.status >= 500,
      error: `Fetch failed: HTTP ${res.status} ${res.statusText}`.trim(),
    }
  }

  let raw: string
  try {
    raw = await res.text()
  } catch (e: unknown) {
    return {
      ok: false,
      retryable: false,
      error: `Could not read response body: ${e instanceof Error ? e.message : 'unknown error'}`,
    }
  }

  if (raw.trim() === '') {
    return { ok: false, retryable: false, error: 'Empty response body' }
  }

  try {
    return { ok: true, parsed: JSON.parse(raw) }
  } catch (e: unknown) {
    return {
      ok: false,
      retryable: false,
      error: `JSON parse error: ${e instanceof Error ? e.message : 'unknown error'}`,
    }
  }
}

async function fetchJsonAt(
  rawUrl: string,
  resilience?: FetchResilience
): Promise<{ ok: true; parsed: unknown } | { ok: false; error: string }> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { ok: false, error: 'Invalid URL' }
  }

  const timeoutMs = resilience?.timeoutMs ?? FETCH_TIMEOUT_MS
  const retries = resilience?.retries ?? 0
  const delays = resilience?.retryDelaysMs ?? []

  let last: { ok: false; error: string; retryable: boolean } = {
    ok: false,
    error: 'not attempted',
    retryable: false,
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    const r = await fetchJsonOnce(url, timeoutMs)
    if (r.ok) return r
    last = r
    if (!r.retryable || attempt === retries) break
    const delay = delays[attempt] ?? delays[delays.length - 1] ?? 1_000
    await sleep(delay)
  }

  if (retries > 0) {
    const endpoint = rawUrl.split('?')[0]
    console.warn(
      `[jeju-connectors] fetch gave up after ${retries + 1} attempt(s): ${endpoint} → ${last.error}`
    )
  }
  return { ok: false, error: last.error }
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
  const r = await fetchJsonAt(source.buildUrl(), resilienceForSource(source.id))
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

  // Generic extract path (e.g. kpx-jeju-power XML). The shared `extract` module
  // owns its own fetch/timeout and must NOT be modified, so KPX resilience here
  // is a retry-on-failure wrapper only: re-run the SAME extract call (identical
  // parsing/shape) on a transient failure, with backoff. Non-KPX sources keep
  // the original single-shot behavior.
  const extractInput = {
    type: 'json-api' as const,
    value: source.buildUrl(),
    meta: {
      format: source.format,
      title: source.label,
      sourceLabel: source.id,
    },
  }

  if (KPX_SOURCE_IDS.has(source.id)) {
    let result = await extract(extractInput)
    for (let i = 0; !result.ok && i < KPX_RETRY_DELAYS_MS.length; i++) {
      await sleep(KPX_RETRY_DELAYS_MS[i]!)
      result = await extract(extractInput)
    }
    if (!result.ok) {
      console.warn(
        `[jeju-connectors] ${source.id} extract failed after ${KPX_RETRY_DELAYS_MS.length + 1} attempt(s): ${result.error ?? 'unknown error'}`
      )
    }
    return result
  }

  return extract(extractInput)
}

// ─────────────────────────────────────────────────────────────────────────────
// VisitJeju structured helper (for the tourist photo-card UI)
//
// This is a DIRECT helper, intentionally NOT a JEJU_SOURCES registry entry: the
// registry path returns a pre-rendered text summary (renderVisitJejuAttractions,
// left untouched), whereas the tourist UI needs structured objects with image
// URLs + coordinates. Both call the same live API; this one just maps the raw
// items into typed records instead of a string.
// ─────────────────────────────────────────────────────────────────────────────

/** A single VisitJeju place, structured for UI rendering (photo cards). */
export interface VisitJejuPlace {
  contentsId: string
  /** contentscd.value, e.g. c1=관광지 c2=쇼핑 c4=음식점 c5=축제/행사 c6=테마여행. */
  categoryCode: string
  /** contentscd.label, e.g. '관광지'. */
  categoryLabel: string
  title: string
  /** `${region1cd.label}·${region2cd.label}` when both present, else one, else ''. */
  region: string
  address: string
  introduction: string
  tags: string[]
  /** Original comma/space-separated `tag` string, kept raw for client-side text search. */
  rawTags: string
  lat: number | null
  lng: number | null
  imageUrl: string | null
  thumbnailUrl: string | null
}

/** Default category mix fetched when no categories are supplied. */
const VISITJEJU_DEFAULT_CATEGORIES: readonly string[] = ['c1', 'c4', 'c5', 'c2']
const VISITJEJU_DEFAULT_PER_CATEGORY = 8
const VISITJEJU_SEARCHLIST = 'https://api.visitjeju.net/vsjApi/contents/searchList'

/** Reads `.label` from a {value,label,refId} VisitJeju code object; '' when absent. */
function visitJejuCodeLabel(v: unknown): string {
  if (v && typeof v === 'object') {
    const label = (v as Record<string, unknown>).label
    if (typeof label === 'string') return label.trim()
  }
  return ''
}

/** Reads `.value` from a {value,label,refId} VisitJeju code object; '' when absent. */
function visitJejuCodeValue(v: unknown): string {
  if (v && typeof v === 'object') {
    const value = (v as Record<string, unknown>).value
    if (typeof value === 'string') return value.trim()
  }
  return ''
}

/** Coerces a value to a finite number, or null when missing/NaN. */
function visitJejuNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Maps one raw VisitJeju item into a typed VisitJejuPlace. */
function mapVisitJejuItem(item: Record<string, unknown>): VisitJejuPlace {
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

  const region1 = visitJejuCodeLabel(item.region1cd)
  const region2 = visitJejuCodeLabel(item.region2cd)
  const region = [region1, region2].filter((r) => r !== '').join('·')

  const rawTags = str(item.tag)
  const tags = rawTags
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t !== '')
    .slice(0, 5)

  // repPhoto.photoid.{imgpath, thumbnailpath} — every level can be missing/null.
  let imageUrl: string | null = null
  let thumbnailUrl: string | null = null
  const repPhoto = item.repPhoto
  if (repPhoto && typeof repPhoto === 'object') {
    const photoid = (repPhoto as Record<string, unknown>).photoid
    if (photoid && typeof photoid === 'object') {
      const p = photoid as Record<string, unknown>
      imageUrl = typeof p.imgpath === 'string' && p.imgpath.trim() !== '' ? p.imgpath : null
      thumbnailUrl =
        typeof p.thumbnailpath === 'string' && p.thumbnailpath.trim() !== '' ? p.thumbnailpath : null
    }
  }

  return {
    contentsId: str(item.contentsid),
    categoryCode: visitJejuCodeValue(item.contentscd),
    categoryLabel: visitJejuCodeLabel(item.contentscd),
    title: str(item.title) || '(제목 없음)',
    region,
    address: str(item.address) || str(item.roadaddress),
    introduction: str(item.introduction),
    tags,
    rawTags,
    lat: visitJejuNum(item.latitude),
    lng: visitJejuNum(item.longitude),
    imageUrl,
    thumbnailUrl,
  }
}

/** Pulls the flat `items` array out of a parsed VisitJeju response. */
function visitJejuItems(parsed: unknown): Record<string, unknown>[] {
  if (!parsed || typeof parsed !== 'object') return []
  const items = (parsed as Record<string, unknown>).items
  return Array.isArray(items) ? (items as Record<string, unknown>[]) : []
}

/** Reads the flat `totalCount` from a parsed VisitJeju response (0 when absent). */
function visitJejuTotalCount(parsed: unknown): number {
  if (!parsed || typeof parsed !== 'object') return 0
  const n = Number((parsed as Record<string, unknown>).totalCount ?? 0)
  return Number.isFinite(n) ? n : 0
}

/**
 * Builds a searchList URL with apiKey + locale + page (+ optional category/numOfRows).
 *
 * ⚠️ FIREWALL: VisitJeju's web firewall returns an HTML "blocked" page (not JSON)
 * when raw Korean characters appear in query params. Keep every param ASCII-only
 * (category=c1, page=1). Korean keyword filtering is done CLIENT-SIDE on fetched
 * data (filterPlacesByQuery), never via the API.
 */
function buildVisitJejuUrl(opts: { category?: string; perPage: number; page?: number }): string {
  const key = process.env.VISITJEJU_API_KEY ?? ''
  const params = new URLSearchParams({
    apiKey: key,
    locale: 'kr',
    page: String(opts.page ?? 1),
    // searchList paginates by `pageSize`; `numOfRows` is sent too for safety as
    // the guide is inconsistent about the row-count param name.
    pageSize: String(opts.perPage),
    numOfRows: String(opts.perPage),
  })
  if (opts.category) params.set('category', opts.category)
  return `${VISITJEJU_SEARCHLIST}?${params.toString()}`
}

/**
 * Fetches STRUCTURED VisitJeju places (with image URLs + coordinates) for the
 * tourist UI. Unlike the `visitjeju-attractions` registry source (which returns
 * a text summary), this returns typed `VisitJejuPlace[]`.
 *
 * Diversification: page 1 of the raw API is dominated by 축제/행사 (c5), which
 * makes the card grid monotonous. So by default we fetch each category value
 * SEPARATELY (c1 관광지, c4 음식점, c5 축제/행사, c2 쇼핑) via the `category`
 * query param and merge — `perCategory` items from each (default 8 ⇒ ~32 mixed).
 *
 * The `category` param DOES filter server-side — confirmed by live test
 * 2026-06-28: category=c1/c4/c5/c2 returned a clean 8/8/8/8 split. The merge
 * step also buckets items by `contentscd.value` and caps each bucket at
 * `perCategory`, so even if the server ever ignored `category` the result would
 * still come back balanced (defensive fallback path).
 *
 * Never throws. All-fail ⇒ { ok: false, error }; partial success ⇒ ok:true.
 */
export async function fetchVisitJejuPlaces(options?: {
  categories?: string[]
  perCategory?: number
}): Promise<
  | { ok: true; places: VisitJejuPlace[]; totalCount: number }
  | { ok: false; error: string }
> {
  if (!process.env.VISITJEJU_API_KEY) {
    return { ok: false, error: 'VisitJeju API 키가 설정되지 않았습니다 (VISITJEJU_API_KEY).' }
  }

  const categories =
    options?.categories && options.categories.length > 0
      ? options.categories
      : [...VISITJEJU_DEFAULT_CATEGORIES]
  const perCategory =
    options?.perCategory && options.perCategory > 0
      ? options.perCategory
      : VISITJEJU_DEFAULT_PER_CATEGORY

  // 4 small parallel calls, one per category value.
  const settled = await Promise.all(
    categories.map(async (category) => {
      const url = buildVisitJejuUrl({ category, perPage: perCategory })
      const r = await fetchJsonAt(url)
      if (!r.ok) return { category, ok: false as const, error: r.error }
      return {
        category,
        ok: true as const,
        items: visitJejuItems(r.parsed),
        totalCount: visitJejuTotalCount(r.parsed),
      }
    })
  )

  const succeeded = settled.filter((s): s is Extract<typeof s, { ok: true }> => s.ok)
  if (succeeded.length === 0) {
    const firstError = settled.find((s) => !s.ok)
    const detail = firstError && !firstError.ok ? `: ${firstError.error}` : ''
    return { ok: false, error: `VisitJeju 데이터를 불러오지 못했습니다${detail}` }
  }

  // Map + bucket by category, capping each bucket at perCategory. This produces a
  // balanced mix whether or not the server actually honored the `category` param
  // (if it ignored it, every response is c5-heavy but bucketing still rebalances).
  const buckets = new Map<string, VisitJejuPlace[]>()
  const seen = new Set<string>()
  let totalCount = 0

  for (const s of succeeded) {
    totalCount = Math.max(totalCount, s.totalCount)
    for (const raw of s.items) {
      const place = mapVisitJejuItem(raw)
      if (place.contentsId && seen.has(place.contentsId)) continue
      if (place.contentsId) seen.add(place.contentsId)
      const key = place.categoryCode || 'etc'
      const bucket = buckets.get(key) ?? []
      if (bucket.length >= perCategory) continue
      bucket.push(place)
      buckets.set(key, bucket)
    }
  }

  // Interleave buckets round-robin so the grid alternates categories instead of
  // showing all of one type before the next.
  const ordered: VisitJejuPlace[] = []
  const lists = Array.from(buckets.values())
  for (let i = 0; lists.some((l) => i < l.length); i++) {
    for (const list of lists) {
      if (i < list.length) ordered.push(list[i]!)
    }
  }

  return { ok: true, places: ordered, totalCount: totalCount || ordered.length }
}

// ─────────────────────────────────────────────────────────────────────────────
// VisitJeju LARGER POOL + client-side keyword filter (tourist recommendation)
//
// WHY: searchList does NOT support keyword search — title=/keyword=/tag= params
// are ignored and it always returns the full 5,724-row set (confirmed live). It
// DOES support category filtering (category=c1/c4/c5/c2/c6) and pagination
// (page=1..N, pageSize=100). So to get a query-relevant set we build a LARGER
// pool by paging per category, then match keywords CLIENT-SIDE against the
// already-fetched text. (API params stay ASCII-only; see buildVisitJejuUrl.)
// ─────────────────────────────────────────────────────────────────────────────

/** Categories pooled by default: 관광지/음식점/축제/쇼핑/테마여행. */
const VISITJEJU_POOL_CATEGORIES: readonly string[] = ['c1', 'c4', 'c5', 'c2', 'c6']
/** Pages fetched per category by default (pageSize 100 ⇒ up to ~300/category). */
const VISITJEJU_POOL_PAGES_PER_CATEGORY = 3
/** searchList hard max rows per page. */
const VISITJEJU_POOL_PAGE_SIZE = 100

/**
 * Builds a LARGE deduped pool of VisitJeju places by paging across categories.
 *
 * For each category, fetches pages 1..pagesPerCategory (ASCII params only) via
 * the shared fetchJsonAt helper. All page requests run in parallel; results are
 * mapped via the shared mapVisitJejuItem and deduped by contentsId across every
 * page/category. Never throws — on total failure returns [].
 */
export async function fetchVisitJejuPool(options?: {
  categories?: string[]
  pagesPerCategory?: number
}): Promise<VisitJejuPlace[]> {
  try {
    if (!process.env.VISITJEJU_API_KEY) return []

    const categories =
      options?.categories && options.categories.length > 0
        ? options.categories
        : [...VISITJEJU_POOL_CATEGORIES]
    const pagesPerCategory =
      options?.pagesPerCategory && options.pagesPerCategory > 0
        ? options.pagesPerCategory
        : VISITJEJU_POOL_PAGES_PER_CATEGORY

    // One request descriptor per (category, page) — fired in parallel.
    const requests: Array<{ category: string; page: number }> = []
    for (const category of categories) {
      for (let page = 1; page <= pagesPerCategory; page++) {
        requests.push({ category, page })
      }
    }

    const settled = await Promise.all(
      requests.map(async ({ category, page }) => {
        const url = buildVisitJejuUrl({ category, page, perPage: VISITJEJU_POOL_PAGE_SIZE })
        const r = await fetchJsonAt(url)
        return r.ok ? visitJejuItems(r.parsed) : []
      })
    )

    const seen = new Set<string>()
    const pool: VisitJejuPlace[] = []
    for (const items of settled) {
      for (const raw of items) {
        const place = mapVisitJejuItem(raw)
        if (place.contentsId) {
          if (seen.has(place.contentsId)) continue
          seen.add(place.contentsId)
        }
        pool.push(place)
      }
    }
    return pool
  } catch {
    return []
  }
}

/** Pool freshness window — 6 hours. */
const VISITJEJU_POOL_TTL_MS = 6 * 60 * 60 * 1000

/**
 * In-memory pool cache. NOTE: this is per-server-instance memory only (resets on
 * cold start / redeploy and is not shared across instances) — fine for the demo.
 * A persistent/shared cache (e.g. KV or DB-backed) is a later optimization.
 */
let _poolCache: { at: number; places: VisitJejuPlace[] } | null = null

/** Returns the cached pool when younger than the TTL, else refetches and caches. */
export async function getVisitJejuPool(): Promise<VisitJejuPlace[]> {
  const now = Date.now()
  if (_poolCache && now - _poolCache.at < VISITJEJU_POOL_TTL_MS) {
    return _poolCache.places
  }
  const places = await fetchVisitJejuPool()
  // Only cache a non-empty result so a transient total failure doesn't pin [].
  if (places.length > 0) {
    _poolCache = { at: now, places }
  }
  return places
}

/**
 * Client-side stand-in for the missing keyword-search API. Keeps a place when
 * ANY keyword appears (case-insensitive substring) in its
 * title + rawTags + introduction + categoryLabel + region. Order preserved.
 * Returns [] when nothing matches (caller decides any fallback).
 */
export function filterPlacesByQuery(
  places: VisitJejuPlace[],
  keywords: string[]
): VisitJejuPlace[] {
  const needles = keywords.map((k) => k.trim().toLowerCase()).filter((k) => k !== '')
  if (needles.length === 0) return []

  return places.filter((p) => {
    const haystack = `${p.title} ${p.rawTags} ${p.introduction} ${p.categoryLabel} ${p.region}`.toLowerCase()
    return needles.some((n) => haystack.includes(n))
  })
}
