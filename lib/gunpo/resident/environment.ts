import 'server-only'

/**
 * SHARED Gunpo environment layer — 시민(resident) mode 환경 chip. Cloned from
 * the AirKorea half of lib/jeju/environment.ts ONLY — 클린하우스/배출요일제/
 * 분리배출 Q&A (Perplexity ask) were intentionally NOT ported (out of scope
 * for Gunpo per STEP3 instructions).
 *
 * TWO parts:
 *   1. 미세먼지 — 한국환경공단_에어코리아 측정소별 실시간 측정정보
 *        (getMsrstnAcctoRltmMesureDnsty, stationName=GUNPO_AIR_STATION_NAME='당동'
 *        — CONFIRMED STEP5, station-level lookup, NOT the sido-wide
 *        getCtprvnRltmMesureDnsty used before). If the 당동 reading is
 *        missing/dead (결측 또는 통신장애), retried ONCE against
 *        GUNPO_AIR_FALLBACK_STATION='산본동'.
 *   2. 전기차 충전 인프라 — REUSES the already-registered gunpo governance
 *        connector `keco-gunpo-evcharger` (lib/gunpo/connectors.ts, rgnNm
 *        CONFIRMED = '경기도' per STEP4) via fetchJejuSource, so that value
 *        lives in exactly one place.
 *
 * Auth: DATA_GO_KR_KEY → KPX_SERVICE_KEY (same common key as other gunpo
 * connectors — no new env var).
 * ISOLATION: 'server-only'; MUST NOT import lib/jeju or lib/motie. Never
 * throws; sections degrade to null + errors[].
 */

import { fetchJejuSource } from '@/lib/gunpo/connectors'
import { dataGoKrKey } from './shared'

// NOTE: was 'ArpltnInqireSvc' (missing "Info") in some older integrations —
// keep the correct "Infor" spelling used by the current AirKorea endpoint.
const AIRKOREA_BASE = 'https://apis.data.go.kr/B552584/ArpltnInforInqireSvc'
/** 측정소별 실시간 측정정보 (station-level, NOT the sido-wide getCtprvnRltmMesureDnsty). */
const AIRKOREA_STATION_OP = `${AIRKOREA_BASE}/getMsrstnAcctoRltmMesureDnsty`
const TIMEOUT_MS = 15_000
const RETRY_DELAY_MS = 500
const BODY_SNIPPET = 300
const FRESHNESS_NOTE = '에어코리아 실시간 대기오염 (군포시 당동 측정소, 결측 시 산본동 대체) + KECO 전기차 충전 인프라'

/** CONFIRMED (STEP5): 대표 측정소 — 당동. */
export const GUNPO_AIR_STATION_NAME = '당동'
/** CONFIRMED (STEP5): 당동 결측/통신장애 시 1회 대체 조회할 측정소. */
export const GUNPO_AIR_FALLBACK_STATION = '산본동'

const GRADE_LABEL: Record<string, string> = {
  '1': '좋음',
  '2': '보통',
  '3': '나쁨',
  '4': '매우나쁨',
}

export interface DustInfo {
  khai: number | null
  khaiGrade: string | null
  pm10: number | null
  pm10Grade: string | null
  pm25: number | null
  pm25Grade: string | null
  o3: number | null
  o3Grade: string | null
  station: string | null
  stationLabel: string | null
  measuredAt: string | null
  asOf: string | null
}

export interface EvChargerInfo {
  ok: boolean
  text: string | null
  error: string | null
}

export interface EnvironmentPayload {
  ok: true
  dust: DustInfo | null
  evCharger: EvChargerInfo
  freshnessNote: string
  updatedAt: string
  errors: string[]
}

export type EnvironmentResult = EnvironmentPayload | { ok: false; error: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

function redact(url: string): string {
  return url.replace(/serviceKey=[^&]+/i, 'serviceKey=***')
}

function bodySnippet(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, BODY_SNIPPET)
}

function parseNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '' && v.trim() !== '-') {
    const n = Number(v.trim())
    return Number.isFinite(n) ? n : null
  }
  return null
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim()
}

interface AirEnvelope {
  response?: {
    header?: { resultCode?: string; resultMsg?: string }
    body?: { items?: unknown }
  }
}

async function fetchJsonAttempt(url: string): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (Gunpo-Env/1.0)' },
      cache: 'no-store',
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${bodySnippet(text)}`)
    const trimmed = text.trim()
    if (trimmed.startsWith('<')) throw new Error(`XML/error body — ${bodySnippet(trimmed)}`)
    try {
      return JSON.parse(trimmed) as unknown
    } catch {
      throw new Error(`Non-JSON body — ${bodySnippet(trimmed)}`)
    }
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'AbortError') throw new Error(`Timeout after ${TIMEOUT_MS}ms`)
    throw e instanceof Error ? e : new Error(String(e))
  } finally {
    clearTimeout(timer)
  }
}

function isRetryableFetchError(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  if (e.name === 'TypeError') return true
  if (/^Timeout after \d+ms$/.test(e.message)) return true
  if (/^HTTP 5\d\d\b/.test(e.message)) return true
  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchJson(url: string): Promise<unknown> {
  try {
    return await fetchJsonAttempt(url)
  } catch (e: unknown) {
    if (!isRetryableFetchError(e)) throw e
    await sleep(RETRY_DELAY_MS)
    return await fetchJsonAttempt(url)
  }
}

/** Same 통신장애(dead station) guard as the Jeju original. */
function isDeadStation(it: Record<string, unknown>): boolean {
  if (str(it.pm10Value) === '-' || str(it.khaiValue) === '-') return true
  const flags = [it.pm10Flag, it.pm25Flag, it.o3Flag, it.no2Flag, it.so2Flag, it.coFlag]
  return flags.some((f) => str(f) === '통신장애')
}

/** Latest reading for a single-station response (getMsrstnAcctoRltmMesureDnsty returns ~24 hourly rows). */
function latestReading(items: Record<string, unknown>[]): Record<string, unknown> | null {
  if (items.length === 0) return null
  const sorted = [...items].sort((a, b) => str(b.dataTime).localeCompare(str(a.dataTime)))
  return sorted[0] ?? null
}

function stationLabel(name: string | null): string | null {
  return name ? `군포시 (${name} 측정소)` : null
}

function asOfLabel(dataTime: string | null): string | null {
  return dataTime ? `${dataTime} 기준` : null
}

function gradeLabel(code: unknown): string | null {
  const c = str(code)
  return c ? (GRADE_LABEL[c] ?? null) : null
}

/** One station-level query (getMsrstnAcctoRltmMesureDnsty). Returns the latest hourly row, or null. */
async function fetchStationLatest(
  stationName: string,
  errors: string[]
): Promise<Record<string, unknown> | null> {
  const key = dataGoKrKey()
  if (!key) {
    errors.push('dust: no service key')
    return null
  }
  const params = new URLSearchParams({
    serviceKey: key,
    returnType: 'json',
    numOfRows: '25',
    pageNo: '1',
    stationName,
    dataTerm: 'DAILY',
    ver: '1.3',
  })
  const url = `${AIRKOREA_STATION_OP}?${params.toString()}`
  console.log(`[gunpo-environment] dust(${stationName}) →`, redact(url))
  try {
    const raw = (await fetchJson(url)) as AirEnvelope
    const header = raw.response?.header
    const code = str(header?.resultCode)
    if (code && code !== '00') {
      errors.push(`dust(${stationName}): resultCode ${code}${header?.resultMsg ? `: ${header.resultMsg}` : ''}`)
      return null
    }
    const itemsRaw = raw.response?.body?.items
    const items = Array.isArray(itemsRaw) ? (itemsRaw as Record<string, unknown>[]) : []
    const latest = latestReading(items)
    if (!latest) {
      errors.push(`dust(${stationName}): no items`)
      return null
    }
    return latest
  } catch (e: unknown) {
    errors.push(`dust(${stationName}): ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

