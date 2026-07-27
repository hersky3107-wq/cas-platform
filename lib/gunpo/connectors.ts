import 'server-only'

import { XMLParser } from 'fast-xml-parser'

import { extract, type ExtractedContent } from '@/lib/extract'

/**
 * GUNPO public-data connector registry (cloned from lib/motie/connectors.ts).
 *
 * STEP 2 (구조 복제) STATE: only the nationwide sources that can be narrowed to
 * 군포시 via a region parameter were kept (KMA short/mid-term/warning weather,
 * KAMIS agricultural prices, KECO EV chargers). KOTRA/한국수출입은행(수출 전용),
 * VisitJeju/올레코스(제주 관광 전용), and the remaining Jeju-only statistics
 * (제주 전력망, 감귤 생산, 항만 물동량, 관광객 통계) were deleted — see the
 * step-2 report for the full disposition list. Every region parameter below is
 * a TODO placeholder (never hardcoded) — filling them in is a later step.
 *
 * DESIGN CONSTRAINT — loosely coupled & self-contained:
 *   This module is the data backbone for the 군포 governance site. It may
 *   import from `lib/extract`, but it must NOT be imported by or wired into any
 *   existing AIMANI module, router, or credit system, nor by lib/jeju or
 *   lib/motie. Keeping the dependency arrow one-directional (gunpo → extract)
 *   means the whole `lib/gunpo` folder can later be lifted into a standalone
 *   project with only `lib/extract` coming along for the ride.
 */

export type JejuSourceFormat = 'xml' | 'json' | 'csv'

export type JejuMode = 'governance' | 'tourist' | 'resident' | 'trade' | 'warroom'

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
 * KMA 중기예보 region codes. These DIFFER between the two sub-APIs:
 *   - 중기기온(getMidTa) uses a station-like code.
 *   - 중기육상예보(getMidLandFcst) uses a broader land region code.
 *
 * CONFIRMED (STEP4): 군포시 → 경기도 남부/수원 권역. 중기기온 11B20601 /
 * 중기육상예보 11B00000 (data.go.kr 중기예보 조회지점 코드표 기준, 원래 제주 코드는
 * 11G00201 / 11G00000였음).
 */
export const JEJU_MIDTA_REGID = '11B20601'
export const JEJU_MIDLAND_REGID = '11B00000'

/**
 * KAMIS 가격 피드의 지역 필터. 현재 구현은 실제 "지역 파라미터"가 아니라
 * item_name에 대한 품목명 substring 필터다(제주 원본: 양배추/당근/한라봉/감귤 등).
 *
 * TODO(군포): 군포(수도권 원예·화훼 등)에서 의미 있는 품목명으로 채울 것. 더 나아가
 * KAMIS API 자체가 제공하는 지역 코드 파라미터(p_countycode 등)로 전환하면 진짜
 * "지역" 필터가 되지만, 그건 buildUrl 자체를 바꿔야 하는 별도 작업이다.
 */
export const JEJU_KAMIS_ITEMS: readonly string[] = []

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

/** CONFIRMED (STEP4): 군포시 기상격자 좌표 (기상청 격자 좌표 변환표 기준). */
export const GUNPO_KMA_NX = '59'
export const GUNPO_KMA_NY = '122'

/** CONFIRMED (STEP4): 군포시 관할 기상특보구역 코드 (경기도 남부/수원 권역). */
export const GUNPO_KMA_WARN_STNID = '109'

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

  const whenLabel = formatKmaObservedAt(baseDate, baseTime)
  const headerLine = `초단기실황 (경기도 군포시 · 기상청 기준)${whenLabel ? ` — ${whenLabel}` : ''}`
  return { text: `${headerLine}\n${readings.join(', ')}` }
}

/** Formats a YYYYMMDD/HHmm pair into a friendly "N월 N일 HH:mm" string (no suffix). */
function formatKmaDateTime(baseDate: string, baseTime: string): string {
  if (!/^\d{8}$/.test(baseDate) || !/^\d{3,4}$/.test(baseTime)) return ''
  const month = Number(baseDate.slice(4, 6))
  const day = Number(baseDate.slice(6, 8))
  const hhmm = baseTime.padStart(4, '0')
  return `${month}월 ${day}일 ${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}`
}

