import 'server-only'

/**
 * SHARED Jeju marine data layer — generic infrastructure for 도민 일반 mode.
 * Consumed by the Haenyeo (해녀) safety chip and the 농수산 fishing-decision
 * widget via GET /api/domin/marine. NOT tourist-specific.
 *
 * Upstream (data.go.kr):
 *   1. 기상청 해수욕장 날씨 (BeachInfoservice) —
 *        getTideInfoBeach / getSunInfoBeach / getVilageFcstBeach (WAV → wave)
 *   2. 기상청 기상특보 (WthrWrnInfoService/getWthrWrnList) — Jeju sea warnings
 *
 * Auth: JEJU_DATAGO_KEY (preferred) → DATA_GO_KR_KEY → KPX_SERVICE_KEY.
 * Never throws; each section degrades to null with an errors[] entry.
 *
 * NOTE: BeachInfoservice requires a dedicated 활용신청. Without it the portal
 * returns HTTP 403 Forbidden — those sections become null + errors[], while
 * warnings (already approved on the shared key) still populate.
 */

const BEACH_BASE = 'https://apis.data.go.kr/1360000/BeachInfoservice'
const WARN_URL = 'https://apis.data.go.kr/1360000/WthrWrnInfoService/getWthrWrnList'
const TIMEOUT_MS = 10_000
/** Max chars of upstream response body surfaced in errors[] on failure. */
const BODY_SNIPPET = 300
/** Default: 이호테우 — central Jeju coastal point (beachNum 348). */
export const DEFAULT_BEACH_NUM = '348'

// ── Spot aliases (name → beachNum) ────────────────────────────────────────────

const SPOT_ALIASES: Record<string, string> = {
  '이호': '348',
  '이호테우': '348',
  iho: '348',
  '함덕': '352',
  hamdeok: '352',
  '협재': '346',
  hyeopjae: '346',
  '김녕': '345',
  gimnyeong: '345',
  '표선': '342',
  pyoseon: '342',
  '중문': '337',
  '중문색달': '337',
  jungmun: '337',
  '삼양': '349',
  samyang: '349',
  '월정': '344',
  woljeong: '344',
  '금능': '347',
  geumneung: '347',
  '곽지': '350',
  gwakji: '350',
  '화순': '338',
  '화순금모래': '338',
  '신양': '341',
  '신양섭지': '341',
}

export function resolveBeachNum(spot: string | null | undefined): string {
  const raw = (spot ?? '').trim()
  if (!raw) return DEFAULT_BEACH_NUM
  if (/^\d{1,4}$/.test(raw)) return raw
  const alias = SPOT_ALIASES[raw.toLowerCase()] ?? SPOT_ALIASES[raw]
  return alias ?? DEFAULT_BEACH_NUM
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TideEvent {
  time: string
  level: number | null
}

export interface TideInfo {
  lowTides: TideEvent[]
  highTides: TideEvent[]
}

export interface WaveInfo {
  heightM: number | null
}

export interface SunInfo {
  sunrise: string | null
  sunset: string | null
}

export interface MarineWarning {
  type: string
  level: string
  area: string
  issuedAt: string
}

export interface MarinePayload {
  ok: true
  spot: string
  beachNum: string
  tide: TideInfo | null
  wave: WaveInfo | null
  waterTempC: number | null
  sun: SunInfo | null
  warnings: MarineWarning[]
  updatedAt: string
  errors: string[]
}

export type MarineResult = MarinePayload | { ok: false; error: string }

// ── Key + fetch helpers ───────────────────────────────────────────────────────

function serviceKey(): string {
  return (
    process.env.JEJU_DATAGO_KEY ??
    process.env.DATA_GO_KR_KEY ??
    process.env.KPX_SERVICE_KEY ??
    ''
  )
}

function asArray<T>(item: unknown): T[] {
  if (Array.isArray(item)) return item as T[]
  if (item === undefined || item === null || item === '') return []
  return [item as T]
}

function parseNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim())
    return Number.isFinite(n) ? n : null
  }
  return null
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim()
}

/** First ~300 chars of upstream body, collapsed for errors[] readability. */
function bodySnippet(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, BODY_SNIPPET)
}