function toDustInfo(st: Record<string, unknown>, stationUsed: string): DustInfo {
  const stationName = str(st.stationName) || stationUsed
  const dataTime = str(st.dataTime) || null
  return {
    khai: parseNum(st.khaiValue),
    khaiGrade: gradeLabel(st.khaiGrade),
    pm10: parseNum(st.pm10Value),
    pm10Grade: gradeLabel(st.pm10Grade1h) ?? gradeLabel(st.pm10Grade),
    pm25: parseNum(st.pm25Value),
    pm25Grade: gradeLabel(st.pm25Grade1h) ?? gradeLabel(st.pm25Grade),
    o3: parseNum(st.o3Value),
    o3Grade: gradeLabel(st.o3Grade),
    station: stationName,
    stationLabel: stationLabel(stationName),
    measuredAt: dataTime,
    asOf: asOfLabel(dataTime),
  }
}

/**
 * Fetches the 당동 station's latest reading. If it is missing or dead
 * (결측 '-' 또는 통신장애 플래그), retries ONCE against GUNPO_AIR_FALLBACK_STATION.
 * Never throws.
 */
async function fetchDust(errors: string[]): Promise<DustInfo | null> {
  if (!GUNPO_AIR_STATION_NAME) {
    errors.push('dust: GUNPO_AIR_STATION_NAME 미설정 (TODO)')
    return null
  }

  const primary = await fetchStationLatest(GUNPO_AIR_STATION_NAME, errors)
  if (primary && !isDeadStation(primary)) {
    return toDustInfo(primary, GUNPO_AIR_STATION_NAME)
  }
  if (primary) {
    errors.push(`dust(${GUNPO_AIR_STATION_NAME}): 결측/통신장애 — ${GUNPO_AIR_FALLBACK_STATION} 대체 조회`)
  }

  if (!GUNPO_AIR_FALLBACK_STATION) return null
  const fallback = await fetchStationLatest(GUNPO_AIR_FALLBACK_STATION, errors)
  if (!fallback) return null
  if (isDeadStation(fallback)) {
    errors.push(`dust(${GUNPO_AIR_FALLBACK_STATION}): 결측/통신장애`)
    return null
  }
  return toDustInfo(fallback, GUNPO_AIR_FALLBACK_STATION)
}

async function fetchEvCharger(errors: string[]): Promise<EvChargerInfo> {
  try {
    const r = await fetchJejuSource('keco-gunpo-evcharger')
    if (!r.ok) {
      errors.push(`evCharger: ${r.error ?? 'unknown error'}`)
      return { ok: false, text: null, error: r.error ?? 'unknown error' }
    }
    return { ok: true, text: r.text, error: null }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    errors.push(`evCharger: ${msg}`)
    return { ok: false, text: null, error: msg }
  }
}

// ── Public entry (GET) ─────────────────────────────────────────────────────────

/**
 * Fetch Gunpo environment snapshot: 미세먼지(경기) + 전기차 충전 인프라(전국
 * 커넥터 재사용). Never throws; sections degrade to null with errors[] entries.
 */
export async function getEnvironment(): Promise<EnvironmentResult> {
  const errors: string[] = []

  const [dustSettled, evSettled] = await Promise.allSettled([fetchDust(errors), fetchEvCharger(errors)])

  const dust = dustSettled.status === 'fulfilled' ? dustSettled.value : null
  if (dustSettled.status === 'rejected') {
    errors.push(`dust(settled): ${String(dustSettled.reason)}`)
  }

  const evCharger: EvChargerInfo =
    evSettled.status === 'fulfilled' ? evSettled.value : { ok: false, text: null, error: 'settled-rejected' }

  return {
    ok: true,
    dust,
    evCharger,
    freshnessNote: FRESHNESS_NOTE,
    updatedAt: new Date().toISOString(),
    errors,
  }
}