/** Formats a KMA baseDate(YYYYMMDD)/baseTime(HHmm) pair into a friendly "N월 N일 HH:mm 관측" string. */
function formatKmaObservedAt(baseDate: string, baseTime: string): string {
  const dt = formatKmaDateTime(baseDate, baseTime)
  return dt ? `${dt} 관측` : ''
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
    if (parts.length === 0) continue // 결측 항목은 노출하지 않음 (P0-1)
    lines.push(`${n}일후: ${parts.join(', ')}`)
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
  if (!taItem) notes.push('※ 기온 전망 정보를 일부 가져오지 못했어요.')
  if (!landItem) notes.push('※ 날씨·강수 전망 정보를 일부 가져오지 못했어요.')

  const lines = renderMidtermLines(taItem, landItem)
  if (lines.length === 0) {
    return { error: '중기예보 데이터 없음' }
  }
  const headerLine = '중기예보 (경기도 군포시 · 기상청 기준)'
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
 * Renders the KPX SMP + demand-forecast JSON for MAINLAND (육지) only — the
 * warroom variant. Identical shape to renderJejuSmp but filters areaName === '육지'
 * instead of '제주', so the national resource/energy panel sees the mainland
 * market. kpx-jeju-smp is left untouched.
 */
function renderMainlandSmp(rawJson: unknown): { text: string } | { error: string } {
  const env = readDataGoKrEnvelope(rawJson)
  if (!env.ok) return { error: env.error }
  if (env.code !== '00') {
    return { error: `resultCode ${env.code || 'missing'}${env.msg ? `: ${env.msg}` : ''}` }
  }

  const mainland = env.items.filter((it) => String(it.areaName ?? '').trim() === '육지')
  if (mainland.length === 0) {
    return { error: '육지(areaName=육지) SMP 항목이 없습니다.' }
  }

  const rows = mainland
    .map((it) => ({
      hour: parseNum(it.hour),
      smp: parseNum(it.smp),
      slfd: parseNum(it.slfd),
    }))
    .filter((r) => r.hour !== null)
    .sort((a, b) => (a.hour ?? 0) - (b.hour ?? 0))

  const smps = rows.map((r) => r.smp).filter((v): v is number => v !== null)
  const date = String(mainland[0]?.date ?? kstYmd()).trim()

  const headerLine = `육지 계통한계가격(SMP)·수요예측 — ${date} 기준 (출처: 한국전력거래소/data.go.kr, 육지 계통)`

  let summaryLine = '육지 계통한계가격(SMP, 원/kWh): (수치 없음)'
  if (smps.length > 0) {
    const min = Math.min(...smps)
    const max = Math.max(...smps)
    const avg = smps.reduce((s, v) => s + v, 0) / smps.length
    const peak = rows.find((r) => r.smp === max)
    const round = (n: number) => Math.round(n * 100) / 100
    summaryLine =
      `육지 계통한계가격(SMP, 원/kWh) 최저 ${round(min)} / 최고 ${round(max)} / 평균 ${round(avg)}` +
      (peak?.hour != null ? ` · 최고가 시간대 ${peak.hour}시` : '')
  }

  const hourLines = rows.map((r) => {
    const parts: string[] = []
    parts.push(`육지 계통한계가격(SMP, 원/kWh) ${r.smp != null ? r.smp : '?'}`)
    if (r.slfd != null) parts.push(`육지 수요예측(KPX 추정) ${r.slfd}`)
    return `${String(r.hour).padStart(2, '0')}시: ${parts.join(', ')}`
  })

  return { text: [headerLine, '', summaryLine, '', ...hourLines].join('\n') }
}

/** KPX 발전원별 발전량(계통기준) fuel columns → Korean names (fuelPwr1..9). */
const KPX_GEN_FUELS: ReadonlyArray<{ key: string; ko: string }> = [
  { key: 'fuelPwr1', ko: '수력' },
  { key: 'fuelPwr2', ko: '유류' },
  { key: 'fuelPwr3', ko: '유연탄' },
  { key: 'fuelPwr4', ko: '원자력' },
  { key: 'fuelPwr5', ko: '양수' },
  { key: 'fuelPwr6', ko: '가스' },
  { key: 'fuelPwr7', ko: '국내탄' },
  { key: 'fuelPwr8', ko: '신재생' },
  { key: 'fuelPwr9', ko: '태양광' },
]

/** Formats YYYYMMDDHHmmss → 'YYYY-MM-DD HH:mm'. Returns the raw string on miss. */
function fmtKpxDatetime(raw: unknown): string {
  const s = String(raw ?? '').trim()
  return /^\d{14}$/.test(s)
    ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}`
    : s
}

/**
 * Renders the KPX 발전원별 발전량(계통기준) JSON — nationwide (육지+제주 결합).
 * Takes the LATEST baseDatetime row and renders each fuel's instantaneous output
 * (MW) with its % share of fuelPwrTot, sorted desc. Skips zero fuels. Values are
 * 순간출력(MW), NOT cumulative MWh.
 */
function renderGenMix(rawJson: unknown): { text: string } | { error: string } {
  const env = readDataGoKrEnvelope(rawJson)
  if (!env.ok) return { error: env.error }
  if (env.code !== '00') {
    return { error: `resultCode ${env.code || 'missing'}${env.msg ? `: ${env.msg}` : ''}` }
  }
  if (env.items.length === 0) {
    return { error: '발전원별 발전량 항목이 없습니다 (빈 응답).' }
  }

  // Pick the latest 5-min slot by max baseDatetime.
  const latest = env.items.reduce((best, it) => {
    const a = String(it.baseDatetime ?? '').trim()
    const b = String(best.baseDatetime ?? '').trim()
    return a > b ? it : best
  }, env.items[0]!)

  const total = parseNum(latest.fuelPwrTot)
  const fuels = KPX_GEN_FUELS.map(({ key, ko }) => ({ ko, mw: parseNum(latest[key]) }))
    .filter((f): f is { ko: string; mw: number } => f.mw !== null && f.mw > 0)
    .sort((a, b) => b.mw - a.mw)

  if (fuels.length === 0) {
    return { error: '발전원별 발전량: 유효한 발전원 수치가 없습니다.' }
  }

  const when = fmtKpxDatetime(latest.baseDatetime)
  const round = (n: number) => Math.round(n * 100) / 100
  const header = `전국 발전원별 발전량 (출처: 한국전력거래소/data.go.kr, 육지+제주 계통, 순간출력 MW, 기준시각 ${when})`
  const note = '※ 수치는 순간출력(MW)이며 누적 발전량(MWh)이 아님.'
  const totalLine =
    total != null && total > 0 ? `합계: ${round(total).toLocaleString()} MW` : '합계: (수치 없음)'

  const lines = fuels.map((f) => {
    const share = total != null && total > 0 ? ` (${((f.mw / total) * 100).toFixed(1)}%)` : ''
    return `- ${f.ko}: ${round(f.mw).toLocaleString()} MW${share}`
  })

  return { text: [header, note, '', totalLine, ...lines].join('\n') }
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
/** True when a KECO item's sggNm (시군구명) names Gunpo city (군포시). */
function isGunpoSgg(item: Record<string, unknown>): boolean {
  const sgg = typeof item.sggNm === 'string' ? item.sggNm.trim() : ''
  return sgg.includes('군포')
}

function aggregateKecoEvChargerItems(
  itemsAllGyeonggi: Record<string, unknown>[]
): { text: string } | { error: string } {
  // Only 군포시 rows are shown to users — 경기도 전역 조회는 API 제약(rgnNm은 시도
  // 단위까지만 지원)에 따른 것일 뿐, 타 시군구 분포·수집 메타는 사용자에게 무의미하다 (P0-3).
  const items = itemsAllGyeonggi.filter(isGunpoSgg)
  if (items.length === 0) {
    return { error: '군포시 전기차 충전소 데이터 없음' }
  }

  const stationSet = new Set<string>()
  const frmCounts: Record<string, number> = {}
  const capacities: number[] = []
  const yrCounts: Record<string, number> = {}

  for (const item of items) {
    const stationId = typeof item.chgstnId === 'string' ? item.chgstnId.trim() : ''
    if (stationId) stationSet.add(stationId)

    const frm = typeof item.chrgrFrm === 'string' ? item.chrgrFrm.trim() : '(미상)'
    frmCounts[frm] = (frmCounts[frm] ?? 0) + 1

    const cpct = parseNum(item.chrgrCpct)
    if (cpct != null) capacities.push(cpct)

    const yr = typeof item.rlvtYr === 'string' ? item.rlvtYr.trim() : ''
    if (yr) yrCounts[yr] = (yrCounts[yr] ?? 0) + 1
  }

  const headerLine = '전기차 충전 인프라 현황 (경기도 군포시 · 환경부/KECO 기준)'
  const stationLine = `고유 충전소 수: ${stationSet.size.toLocaleString()}개소`

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
    text: [headerLine, '', stationLine, frmLine, capacityLine, yrLine].join('\n'),
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
  // CONFIRMED (STEP4): rgnNm='경기도' (원본 제주는 '제주특별자치도').
  const baseParams = {
    serviceKey: key,
    returnType: 'JSON',
    numOfRows: '100',
    rgnNm: '경기도',
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

  return aggregateKecoEvChargerItems(combined)
}

/**
 * Renders the KMA 기상특보(getWthrWrnList) JSON for a given stnId. Checks the
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
    return { text: '기상특보: 현재 발효 중인 기상특보 없음 (경기도 군포시 · 기상청 기준)' }
  }

  // Newest first by tmFc (발표시각, numeric).
  const sorted = [...env.items].sort((a, b) => (parseNum(b.tmFc) ?? 0) - (parseNum(a.tmFc) ?? 0))
  const lines = sorted
    .map((it) => {
      const title = typeof it.title === 'string' ? it.title.trim() : ''
      const tmFcRaw = typeof it.tmFc === 'string' || typeof it.tmFc === 'number' ? String(it.tmFc) : ''
      const tmFcLabel = /^\d{12}$/.test(tmFcRaw)
        ? formatKmaDateTime(tmFcRaw.slice(0, 8), tmFcRaw.slice(8, 12))
        : ''
      if (!title) return ''
      return tmFcLabel ? `- ${title} (${tmFcLabel} 발표)` : `- ${title}`
    })
    .filter((l) => l !== '')

  if (lines.length === 0) {
    return { text: '기상특보: 현재 발효 중인 기상특보 없음 (경기도 군포시 · 기상청 기준)' }
  }
  return { text: ['기상특보 (경기도 군포시 · 기상청 기준, 최근 발표순)', ...lines].join('\n') }
}

// ─────────────────────────────────────────────────────────────────────────────
// 국토교통부_아파트 매매 실거래가 상세 자료 (RTMSDataSvcAptTradeDev) — NEW (STEP4).
// XML-native API (response.header.resultCode + response.body.items.item[]).
// Params: serviceKey, LAWD_CD (법정동코드 앞5자리), DEAL_YMD (계약년월 6자리),
// pageNo, numOfRows. Uses the shared data.go.kr key (same as every other
// connector in this file — no new env var).
// ─────────────────────────────────────────────────────────────────────────────

/** CONFIRMED (STEP4): 군포시 법정동코드 앞 5자리 (행정표준코드관리시스템 기준). */
export const GUNPO_APT_LAWD_CD = '41410'

const APT_TRADE_URL =
  'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev'

/** Local string coercion (connectors.ts has no shared `str` helper). */
function aptStr(v: unknown): string {
  return v === undefined || v === null ? '' : String(v).trim()
}

function aptBodySnippet(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 300)
}

/** KST year-month as YYYYMM, optionally offset by whole months (for DEAL_YMD). */
function kstYearMonth(offsetMonths = 0): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const shifted = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() + offsetMonths, 1))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${shifted.getUTCFullYear()}${pad(shifted.getUTCMonth() + 1)}`
}