/** Standard data.go.kr envelope → items[]. Throws a descriptive Error on failure. */
function readEnvelope(raw: unknown): Record<string, unknown>[] {
  if (!raw || typeof raw !== 'object') throw new Error('Unexpected response shape')
  const response = (raw as Record<string, unknown>).response
  if (!response || typeof response !== 'object') throw new Error('Missing response envelope')
  const resp = response as Record<string, unknown>
  const header =
    resp.header && typeof resp.header === 'object' ? (resp.header as Record<string, unknown>) : null
  const code = header ? String(header.resultCode ?? '') : ''
  const msg = header && typeof header.resultMsg === 'string' ? header.resultMsg : ''
  // '00' = success, '03' = NODATA (benign empty)
  if (code && code !== '00' && code !== '03') {
    throw new Error(`resultCode ${code}${msg ? `: ${msg}` : ''}`)
  }
  const body =
    resp.body && typeof resp.body === 'object' ? (resp.body as Record<string, unknown>) : null
  const itemsContainer =
    body && body.items && typeof body.items === 'object'
      ? (body.items as Record<string, unknown>)
      : null
  return asArray<Record<string, unknown>>(itemsContainer ? itemsContainer.item : null)
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; Jeju-Marine/1.0)',
      },
      cache: 'no-store',
    })
    const text = await res.text()
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} — ${bodySnippet(text)}`)
    }
    // data.go.kr sometimes returns XML error bodies even with dataType=JSON
    const trimmed = text.trim()
    if (trimmed.startsWith('<') || trimmed.startsWith('<?xml')) {
      throw new Error(`XML/error body — ${bodySnippet(trimmed)}`)
    }
    try {
      return JSON.parse(trimmed) as unknown
    } catch {
      throw new Error(`Non-JSON body — ${bodySnippet(trimmed)}`)
    }
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(`Timeout after ${TIMEOUT_MS}ms`)
    }
    throw e instanceof Error ? e : new Error(String(e))
  } finally {
    clearTimeout(timer)
  }
}

/** KST YYYYMMDD + village-forecast base_time (02/05/08/11/14/17/20/23). */
function kstBase(): { ymd: string; hm: string } {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const ymd = `${kst.getUTCFullYear()}${pad(kst.getUTCMonth() + 1)}${pad(kst.getUTCDate())}`
  const h = kst.getUTCHours()
  const slots = [2, 5, 8, 11, 14, 17, 20, 23]
  const slot = [...slots].reverse().find((x) => x <= h) ?? 23
  return { ymd, hm: `${pad(slot)}00` }
}

function beachUrl(
  op: string,
  beachNum: string,
  key: string,
  extra: Record<string, string> = {},
): string {
  const params = new URLSearchParams({
    serviceKey: key,
    beachNum,
    beach_num: beachNum, // some ops accept snake_case
    pageNo: '1',
    numOfRows: '40',
    dataType: 'JSON',
    ...extra,
  })
  return `${BEACH_BASE}/${op}?${params.toString()}`
}

// ── Parsers ───────────────────────────────────────────────────────────────────

/**
 * Tide items typically carry tiType / tideType (1|밀물|고조 = high, 0|썰물|저조 = low),
 * tiTime / tideTime, and tiLevel / tideLevel (cm). Field names vary across seasons.
 */
function parseTide(items: Record<string, unknown>[]): TideInfo {
  const lowTides: TideEvent[] = []
  const highTides: TideEvent[] = []
  for (const it of items) {
    const typeRaw = str(it.tiType || it.tideType || it.titype || it.type).toLowerCase()
    const time = str(it.tiTime || it.tideTime || it.titime || it.time || it.tm)
    if (!time) continue
    const level = parseNum(it.tiLevel ?? it.tideLevel ?? it.tilevel ?? it.level ?? it.tilevel)
    const isHigh =
      typeRaw === '1' ||
      typeRaw === '밀물' ||
      typeRaw === '고조' ||
      typeRaw.includes('high') ||
      typeRaw.includes('만조')
    const isLow =
      typeRaw === '0' ||
      typeRaw === '2' ||
      typeRaw === '썰물' ||
      typeRaw === '저조' ||
      typeRaw.includes('low') ||
      typeRaw.includes('간조')
    const event: TideEvent = { time, level }
    if (isHigh) highTides.push(event)
    else if (isLow) lowTides.push(event)
    else {
      // Unknown type — still keep as high if level looks like a peak, else low bucket skip
      // Prefer attaching to highTides when ambiguous so UI still shows something.
      highTides.push(event)
    }
  }
  return { lowTides, highTides }
}

function parseWave(items: Record<string, unknown>[]): WaveInfo {
  // Dedicated wave items, OR village-forecast rows with category=WAV.
  for (const it of items) {
    const cat = str(it.category || it.Category).toUpperCase()
    if (cat && cat !== 'WAV' && cat !== 'WVH' && cat !== 'WH') continue
    const h = parseNum(
      it.wh ?? it.waveHeight ?? it.wav ?? it.WAV ?? it.beachWh ?? it.whValue ?? it.fcstValue,
    )
    if (h != null) return { heightM: h }
  }
  // Fallback: any numeric wh-like field even without category
  for (const it of items) {
    const h = parseNum(it.wh ?? it.waveHeight ?? it.wav ?? it.beachWh)
    if (h != null) return { heightM: h }
  }
  return { heightM: null }
}

function parseWaterTemp(items: Record<string, unknown>[]): number | null {
  for (const it of items) {
    const cat = str(it.category || it.Category).toUpperCase()
    if (cat && cat !== 'TW' && cat !== 'WTM' && cat !== 'SST') continue
    const t = parseNum(
      it.tw ?? it.waterTemp ?? it.temp ?? it.twValue ?? it.beachTw ?? it.fcstValue,
    )
    if (t != null) return t
  }
  for (const it of items) {
    const t = parseNum(it.tw ?? it.waterTemp ?? it.beachTw)
    if (t != null) return t
  }
  return null
}

function parseSun(items: Record<string, unknown>[]): SunInfo {
  const first = items[0] ?? {}
  return {
    sunrise: str(first.sunrise || first.sunRise || first.sunriseTime || first.sr) || null,
    sunset: str(first.sunset || first.sunSet || first.sunsetTime || first.ss) || null,
  }
}

/**
 * Parse a KMA warning title like:
 *   "[특보] 제07-25호 : 2026.07.09.13:10 / 풍랑주의보 발표 (*)"
 * into { type, level }. Falls back to the raw title when unparseable.
 */
function parseWarningTitle(title: string): { type: string; level: string } {
  const cleaned = title.replace(/^\[특보\]\s*/, '').trim()
  // Prefer the segment after the last " / "
  const afterSlash = cleaned.includes('/') ? cleaned.split('/').pop()!.trim() : cleaned
  const core = afterSlash.replace(/\s*발표.*$/, '').replace(/\(\*\)/g, '').trim()

  let level = ''
  if (core.includes('경보')) level = '경보'
  else if (core.includes('주의보')) level = '주의보'

  let type = core
  if (level) type = core.replace(level, '').trim()
  // Common sea-relevant types we care about for haenyeo / fishing
  const known = ['풍랑', '강풍', '태풍', '폭풍해일', '풍랑주의', '호우', '대설', '한파', '폭염', '건조', '황사', '열대야']
  for (const k of known) {
    if (core.includes(k)) {
      type = k.replace(/주의$/, '')
      break
    }
  }
  if (!type) type = core || '기상특보'
  if (!level) level = '주의보'
  return { type, level }
}

function formatIssuedAt(tmFc: unknown): string {
  const n = parseNum(tmFc)
  if (n == null) return str(tmFc) || ''
  const s = String(Math.trunc(n))
  // YYYYMMDDHHmm → ISO-ish local string
  if (s.length >= 12) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:00+09:00`
  }
  return s
}