function buildAptTradeUrl(lawdCd: string, dealYmd: string): string {
  const key = dataGoKrKey()
  const params = new URLSearchParams({
    serviceKey: key,
    LAWD_CD: lawdCd,
    DEAL_YMD: dealYmd,
    pageNo: '1',
    numOfRows: '200',
  })
  return `${APT_TRADE_URL}?${params.toString()}`
}

/** Plain GET returning raw response text (this API is XML, not JSON). Never throws. */
async function fetchTextAt(url: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'application/xml,text/xml,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (compatible; Gunpo-Connectors/1.0)',
      },
      cache: 'no-store',
    })
    const text = await res.text()
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} — ${aptBodySnippet(text)}` }
    if (text.trim() === '') return { ok: false, error: 'Empty response body' }
    return { ok: true, text }
  } catch (e: unknown) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    return {
      ok: false,
      error: aborted
        ? `Timeout after ${FETCH_TIMEOUT_MS}ms`
        : `Network error: ${e instanceof Error ? e.message : String(e)}`,
    }
  } finally {
    clearTimeout(timer)
  }
}

function toArray<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[]
  if (v === undefined || v === null || v === '') return []
  return [v as T]
}

const APT_PARSER = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true })

interface AptTradeEnvelope {
  response?: {
    header?: { resultCode?: unknown; resultMsg?: unknown }
    body?: { items?: { item?: unknown } | string }
  }
}

interface AptTradeRow {
  aptNm: string
  dealAmount: string
  excluUseAr: string
  floor: string
  buildYear: string
  umdNm: string
  dealDate: string
}

/** Only the 6 fields the STEP4 spec asked for: 아파트명/거래금액/전용면적/층/건축년도/법정동. */
function toAptTradeRow(raw: Record<string, unknown>): AptTradeRow | null {
  const aptNm = aptStr(raw.aptNm)
  if (!aptNm) return null
  const amountRaw = aptStr(raw.dealAmount).replace(/,/g, '')
  const amountNum = Number(amountRaw)
  const y = aptStr(raw.dealYear)
  const m = aptStr(raw.dealMonth).padStart(2, '0')
  const d = aptStr(raw.dealDay).padStart(2, '0')
  return {
    aptNm,
    dealAmount: Number.isFinite(amountNum) && amountRaw ? `${amountNum.toLocaleString()}만원` : (amountRaw || '?'),
    excluUseAr: aptStr(raw.excluUseAr),
    floor: aptStr(raw.floor),
    buildYear: aptStr(raw.buildYear),
    umdNm: aptStr(raw.umdNm),
    dealDate: y && m !== '00' && d !== '00' ? `${y}-${m}-${d}` : '',
  }
}

/**
 * Fetches + parses ONE month of 군포시 아파트 매매 실거래가. XML-native, but we
 * still guard against the same "error envelope despite the expected format"
 * failure mode documented for TAGO: any body that fails XML parsing, or whose
 * resultCode isn't '00', comes back as a plain `error` string — never throws.
 */
async function fetchAptTradeMonth(
  dealYmd: string
): Promise<{ ok: true; rows: AptTradeRow[] } | { ok: false; error: string }> {
  const fetched = await fetchTextAt(buildAptTradeUrl(GUNPO_APT_LAWD_CD, dealYmd))
  if (!fetched.ok) return { ok: false, error: fetched.error }

  const trimmed = fetched.text.trim()
  let parsed: AptTradeEnvelope
  try {
    parsed = APT_PARSER.parse(trimmed) as AptTradeEnvelope
  } catch (e: unknown) {
    return {
      ok: false,
      error: `XML parse error (${e instanceof Error ? e.message : String(e)}) — ${aptBodySnippet(trimmed)}`,
    }
  }

  const resp = parsed.response
  if (!resp || typeof resp !== 'object') {
    return { ok: false, error: `Unexpected response shape — ${aptBodySnippet(trimmed)}` }
  }
  const code = aptStr(resp.header?.resultCode)
  const msg = aptStr(resp.header?.resultMsg)
  // '03' (NODATA) is a benign empty-month result, not a failure.
  if (code === '03') return { ok: true, rows: [] }
  if (code && code !== '00') {
    return { ok: false, error: `resultCode ${code}${msg ? `: ${msg}` : ''}` }
  }

  const itemsRaw = resp.body?.items
  const itemRaw =
    itemsRaw && typeof itemsRaw === 'object' ? (itemsRaw as Record<string, unknown>).item : undefined
  const rows = toArray<Record<string, unknown>>(itemRaw)
    .map(toAptTradeRow)
    .filter((r): r is AptTradeRow => r !== null)
  return { ok: true, rows }
}

/**
 * Custom fetch for 아파트 매매 실거래가: tries the current KST year-month first,
 * then falls back one month if the current month has zero rows (실거래 신고는
 * 계약 후 최대 30일 이내이므로 이번 달 초에는 데이터가 비어 있는 게 정상). An actual
 * upstream error (bad key, resultCode failure, network) is surfaced as-is and
 * does NOT trigger the fallback. Never throws.
 */
async function fetchAptTrade(): Promise<{ text: string } | { error: string }> {
  if (!GUNPO_APT_LAWD_CD) {
    return { error: '아파트 매매 실거래가: LAWD_CD가 설정되지 않았습니다.' }
  }

  const currentYm = kstYearMonth(0)
  const current = await fetchAptTradeMonth(currentYm)
  if (!current.ok) {
    return { error: `아파트 매매 실거래가 수집 실패 (${currentYm}): ${current.error}` }
  }

  let effectiveYm = currentYm
  let rows = current.rows
  if (rows.length === 0) {
    const prevYm = kstYearMonth(-1)
    const prev = await fetchAptTradeMonth(prevYm)
    if (prev.ok && prev.rows.length > 0) {
      effectiveYm = prevYm
      rows = prev.rows
    }
  }

  if (rows.length === 0) {
    return {
      text: `아파트 매매 실거래가 (LAWD_CD=${GUNPO_APT_LAWD_CD}, ${effectiveYm}) — 해당 월 신고된 거래 없음.`,
    }
  }

  const header = `아파트 매매 실거래가 (출처: 국토교통부/data.go.kr RTMSDataSvcAptTradeDev, LAWD_CD=${GUNPO_APT_LAWD_CD}, 계약년월 ${effectiveYm}, ${rows.length}건)`
  const lines = [...rows]
    .sort((a, b) => b.dealDate.localeCompare(a.dealDate))
    .map(
      (r) =>
        `- ${r.dealDate || '날짜미상'} ${r.aptNm}(${r.umdNm || '동미상'}) 전용 ${r.excluUseAr || '?'}㎡ ${r.floor || '?'}층 ${r.dealAmount} (건축년도 ${r.buildYear || '?'})`
    )

  return { text: [header, ...lines].join('\n') }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETED (per STEP 2 결정 A): VisitJeju 관광지 검색, KOTRA 국가정보, KOTRA
// 상품DB, 한국수출입은행 환율 — all Jeju-tourism/export-only sources with no
// region parameter applicable to 군포시. Removed entirely (not left as dead
// code) because fetchKoreaeximFx referenced an exchange-rate helper that was
// never carried over to lib/gunpo, which broke the type-check.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// WARROOM mode sources (자원·에너지 워룸): 오피넷 유가 + 가스공사 대륙별 LNG 수입.
//
// councilMode==='warroom' gathers THESE instead of the governance sources (see
// lib/motie/brief.ts WARROOM_SOURCE_IDS). Both are defensive — they never throw
// and any failure becomes an ok:false snapshot entry — so the engine still runs
// if one is unavailable. Keys come strictly from process.env (never hardcoded):
// Opinet uses its OWN OPINET_API_KEY; 가스공사 uses the shared data.go.kr key.
// ─────────────────────────────────────────────────────────────────────────────

/** Opinet product codes → Korean display names (national-average fuel prices). */
const OPINET_PRODUCTS: ReadonlyArray<{ code: string; ko: string }> = [
  { code: 'B027', ko: '휘발유' },
  { code: 'D047', ko: '자동차용경유' },
  { code: 'B034', ko: '고급휘발유' },
  { code: 'C004', ko: '실내등유' },
  { code: 'K015', ko: '자동차용부탄(LPG)' },
]

/** Extracts the RESULT.OIL[] array from an Opinet JSON envelope. Returns [] on miss. */
function extractOpinetOil(parsed: unknown): Record<string, unknown>[] {
  if (!parsed || typeof parsed !== 'object') return []
  const result = (parsed as Record<string, unknown>).RESULT
  if (!result || typeof result !== 'object') return []
  const oil = (result as Record<string, unknown>).OIL
  return Array.isArray(oil) ? (oil as Record<string, unknown>[]) : []
}

/** Formats a YYYYMMDD string as YYYY-MM-DD (Opinet TRADE_DT/DATE). */
function fmtYmd(raw: unknown): string {
  const s = String(raw ?? '').trim()
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s
}

/**
 * 오피넷 유가 (한국석유공사 Opinet) — national average retail fuel prices (원/L),
 * with the day-over-day change and a short 7-day trend for 휘발유·경유. Reads
 * OPINET_API_KEY strictly from process.env (Opinet's own key, NOT data.go.kr).
 * Endpoints: avgAllPrice.do (today's national avg) + avgRecentPrice.do (7-day).
 * Never throws.
 */
async function fetchOpinetFuelPrices(): Promise<{ text: string } | { error: string }> {
  const key = process.env.OPINET_API_KEY ?? ''
  if (!key) return { error: 'Opinet 서비스키가 설정되지 않았습니다 (OPINET_API_KEY).' }

  const enc = encodeURIComponent(key)
  const [allRes, recentRes] = await Promise.all([
    fetchJsonAt(`http://www.opinet.co.kr/api/avgAllPrice.do?out=json&code=${enc}`),
    fetchJsonAt(`http://www.opinet.co.kr/api/avgRecentPrice.do?out=json&code=${enc}`),
  ])

  if (!allRes.ok) return { error: `오피넷 유가 수집 실패: ${allRes.error}` }
  const oil = extractOpinetOil(allRes.parsed)
  if (oil.length === 0) return { error: '오피넷 유가 데이터 없음 (빈 응답)' }

  const byCode = new Map<string, Record<string, unknown>>()
  for (const it of oil) {
    const code = String(it.PRODCD ?? '').trim()
    if (code) byCode.set(code, it)
  }

  const tradeDt = fmtYmd(oil[0]?.TRADE_DT)
  const lines: string[] = []
  for (const { code, ko } of OPINET_PRODUCTS) {
    const it = byCode.get(code)
    if (!it) continue
    const price = Number(it.PRICE)
    if (!Number.isFinite(price) || price <= 0) continue
    const diffRaw = String(it.DIFF ?? '').trim()
    const diff = diffRaw && diffRaw !== '0.00' ? ` (전일대비 ${diffRaw}원)` : ''
    lines.push(`- ${ko}: ${price.toLocaleString()}원/L${diff}`)
  }
  if (lines.length === 0) return { error: '오피넷 유가: 유효한 가격 항목이 없습니다.' }

  // 7-day trend for 휘발유(B027)·경유(D047): oldest → newest weekly change.
  const trendLines: string[] = []
  if (recentRes.ok) {
    const recent = extractOpinetOil(recentRes.parsed)
    for (const { code, ko } of OPINET_PRODUCTS.filter((p) => p.code === 'B027' || p.code === 'D047')) {
      const series = recent
        .filter((r) => String(r.PRODCD ?? '').trim() === code)
        .map((r) => ({ date: String(r.DATE ?? '').trim(), price: Number(r.PRICE) }))
        .filter((r) => r.date && Number.isFinite(r.price))
        .sort((a, b) => a.date.localeCompare(b.date))
      if (series.length >= 2) {
        const first = series[0]!
        const last = series[series.length - 1]!
        const delta = last.price - first.price
        const sign = delta > 0 ? '+' : ''
        trendLines.push(
          `- ${ko}: ${fmtYmd(first.date)} ${first.price.toLocaleString()}원 → ${fmtYmd(last.date)} ${last.price.toLocaleString()}원 (주간 ${sign}${delta.toFixed(2)}원)`
        )
      }
    }
  }

  const header = `전국 평균 주유소 판매가격 (출처: 한국석유공사 오피넷, 기준일 ${tradeDt})`
  const trendBlock = trendLines.length ? ['', '[최근 7일 추이]', ...trendLines] : []
  return { text: [header, ...lines, ...trendBlock].join('\n') }
}

/** data.go.kr file-data (odcloud) uddi for KOGAS 대륙별 천연가스 수입 현황 (15088508). */
const KOGAS_LNG_UDDI = 'uddi:ef62493e-1dbe-4c13-9e5a-dbe2ab25b636'

/** Continents present as column suffixes in the KOGAS LNG dataset. */
const KOGAS_CONTINENTS = [
  '아시아',
  '중동',
  '오세아니아',
  '북아메리카',
  '중남미',
  '유럽',
  '아프리카',
  '러시아',
  '기타',
] as const

/** Reads a numeric cell (`중량(ton)(아시아)` etc.), tolerating string/number. */
function kogasNum(row: Record<string, unknown>, key: string): number {
  const v = row[key]
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim())
  return Number.isFinite(n) ? n : 0
}

/** Weight column key differs for 오세아니아 (`중량(ton)(오세아니아)`) vs others (`중량(대륙)`). */
function kogasWeightKey(row: Record<string, unknown>, continent: string): string {
  const withTon = `중량(ton)(${continent})`
  if (withTon in row) return withTon
  const plain = `중량(${continent})`
  return plain in row ? plain : withTon
}

/** Renders one KOGAS month row into a continent breakdown block. */
function renderKogasMonth(row: Record<string, unknown>): string {
  const year = kogasNum(row, '연도')
  const month = kogasNum(row, '월')
  const rows = KOGAS_CONTINENTS.map((c) => {
    const weight = kogasNum(row, kogasWeightKey(row, c))
    const amount = kogasNum(row, `금액(${c})`)
    const unit = Number(String(row[`단위가격(${c})`] ?? '').trim())
    return { continent: c, weight, amount, unit: Number.isFinite(unit) ? unit : 0 }
  }).filter((r) => r.weight > 0)

  rows.sort((a, b) => b.weight - a.weight)
  const totalWeight = rows.reduce((s, r) => s + r.weight, 0)

  const lines = rows.map((r) => {
    const share = totalWeight > 0 ? ((r.weight / totalWeight) * 100).toFixed(1) : '0.0'
    const unit = r.unit > 0 ? `, 단위가격 ${r.unit.toFixed(1)} USD/ton` : ''
    return `  - ${r.continent}: ${Math.round(r.weight).toLocaleString()}톤 (${share}%)${unit}`
  })

  return [`[${year}년 ${month}월 대륙별 수입]  총 ${Math.round(totalWeight).toLocaleString()}톤`, ...lines].join('\n')
}