function parseWarnings(items: Record<string, unknown>[]): MarineWarning[] {
  const out: MarineWarning[] = []
  for (const it of items) {
    const title = str(it.title)
    if (!title) continue
    // Include all Jeju warnings (sea + land: 호우/폭염/한파/건조 etc.) so both
    // the marine chip and the weather-alert route can share this parser.
    const { type, level } = parseWarningTitle(title)
    out.push({
      type,
      level,
      area: '제주',
      issuedAt: formatIssuedAt(it.tmFc),
    })
  }
  console.log(`[marine] warnings raw: ${out.length} parsed from ${items.length} API rows`)
  // Newest first — ensures the first occurrence per key is the most recent issuedAt.
  out.sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : a.issuedAt > b.issuedAt ? -1 : 0))
  // Dedupe by (type + level + area): KMA re-announces the same warning multiple times
  // with different tmFc/tmSeq values. Keying on issuedAt would keep every re-announcement
  // as a separate entry, causing "풍랑주의보, 풍랑주의보, 풍랑주의보" duplicates.
  // We keep the FIRST (= most recent) occurrence per logical warning identity.
  const seen = new Set<string>()
  const deduped = out.filter((w) => {
    const k = `${w.type}|${w.level}|${w.area}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  console.log(`[marine] warnings deduped: ${deduped.length} distinct (type+level+area)`)
  return deduped
}

/**
 * Shared Jeju weather-warning fetch (WthrWrnInfoService/getWthrWrnList, stnId=184).
 * Used by getMarineData and by lib/jeju/weather-alert.ts — do not duplicate.
 * Throws on upstream failure (callers wrap with Promise.allSettled / try-catch).
 */
export async function fetchJejuWeatherWarnings(keyOverride?: string): Promise<MarineWarning[]> {
  const key = keyOverride || serviceKey()
  if (!key) throw new Error('JEJU_DATAGO_KEY (or DATA_GO_KR_KEY / KPX_SERVICE_KEY) is not set')
  const params = new URLSearchParams({
    serviceKey: key,
    pageNo: '1',
    numOfRows: '100',
    dataType: 'JSON',
    stnId: '184', // 제주
  })
  const url = `${WARN_URL}?${params.toString()}`
  console.log('[marine] warnings →', url.replace(/serviceKey=[^&]+/, 'serviceKey=***'))
  const raw = await fetchJson(url)
  return parseWarnings(readEnvelope(raw))
}

// ── Public entry ──────────────────────────────────────────────────────────────

/**
 * Fetch marine conditions for a Jeju beach spot. Never throws.
 * Beach weather (4 BeachInfoservice ops) and warnings run in parallel via
 * Promise.allSettled; individual section failures become null + errors[].
 */
export async function getMarineData(spot?: string | null): Promise<MarineResult> {
  const key = serviceKey()
  if (!key) {
    return {
      ok: false,
      error: 'JEJU_DATAGO_KEY (or DATA_GO_KR_KEY / KPX_SERVICE_KEY) is not set',
    }
  }

  const beachNum = resolveBeachNum(spot)
  const errors: string[] = []

  type BeachBundle = {
    tide: TideInfo | null
    wave: WaveInfo | null
    waterTempC: number | null
    sun: SunInfo | null
    beachErrors: string[]
  }

  async function fetchBeachBundle(): Promise<BeachBundle> {
    const beachErrors: string[] = []
    const { ymd, hm } = kstBase()

    // Confirmed BeachInfoservice op names (403 without approval = path exists):
    //   getTideInfoBeach, getSunInfoBeach, getUltraSrtFcstBeach, getVilageFcstBeach
    // Wave height often lives in village-forecast category=WAV; dedicated 파고/수온
    // ops were not discoverable via 403 probing, so we also parse the forecast.
    const jobs: Array<{
      label: 'tide' | 'sun' | 'forecast'
      op: string
      extra?: Record<string, string>
    }> = [
      { label: 'tide', op: 'getTideInfoBeach' },
      { label: 'sun', op: 'getSunInfoBeach' },
      {
        label: 'forecast',
        op: 'getVilageFcstBeach',
        extra: { base_date: ymd, base_time: hm },
      },
    ]

    const settled = await Promise.allSettled(
      jobs.map(async ({ label, op, extra }) => {
        const url = beachUrl(op, beachNum, key, extra)
        console.log(
          `[marine] ${label} →`,
          url.replace(/serviceKey=[^&]+/, 'serviceKey=***'),
        )
        const raw = await fetchJson(url)
        const items = readEnvelope(raw)
        return { label, items }
      }),
    )

    let tide: TideInfo | null = null
    let wave: WaveInfo | null = null
    let waterTempC: number | null = null
    let sun: SunInfo | null = null

    settled.forEach((r, i) => {
      const label = jobs[i].label
      if (r.status === 'rejected') {
        beachErrors.push(
          `${label}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
        )
        return
      }
      const { items } = r.value
      try {
        if (label === 'tide') tide = parseTide(items)
        else if (label === 'sun') sun = parseSun(items)
        else if (label === 'forecast') {
          wave = parseWave(items)
          // Water temp is rarely in village forecast; keep null if absent.
          waterTempC = parseWaterTemp(items)
        }
      } catch (e: unknown) {
        beachErrors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`)
      }
    })

    return { tide, wave, waterTempC, sun, beachErrors }
  }

  const [beachSettled, warnSettled] = await Promise.allSettled([
    fetchBeachBundle(),
    fetchJejuWeatherWarnings(key),
  ])

  let tide: TideInfo | null = null
  let wave: WaveInfo | null = null
  let waterTempC: number | null = null
  let sun: SunInfo | null = null
  let warnings: MarineWarning[] = []

  if (beachSettled.status === 'fulfilled') {
    tide = beachSettled.value.tide
    wave = beachSettled.value.wave
    waterTempC = beachSettled.value.waterTempC
    sun = beachSettled.value.sun
    errors.push(...beachSettled.value.beachErrors)
  } else {
    errors.push(
      `beach: ${beachSettled.reason instanceof Error ? beachSettled.reason.message : String(beachSettled.reason)}`,
    )
  }

  if (warnSettled.status === 'fulfilled') {
    warnings = warnSettled.value
  } else {
    errors.push(
      `warnings: ${warnSettled.reason instanceof Error ? warnSettled.reason.message : String(warnSettled.reason)}`,
    )
  }

  return {
    ok: true,
    spot: spot?.trim() || '이호테우',
    beachNum,
    tide,
    wave,
    waterTempC,
    sun,
    warnings,
    updatedAt: new Date().toISOString(),
    errors,
  }
}