/** Shared data.go.kr portal key (same env the governance connectors read). */
function dataGoKrKey(): string {
  return process.env.DATA_GO_KR_KEY ?? process.env.KPX_SERVICE_KEY ?? ''
}

/**
 * 가스공사 대륙별 LNG 수입 (한국가스공사_한국의 대륙별 천연가스 수입 현황) — via the
 * data.go.kr file-data (odcloud) API. Rows are monthly from 1988 ascending, so we
 * fetch the tail and render the latest month's continent breakdown plus a short
 * trend vs the previous month. Uses the shared data.go.kr key. Never throws.
 */
async function fetchKogasLng(): Promise<{ text: string } | { error: string }> {
  const key = dataGoKrKey()
  if (!key) return { error: 'data.go.kr 서비스키가 설정되지 않았습니다 (DATA_GO_KR_KEY).' }

  const params = new URLSearchParams({ page: '1', perPage: '600', serviceKey: key })
  const url = `https://api.odcloud.kr/api/15088508/v1/${KOGAS_LNG_UDDI}?${params.toString()}`
  const r = await fetchJsonAt(url)
  if (!r.ok) return { error: `가스공사 LNG 수입 수집 실패: ${r.error}` }

  const root = r.parsed && typeof r.parsed === 'object' ? (r.parsed as Record<string, unknown>) : null
  const data = root && Array.isArray(root.data) ? (root.data as Record<string, unknown>[]) : []
  if (data.length === 0) return { error: '가스공사 LNG 수입: 데이터 없음 (빈 응답)' }

  // Sort by 연도·월 ascending, then take the last (latest) row(s).
  const sorted = [...data].sort((a, b) => {
    const ya = kogasNum(a, '연도')
    const yb = kogasNum(b, '연도')
    if (ya !== yb) return ya - yb
    return kogasNum(a, '월') - kogasNum(b, '월')
  })
  const latest = sorted[sorted.length - 1]!
  const prev = sorted.length >= 2 ? sorted[sorted.length - 2] : null

  const blocks: string[] = [renderKogasMonth(latest)]

  // Short trend: latest total vs previous month total.
  if (prev) {
    const totalOf = (row: Record<string, unknown>) =>
      KOGAS_CONTINENTS.reduce((s, c) => s + kogasNum(row, kogasWeightKey(row, c)), 0)
    const cur = totalOf(latest)
    const before = totalOf(prev)
    if (before > 0) {
      const pct = (((cur - before) / before) * 100).toFixed(1)
      const sign = cur >= before ? '+' : ''
      blocks.push(
        `[전월 대비] ${kogasNum(prev, '연도')}년 ${kogasNum(prev, '월')}월 ${Math.round(before).toLocaleString()}톤 → ${kogasNum(latest, '연도')}년 ${kogasNum(latest, '월')}월 ${Math.round(cur).toLocaleString()}톤 (${sign}${pct}%)`
      )
    }
  }

  const header = `대륙별 천연가스(LNG) 수입 현황 (출처: 한국가스공사/data.go.kr 15088508, 한국무역협회 기반)`
  return { text: [header, ...blocks].join('\n\n') }
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
    id: 'kamis-gunpo-products',
    label: 'KAMIS Gunpo Agricultural & Marine Prices (TODO: 품목 미확정)',
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
    id: 'kma-gunpo-weather',
    label: `KMA Gunpo Short-term Weather (초단기실황, nx=${GUNPO_KMA_NX}/ny=${GUNPO_KMA_NY})`,
    format: 'json',
    modes: ['governance', 'resident', 'tourist'],
    buildUrl: () => {
      const key = process.env.DATA_GO_KR_KEY ?? process.env.KPX_SERVICE_KEY ?? ''
      const { baseDate, baseTime } = kmaBaseDateTime()
      const params = new URLSearchParams({
        serviceKey: key,
        dataType: 'JSON',
        base_date: baseDate,
        base_time: baseTime,
        nx: GUNPO_KMA_NX,
        ny: GUNPO_KMA_NY,
        numOfRows: '100',
        pageNo: '1',
      })
      return `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst?${params.toString()}`
    },
    render: renderKmaWeather,
  },

  {
    id: 'kma-gunpo-midterm',
    label: `KMA Gunpo 11-day Outlook (중기예보, 기온 regId ${JEJU_MIDTA_REGID} / 육상 regId ${JEJU_MIDLAND_REGID})`,
    format: 'json',
    modes: ['governance', 'resident'],
    // Nominal "primary" endpoint (used for listing/debugging only). The real
    // work happens in `fetchCustom`, which calls BOTH getMidTa + getMidLandFcst.
    buildUrl: () => buildMidTaUrl(kmaMidTmFc()),
    fetchCustom: fetchKmaMidterm,
  },

  {
    id: 'kma-gunpo-warning',
    label: `KMA Gunpo Weather Warnings (기상특보, stnId=${GUNPO_KMA_WARN_STNID})`,
    format: 'json',
    modes: ['governance', 'resident', 'tourist'],
    buildUrl: () => {
      const key = process.env.DATA_GO_KR_KEY ?? process.env.KPX_SERVICE_KEY ?? ''
      const params = new URLSearchParams({
        ServiceKey: key,
        pageNo: '1',
        numOfRows: '20',
        dataType: 'JSON',
        stnId: GUNPO_KMA_WARN_STNID,
      })
      return `https://apis.data.go.kr/1360000/WthrWrnInfoService/getWthrWrnList?${params.toString()}`
    },
    render: renderJejuWarning,
  },

  {
    id: 'keco-gunpo-evcharger',
    label: 'KECO Gunpo EV Charger Infrastructure (전기차 충전 인프라, rgnNm=경기도)',
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
        rgnNm: '경기도',
      })
      return `https://apis.data.go.kr/B552584/pbnstFstChrgrChgcpcyInfo/getYrMnChgcpcyInfo?${params.toString()}`
    },
    fetchCustom: fetchKecoEvCharger,
  },

  {
    id: 'molit-gunpo-apt-trade',
    label: `MOLIT Gunpo Apartment Trade Prices (아파트 매매 실거래가, LAWD_CD=${GUNPO_APT_LAWD_CD})`,
    format: 'json',
    modes: ['governance', 'resident'],
    // Nominal primary URL (current-month DEAL_YMD, for listing/debugging only).
    // The actual fetch uses fetchCustom (tries current month, falls back to the
    // previous month when the current month has no reported trades yet).
    buildUrl: () => buildAptTradeUrl(GUNPO_APT_LAWD_CD, kstYearMonth()),
    fetchCustom: fetchAptTrade,
  },

  // ── Registry slots for upcoming sources (NOT yet implemented) ─────────────
  // Add each as a JejuSource entry following the patterns above. Read the
  // service key from process.env; pick the correct `format`; set `modes`.
  //
  // TODO(군포): 삭제된 원본 소스 중 아래는 "지역 파라미터가 없는 전국 집계"라서
  // 이번 단계에서 보류했다(빈 세트로 두는 대신 다음 단계에서 논의 필요):
  //   - 오피넷 전국 평균 유가, KPX 육지 SMP, KPX 발전원별 발전량, 가스공사 LNG 수입
  //   원했던 것과 다르면 알려줄 것 — 되살리는 것 자체는 어렵지 않다.
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
const KPX_SOURCE_IDS: ReadonlySet<string> = new Set([
  'kpx-jeju-power',
  'kpx-jeju-smp',
  'kpx-mainland-smp',
  'kpx-gen-mix',
])
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
