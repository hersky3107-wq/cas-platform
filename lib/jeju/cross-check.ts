import 'server-only'

import type { JejuSnapshot, JejuSnapshotSource } from '@/lib/jeju/brief'

/**
 * JEJU governance DATA CROSS-VALIDATION layer.
 *
 * STRICTLY ADDITIVE: this module runs BEFORE the orchestrator (on the same
 * JejuSnapshot the orchestrator already reads) and produces a Korean prompt
 * block + a code-rendered verdict section. It NEVER touches the DEEP 4-beat
 * engine internals (orchestrator → analysis → search → debate → chair) —
 * those files import ONLY the pure render helpers below.
 *
 * SCOPE:
 *   - Five contradiction rules (R1–R5) run over the ALREADY-COLLECTED
 *     JejuSnapshot text. No new external API, no new connector.
 *   - 'disputed' findings get ONE optional re-investigation pass via the
 *     EXISTING Perplexity search helper (lib/jeju/deep.ts#executeJejuSearches),
 *     hard-capped at MAX_RECHECK_CALLS calls. deep.ts is imported lazily
 *     (dynamic import) inside runJejuCrossCheck to avoid a static import
 *     cycle (deep.ts imports the pure render helpers from this file).
 *   - COST NOTE: this cap is independent of deep.ts's own MAX_SEARCHES (5)
 *     budget for the pre-report stage — the two are not summed anywhere, so
 *     a single deliberation session's worst-case Perplexity call count is
 *     MAX_RECHECK_CALLS + the pre-report's own cap, not a shared pool.
 *
 * NOT DONE HERE (by design — preserves existing boundaries):
 *   - Vote prompts, consensus scoring, facilitator input — untouched.
 *   - lib/ai/router.ts, fishing-floor.ts, haenyeo-marine.ts — untouched.
 *   - R2 (KMA warning vs marine severity) is implemented as a WIND proxy
 *     only: the governance snapshot has no wave/wind connector (KHOA here is
 *     water-temperature only; wave/tide data lives in haenyeo-marine.ts next
 *     to the fishing pipeline, which is out of scope). parseWaveReadings()
 *     is a dormant hook that returns null until a wave source exists — it
 *     never fabricates a wave finding.
 *   - KAMIS price staleness (R1) depends on a `regday` field inside the
 *     source's raw JSON text; if that field is absent the price source is
 *     simply not staleness-checked (not forced into a noisy 'unresolved') —
 *     documented gap, not a silent drop of a rule that DID run.
 */

// ── Public types (exact shape requested) ────────────────────────────────────

export type TrustStatus = 'ok' | 'disputed' | 'unresolved'

export type DataFinding = {
  /** e.g. 'KMA 해상특보 vs KHOA 파고' */
  item: string
  /** Connector ids (JejuSnapshotSource.id) this finding is about. */
  sources: string[]
  /** What disagrees, in Korean, one sentence. */
  conflict: string
  /** Perplexity result summary, Korean (only set after a recheck attempt). */
  recheck?: string
  status: TrustStatus
  /** Which agency + what to confirm, Korean. */
  verifyWith?: string
}

export type DataTrustBlock = {
  findings: DataFinding[]
  hasIssues: boolean
  /**
   * Field-level notes (R3 scope fix): when a source's PRIMARY payload parsed
   * (SMP hourly table present, KAMIS price rows present) but a single
   * secondary field (기준일, regday) did not, the source stays 'ok' and is
   * NOT excluded from the conclusion. The missing field is recorded here as
   * a footnote rendered under the ledger table — never as a source-level
   * 'unresolved' finding that would flip 결론 반영 to '미반영'.
   */
  fieldNotes?: DataFieldNote[]
}

/** Runner return value — same as DataTrustBlock plus a transparency counter. */
export type DataTrustResult = DataTrustBlock & {
  /** How many Perplexity recheck calls this run actually spent (≤ MAX_RECHECK_CALLS). */
  recheckCallsUsed: number
}

/** A field-level note about a single secondary field that did not parse. */
export type DataFieldNote = {
  /** Connector id (JejuSnapshotSource.id) the note is about. */
  sourceId: string
  /** Human-readable field name in Korean, e.g. '기준일', '가격 등록일'. */
  field: string
  /** One-sentence Korean note about what is missing and its (non-fatal) impact. */
  note: string
}

// ── Thresholds — single source of truth, one comment per value ─────────────

export const CROSS_CHECK_CONST = {
  /** KMA 초단기실황 publishes hourly; 6 missed cycles = no longer "current". */
  STALE_WEATHER_HOURS: 6,
  /** KHOA 조위관측소 posts ~hourly; same window as weather. */
  STALE_MARINE_HOURS: 6,
  /** KPX SMP/수요예측 is published as a day-ahead daily table. */
  STALE_POWER_HOURS: 24,
  /** KAMIS quotes are weekday-published; 7 days spans a full trading week. */
  STALE_PRICE_DAYS: 7,
  /** R5: two connectors >3 days apart no longer describe the same situation. */
  SKEW_MAX_DAYS: 3,
  /** KMA 강풍주의보 육상 기준(m/s) — used as the R2 severity line. */
  SEVERE_WIND_MS: 14,
  /** KMA 풍랑주의보 유의파고 기준(m) — reserved for when a wave source exists. */
  SEVERE_WAVE_M: 3,
  /** R4: ignore intraday demand/price wobble under this % — coarse sanity band. */
  COUPLING_MIN_PCT: 10,
  /** Hard cap on Perplexity calls spent by cross-check re-investigation. */
  MAX_RECHECK_CALLS: 2,
} as const

const CROSS_CHECK_DIRECTIVE =
  '아래 항목은 출처 간 불일치가 확인되었다. 결론의 근거로 사용하지 말 것. 무엇이 어긋났는지, 확정하려면 어느 기관에 무엇을 확인해야 하는지를 명시하라.'

// ── KST time helpers (self-contained — no import from deep.ts) ─────────────
//
// Two reference frames are kept deliberately distinct:
//   - nowUtc(): real current epoch (UTC). Use this for ANY age comparison
//     against a Date returned by kstToUtcDate() — those Dates are real UTC
//     epochs and must be compared against another real UTC epoch.
//   - nowKst(): Date whose UTC getters yield KST components (epoch is shifted
//     +9h). Use this ONLY when you need "today's KST year/month/day" via
//     getUTCFullYear/Month/Date — never for raw .getTime() comparisons.
// Mixing the two was the root cause of the R1 false positive: staleness
// compared a +9h-shifted nowKst() against a real-UTC kstToUtcDate(), giving
// a permanent 9h skew that flipped same-evening observations into "stale".

function nowUtc(): Date {
  return new Date()
}

function nowKst(): Date {
  return new Date(Date.now() + 9 * 60 * 60 * 1000)
}

/** Builds a UTC-epoch Date from KST y/m/d/h/min components (no DST in Korea). */
function kstToUtcDate(year: number, month1to12: number, day: number, hour: number, minute: number): Date {
  return new Date(Date.UTC(year, month1to12 - 1, day, hour, minute) - 9 * 60 * 60 * 1000)
}

function hoursBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / (60 * 60 * 1000)
}

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000)
}

/** Renders unambiguously as MM-DD HH:MM (KST). Avoids locale-dependent output. */
function formatKstStamp(date: Date): string {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())} ${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}`
}

/**
 * Parse-failure guard. A correctly parsed observation timestamp must lie in
 * the recent past — not in the future and not unreasonably far back. Returns
 * true when `at` is a plausible observation time, false when it is a parse
 * artifact (e.g. wrong field order, garbage digits, system clock skew).
 */
const PLAUSIBLE_MAX_AGE_DAYS = 400
function isPlausibleObservation(at: Date, now: Date = nowUtc()): boolean {
  const future = at.getTime() - now.getTime()
  if (future > 60 * 1000) return false // >1min in the future = parse artifact
  const ageDays = Math.abs(now.getTime() - at.getTime()) / (24 * 60 * 60 * 1000)
  if (ageDays > PLAUSIBLE_MAX_AGE_DAYS) return false
  return true
}

// ── Source lookup ────────────────────────────────────────────────────────────

function findSource(snapshot: JejuSnapshot, id: string): JejuSnapshotSource | null {
  return snapshot.sources.find((s) => s.id === id) ?? null
}

// ── Per-source parsers (operate on the ALREADY-RENDERED Korean text) ───────

type AsOf = { at: Date; label: string }

/** kma-jeju-weather: "제주시 초단기실황 (관측: YYYYMMDD HHMM)" */
function parseWeatherObservedAt(text: string): AsOf | null {
  const m = text.match(/\(관측:\s*(\d{8})\s*(\d{4})\)/)
  if (!m) return null
  const [, ymd, hm] = m
  const year = Number(ymd.slice(0, 4))
  const month = Number(ymd.slice(4, 6))
  const day = Number(ymd.slice(6, 8))
  const hour = Number(hm.slice(0, 2))
  const minute = Number(hm.slice(2, 4))
  if ([year, month, day, hour, minute].some((n) => Number.isNaN(n))) return null
  const at = kstToUtcDate(year, month, day, hour, minute)
  // Treat implausible timestamps (future, >400d old) as parse failures, not
  // as stale observations — they indicate a parse artifact, not a stale feed.
  if (!isPlausibleObservation(at)) return null
  return { at, label: formatKstStamp(at) }
}

/** kma-jeju-weather: "풍속: X.Xm/s" inside the comma-joined readings line. */
function parseWeatherWindMs(text: string): number | null {
  const m = text.match(/풍속:\s*([\d.]+)m\/s/)
  if (!m) return null
  const v = Number(m[1])
  return Number.isFinite(v) ? v : null
}

type WarningState = { active: boolean; titles: string[]; latestAt: AsOf | null }

/** kma-jeju-warning: either "...없음" or a "- (YYYYMMDDHHMM) 제목" list. */
function parseWarningState(text: string): WarningState {
  if (text.includes('발효 중인 기상특보 없음')) return { active: false, titles: [], latestAt: null }

  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '))
  const titles: string[] = []
  let latestMs = -1
  let latestYmdHm = ''
  for (const line of lines) {
    const m = line.match(/^-\s*\((\d{12})\)\s*(.+)$/)
    if (m) {
      titles.push(m[2].trim())
      if (m[1] > latestYmdHm) {
        latestYmdHm = m[1]
        latestMs = 1
      }
    } else {
      const bare = line.replace(/^-\s*/, '').trim()
      if (bare) titles.push(bare)
    }
  }
  let latestAt: AsOf | null = null
  if (latestMs > 0 && latestYmdHm.length === 12) {
    const year = Number(latestYmdHm.slice(0, 4))
    const month = Number(latestYmdHm.slice(4, 6))
    const day = Number(latestYmdHm.slice(6, 8))
    const hour = Number(latestYmdHm.slice(8, 10))
    const minute = Number(latestYmdHm.slice(10, 12))
    if (![year, month, day, hour, minute].some((n) => Number.isNaN(n))) {
      const at = kstToUtcDate(year, month, day, hour, minute)
      if (isPlausibleObservation(at)) {
        latestAt = { at, label: formatKstStamp(at) }
      }
    }
  }
  return { active: titles.length > 0, titles, latestAt }
}

/** khoa-jeju-watertemp: "라벨: 18.2°C (14:30 관측)" per station line. Time-only — date assumed "today KST". */
function parseWatertempLatest(text: string): AsOf | null {
  const matches = [...text.matchAll(/\((\d{1,2}):(\d{2})\s*관측\)/g)]
  if (matches.length === 0) return null
  // KST "today" components — nowKst()'s UTC getters yield KST values by
  // construction (epoch shifted +9h). Used only for year/month/day here.
  const now = nowKst()
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth() + 1
  const day = now.getUTCDate()
  // Take the latest (largest) time-of-day among stations as the freshest reading.
  let best: { hour: number; minute: number } | null = null
  for (const m of matches) {
    const hour = Number(m[1])
    const minute = Number(m[2])
    if (Number.isNaN(hour) || Number.isNaN(minute)) continue
    if (!best || hour * 60 + minute > best.hour * 60 + best.minute) best = { hour, minute }
  }
  if (!best) return null
  const at = kstToUtcDate(year, month, day, best.hour, best.minute)
  // If the parsed time-of-day is later than KST-now (e.g. station reported
  // 22:00 but the session clock is 21:55), the observation is most likely
  // from the previous day's same hour — roll back 24h so the age comparison
  // is honest instead of flagging it as "future/stale".
  if (at.getTime() - nowUtc().getTime() > 60 * 1000) {
    const rolled = new Date(at.getTime() - 24 * 60 * 60 * 1000)
    if (!isPlausibleObservation(rolled)) return null
    return { at: rolled, label: formatKstStamp(rolled) }
  }
  if (!isPlausibleObservation(at)) return null
  return { at, label: formatKstStamp(at) }
}

/** Reserved: no wave/wind connector in the governance snapshot today (see module doc). */
function parseWaveReadings(_snapshot: JejuSnapshot): { heightM: number } | null {
  return null
}

/** kpx-jeju-smp: "제주 계통한계가격(SMP)·수요예측 — YYYY-MM-DD 기준" */
function parseSmpDate(text: string): AsOf | null {
  const m = text.match(/—\s*(\d{4})-(\d{2})-(\d{2})\s*기준/)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if ([year, month, day].some((n) => Number.isNaN(n))) return null
  // Daily table — anchor to KST midnight for age comparisons.
  const at = kstToUtcDate(year, month, day, 0, 0)
  if (!isPlausibleObservation(at)) return null
  return { at, label: `${m[1]}-${m[2]}-${m[3]}` }
}

type SmpHourRow = { hour: number; smp: number | null; demand: number | null }

/** kpx-jeju-smp: "HH시: 제주 계통한계가격(SMP, 원/kWh) X[, 제주 수요예측(KPX 추정) Y]" */
function parseSmpHourRows(text: string): SmpHourRow[] {
  const rows: SmpHourRow[] = []
  const re =
    /(\d{2})시: 제주 계통한계가격\(SMP, 원\/kWh\) ([\d.?]+)(?:, 제주 수요예측\(KPX 추정\) ([\d.?]+))?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const hour = Number(m[1])
    const smpRaw = m[2]
    const demandRaw = m[3]
    rows.push({
      hour,
      smp: smpRaw && smpRaw !== '?' ? Number(smpRaw) : null,
      demand: demandRaw && demandRaw !== '?' ? Number(demandRaw) : null,
    })
  }
  return rows
}

/** kamis-jeju-products: text is JSON.stringify({ error_code, price: [...] }, null, 2). */
function parseKamisRegday(text: string): AsOf | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const price = (parsed as Record<string, unknown>).price
  if (!Array.isArray(price) || price.length === 0) return null

  // nowKst()'s UTC getters yield KST components — used only for the
  // year-boundary fallback (KAMIS often omits the year on M/D strings).
  const kstNow = nowKst()
  const now = nowUtc()
  let best: Date | null = null
  for (const row of price) {
    if (!row || typeof row !== 'object') continue
    const raw = (row as Record<string, unknown>).regday
    if (typeof raw !== 'string' || !raw.trim()) continue
    let d: Date | null = null
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    const md = raw.match(/^(\d{1,2})\/(\d{1,2})$/)
    if (iso) {
      d = kstToUtcDate(Number(iso[1]), Number(iso[2]), Number(iso[3]), 0, 0)
    } else if (md) {
      // KAMIS often omits the year — assume current KST year, roll back one
      // year if that would place it >1 day in the future (year-boundary safety).
      const year = kstNow.getUTCFullYear()
      let candidate = kstToUtcDate(year, Number(md[1]), Number(md[2]), 0, 0)
      if (candidate.getTime() - now.getTime() > 24 * 60 * 60 * 1000) {
        candidate = kstToUtcDate(year - 1, Number(md[1]), Number(md[2]), 0, 0)
      }
      d = candidate
    }
    if (d && isPlausibleObservation(d, now) && (!best || d.getTime() > best.getTime())) best = d
  }
  return best ? { at: best, label: formatKstStamp(best) } : null
}

/**
 * Returns a short parsed-timestamp label for the evidence ledger, or null
 * when no timestamp parses. The ledger renders '정기 갱신' for null — never
 * '—', '미표기', 'N/A', or empty. Status words ('특보 없음' etc.) are NOT
 * timestamps and are deliberately kept out of this column.
 */
function extractAsOfLabel(source: JejuSnapshotSource): string | null {
  if (!source.ok) return null
  switch (source.id) {
    case 'kma-jeju-weather':
      return parseWeatherObservedAt(source.text)?.label ?? null
    case 'kma-jeju-warning':
      return parseWarningState(source.text).latestAt?.label ?? null
    case 'khoa-jeju-watertemp':
      return parseWatertempLatest(source.text)?.label ?? null
    case 'kpx-jeju-smp':
      return parseSmpDate(source.text)?.label ?? null
    case 'kamis-jeju-products':
      return parseKamisRegday(source.text)?.label ?? null
    default:
      return null
  }
}

// ── R1 — STALENESS ───────────────────────────────────────────────────────────

function ruleStaleness(snapshot: JejuSnapshot): DataFinding[] {
  const out: DataFinding[] = []
  // Comparison base MUST be a real UTC epoch — kstToUtcDate() returns real UTC
  // epochs. Using nowKst() here was the R1 false-positive root cause (it
  // shifted the comparison +9h, flipping same-evening observations to stale).
  const now = nowUtc()

  const weather = findSource(snapshot, 'kma-jeju-weather')
  if (weather?.ok) {
    const asOf = parseWeatherObservedAt(weather.text)
    if (asOf && hoursBetween(now, asOf.at) > CROSS_CHECK_CONST.STALE_WEATHER_HOURS) {
      out.push({
        item: '제주시 초단기실황(KMA) 관측 시각',
        sources: ['kma-jeju-weather'],
        conflict: `관측 시각(${asOf.label})이 기준 ${CROSS_CHECK_CONST.STALE_WEATHER_HOURS}시간을 넘겨 갱신되지 않았습니다.`,
        status: 'disputed',
        verifyWith: '기상청(KMA) 제주지방기상청에 최신 관측치 확인',
      })
    }
  }

  const warning = findSource(snapshot, 'kma-jeju-warning')
  if (warning?.ok) {
    const st = parseWarningState(warning.text)
    if (st.active && st.latestAt && hoursBetween(now, st.latestAt.at) > CROSS_CHECK_CONST.STALE_WEATHER_HOURS) {
      out.push({
        item: '제주 기상특보(KMA) 발표 시각',
        sources: ['kma-jeju-warning'],
        conflict: `발효 중인 특보의 발표 시각(${st.latestAt.label})이 기준 ${CROSS_CHECK_CONST.STALE_WEATHER_HOURS}시간을 넘겼습니다 — 해제 여부 미확인.`,
        status: 'disputed',
        verifyWith: '기상청(KMA) 특보 현황 재확인',
      })
    }
  }

  const watertemp = findSource(snapshot, 'khoa-jeju-watertemp')
  if (watertemp?.ok) {
    const asOf = parseWatertempLatest(watertemp.text)
    if (asOf && hoursBetween(now, asOf.at) > CROSS_CHECK_CONST.STALE_MARINE_HOURS) {
      out.push({
        item: '제주 연안 실측 수온(KHOA) 관측 시각',
        sources: ['khoa-jeju-watertemp'],
        conflict: `관측 시각(${asOf.label})이 기준 ${CROSS_CHECK_CONST.STALE_MARINE_HOURS}시간을 넘겨 갱신되지 않았습니다.`,
        status: 'disputed',
        verifyWith: '국립해양조사원(KHOA) 조위관측소 실측값 확인',
      })
    }
  }

  const smp = findSource(snapshot, 'kpx-jeju-smp')
  if (smp?.ok) {
    const asOf = parseSmpDate(smp.text)
    if (asOf && hoursBetween(now, asOf.at) > CROSS_CHECK_CONST.STALE_POWER_HOURS) {
      out.push({
        item: '제주 계통한계가격·수요예측(KPX) 기준일',
        sources: ['kpx-jeju-smp'],
        conflict: `기준일(${asOf.label})이 ${CROSS_CHECK_CONST.STALE_POWER_HOURS}시간을 넘겨 갱신되지 않았습니다.`,
        status: 'disputed',
        verifyWith: '한국전력거래소(KPX) 제주 SMP 최신치 확인',
      })
    }
  }

  const kamis = findSource(snapshot, 'kamis-jeju-products')
  if (kamis?.ok) {
    const asOf = parseKamisRegday(kamis.text)
    // No forced 'unresolved' when regday is simply absent — see module doc.
    if (asOf && daysBetween(now, asOf.at) > CROSS_CHECK_CONST.STALE_PRICE_DAYS) {
      out.push({
        item: '제주 농수산물 가격(KAMIS) 등록일',
        sources: ['kamis-jeju-products'],
        conflict: `가격 등록일(${asOf.label})이 기준 ${CROSS_CHECK_CONST.STALE_PRICE_DAYS}일을 넘겼습니다.`,
        status: 'disputed',
        verifyWith: '농산물유통정보(KAMIS)에 최신 시세 확인',
      })
    }
  }

  return out
}

// ── R2 — CROSS-SOURCE WEATHER/MARINE (wind proxy — see module doc) ─────────

function ruleCrossSourceWeatherMarine(snapshot: JejuSnapshot): DataFinding[] {
  const out: DataFinding[] = []
  const weather = findSource(snapshot, 'kma-jeju-weather')
  const warning = findSource(snapshot, 'kma-jeju-warning')
  if (!weather?.ok || !warning?.ok) return out

  const windMs = parseWeatherWindMs(weather.text)
  const st = parseWarningState(warning.text)
  const severeTitles = st.titles.filter((t) => /강풍|풍랑|태풍/.test(t))

  if (windMs != null) {
    if (severeTitles.length > 0 && windMs < CROSS_CHECK_CONST.SEVERE_WIND_MS / 2) {
      out.push({
        item: 'KMA 기상특보 vs 초단기실황 풍속',
        sources: ['kma-jeju-warning', 'kma-jeju-weather'],
        conflict: `강풍·풍랑 계열 특보(${severeTitles.join(', ')})가 발효 중이나 실황 풍속은 ${windMs}m/s로 평온합니다.`,
        status: 'disputed',
        verifyWith: '기상청(KMA)에 특보 유효 지역·시각 재확인',
      })
    } else if (severeTitles.length === 0 && windMs >= CROSS_CHECK_CONST.SEVERE_WIND_MS) {
      out.push({
        item: 'KMA 초단기실황 풍속 vs 기상특보',
        sources: ['kma-jeju-weather', 'kma-jeju-warning'],
        conflict: `실황 풍속이 ${windMs}m/s로 강풍주의보 기준(${CROSS_CHECK_CONST.SEVERE_WIND_MS}m/s)을 넘었으나 관련 특보가 발효되어 있지 않습니다.`,
        status: 'disputed',
        verifyWith: '기상청(KMA)에 특보 발표 여부 재확인',
      })
    }
  }

  // Dormant wave hook — stays silent until a wave/wind-wave source exists.
  const wave = parseWaveReadings(snapshot)
  if (wave && wave.heightM >= CROSS_CHECK_CONST.SEVERE_WAVE_M && severeTitles.length === 0) {
    out.push({
      item: 'KHOA 파고 vs 기상특보',
      sources: ['khoa-jeju-watertemp'],
      conflict: `유의파고 ${wave.heightM}m가 풍랑주의보 기준(${CROSS_CHECK_CONST.SEVERE_WAVE_M}m)을 넘었으나 관련 특보가 없습니다.`,
      status: 'disputed',
      verifyWith: '기상청(KMA)에 풍랑특보 발표 여부 확인',
    })
  }

  return out
}

// ── R3 — MISSING/MALFORMED ───────────────────────────────────────────────────

/**
 * Sources whose fields at least one rule (R1/R2/R4/R5) actually consumes.
 * R3 emits an 'unresolved' finding ONLY for these — a source no rule reads
 * (e.g. kpx-jeju-power, which has no dedicated renderer and is consumed by
 * none of R1–R5) must NEVER produce a finding, even on collection failure.
 * This is the suppression contract: "a field no rule reads must never
 * produce a finding."
 */
const MONITORED_SOURCE_IDS: readonly string[] = [
  'kma-jeju-weather',
  'kma-jeju-warning',
  'khoa-jeju-watertemp',
  'kpx-jeju-smp',
  'kamis-jeju-products',
]

function ruleMissingOrMalformed(snapshot: JejuSnapshot): {
  findings: DataFinding[]
  fieldNotes: DataFieldNote[]
} {
  const out: DataFinding[] = []
  const fieldNotes: DataFieldNote[] = []

  for (const id of MONITORED_SOURCE_IDS) {
    const source = findSource(snapshot, id)
    if (!source) continue

    if (!source.ok) {
      out.push({
        item: `${source.label} 수집 실패`,
        sources: [id],
        conflict: `필수 데이터 수집에 실패했습니다: ${source.error ?? '원인 미상'}.`,
        status: 'unresolved',
        verifyWith: '해당 기관 API 상태 확인 후 재수집',
      })
      continue
    }

    // Per-source "required field parses" checks — ONLY for fields another rule
    // (R1/R2/R4/R5) actually reads. A field no rule consumes is never checked
    // here, so a missing-but-irrelevant field cannot produce 'unresolved' noise.
    //
    // R3 SCOPE FIX: a single unparseable secondary field must NOT condemn the
    // whole source. If the source's PRIMARY payload parsed (SMP hourly table
    // present, KAMIS price rows present), the source stays 'ok' and is
    // reflected in the conclusion. The missing field is recorded as a
    // DataFieldNote (footnote under the ledger table) — never as a
    // source-level 'unresolved' finding that would flip 결론 반영 to '미반영'.
    if (id === 'kma-jeju-weather' && !parseWeatherObservedAt(source.text)) {
      out.push({
        item: '제주시 초단기실황(KMA) 관측 시각 필드',
        sources: [id],
        conflict: '응답은 수신되었으나 관측 시각(baseDate/baseTime)을 파싱할 수 없습니다.',
        status: 'unresolved',
        verifyWith: '기상청(KMA) API 응답 형식 확인',
      })
    }
    if (id === 'kpx-jeju-smp') {
      const hourRows = parseSmpHourRows(source.text)
      const hasPrimaryPayload = hourRows.some((r) => r.smp != null)
      const dateParsed = parseSmpDate(source.text)
      if (!hasPrimaryPayload && !dateParsed) {
        // Primary payload AND date both missing → genuine source-level failure.
        out.push({
          item: '제주 계통한계가격(KPX) 데이터',
          sources: [id],
          conflict: '응답은 수신되었으나 SMP 시간별 표와 기준일 모두 파싱할 수 없습니다.',
          status: 'unresolved',
          verifyWith: '한국전력거래소(KPX) API 응답 형식 확인',
        })
      } else if (hasPrimaryPayload && !dateParsed) {
        // Primary payload parsed, 기준일 field missing → field-level note only.
        fieldNotes.push({
          sourceId: id,
          field: '기준일',
          note: 'SMP 시간별 표는 정상 수신되었으나 기준일 필드를 파싱하지 못해 R1/R5의 시각 기반 점검에서만 제외됩니다. 결론 반영에는 영향 없음.',
        })
      }
      // hasPrimaryPayload && dateParsed → no finding, no note.
    }
    if (id === 'khoa-jeju-watertemp' && !parseWatertempLatest(source.text)) {
      out.push({
        item: '제주 연안 실측 수온(KHOA) 관측값 필드',
        sources: [id],
        conflict: '응답은 수신되었으나 관측 시각·수온값을 파싱할 수 없습니다.',
        status: 'unresolved',
        verifyWith: '국립해양조사원(KHOA) API 응답 형식 확인',
      })
    }
    if (id === 'kamis-jeju-products') {
      let parsed: unknown = null
      try {
        parsed = JSON.parse(source.text)
      } catch {
        parsed = null
      }
      const priceRows =
        parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).price : null
      const hasPrimaryPayload = Array.isArray(priceRows) && priceRows.length > 0
      const regdayParsed = parseKamisRegday(source.text)
      if (!hasPrimaryPayload) {
        // Primary payload missing → genuine source-level failure.
        out.push({
          item: '제주 농수산물 가격(KAMIS) 데이터',
          sources: [id],
          conflict: '응답은 수신되었으나 유효한 가격 항목이 없습니다.',
          status: 'unresolved',
          verifyWith: '농산물유통정보(KAMIS) 품목 코드·응답 확인',
        })
      } else if (!regdayParsed) {
        // Price rows present, regday field missing → field-level note only.
        fieldNotes.push({
          sourceId: id,
          field: '가격 등록일',
          note: '가격 항목은 정상 수신되었으나 등록일(regday) 필드를 파싱하지 못해 R1/R5의 시각 기반 점검에서만 제외됩니다. 결론 반영에는 영향 없음.',
        })
      }
    }
  }

  return { findings: out, fieldNotes }
}

// ── R4 — DIRECTIONAL COUPLING (KPX demand vs SMP) ───────────────────────────

function ruleDirectionalCoupling(snapshot: JejuSnapshot): DataFinding[] {
  const out: DataFinding[] = []
  const smp = findSource(snapshot, 'kpx-jeju-smp')
  if (!smp?.ok) return out

  const rows = parseSmpHourRows(smp.text)
    .filter((r) => r.smp != null && r.demand != null)
    .sort((a, b) => a.hour - b.hour)
  if (rows.length < 2) return out

  const first = rows[0]!
  const last = rows[rows.length - 1]!
  if (first.smp === 0 || first.demand === 0) return out

  const smpPct = ((last.smp! - first.smp!) / Math.abs(first.smp!)) * 100
  const demandPct = ((last.demand! - first.demand!) / Math.abs(first.demand!)) * 100
  const band = CROSS_CHECK_CONST.COUPLING_MIN_PCT

  const smpUp = smpPct > band
  const smpDown = smpPct < -band
  const demandUp = demandPct > band
  const demandDown = demandPct < -band

  if ((demandUp && smpDown) || (demandDown && smpUp)) {
    out.push({
      item: 'KPX 수요예측 vs SMP 방향성',
      sources: ['kpx-jeju-smp'],
      conflict: `${first.hour}시→${last.hour}시 사이 수요예측이 ${demandPct.toFixed(1)}% 변화한 반면 SMP는 ${smpPct.toFixed(1)}% 반대 방향으로 변화했습니다(허용 오차 ${band}%).`,
      status: 'disputed',
      verifyWith: '한국전력거래소(KPX)에 수급·가격 산정 근거 확인',
    })
  }

  return out
}

// ── R5 — TIMESTAMP SKEW ──────────────────────────────────────────────────────

function ruleTimestampSkew(snapshot: JejuSnapshot): DataFinding[] {
  const out: DataFinding[] = []

  // Only compare sources with a genuine CALENDAR DATE (not time-of-day-only
  // readings like watertemp, which default to "today" and would never skew).
  const dated: { id: string; label: string; asOf: AsOf }[] = []
  const weather = findSource(snapshot, 'kma-jeju-weather')
  const smp = findSource(snapshot, 'kpx-jeju-smp')
  const kamis = findSource(snapshot, 'kamis-jeju-products')

  if (weather?.ok) {
    const a = parseWeatherObservedAt(weather.text)
    if (a) dated.push({ id: 'kma-jeju-weather', label: weather.label, asOf: a })
  }
  if (smp?.ok) {
    const a = parseSmpDate(smp.text)
    if (a) dated.push({ id: 'kpx-jeju-smp', label: smp.label, asOf: a })
  }
  if (kamis?.ok) {
    const a = parseKamisRegday(kamis.text)
    if (a) dated.push({ id: 'kamis-jeju-products', label: kamis.label, asOf: a })
  }

  for (let i = 0; i < dated.length; i++) {
    for (let j = i + 1; j < dated.length; j++) {
      const a = dated[i]!
      const b = dated[j]!
      const skew = daysBetween(a.asOf.at, b.asOf.at)
      if (skew > CROSS_CHECK_CONST.SKEW_MAX_DAYS) {
        out.push({
          item: `${a.label} vs ${b.label} 기준시각 차이`,
          sources: [a.id, b.id],
          conflict: `두 출처의 기준시각이 ${skew.toFixed(1)}일 차이가 나 같은 시점의 상황으로 보기 어렵습니다(${a.asOf.label} vs ${b.asOf.label}).`,
          status: 'disputed',
          verifyWith: '두 기관 모두에 최신 데이터 시점 재확인',
        })
      }
    }
  }

  return out
}

// ── Auto re-investigation (Perplexity, hard-capped) ─────────────────────────

/** Structural shape matching lib/jeju/deep.ts's private MergedSearch (not exported). */
type CrossCheckSearchItem = { query: string; requestedBy: string[] }

function buildRecheckQuery(f: DataFinding): string {
  return `${f.item}: ${f.conflict} 이 불일치가 실제로 존재하는지 최신 공식 정보로 확인해줘.`
}

/** confirmed → ok | contradicted → disputed | inconclusive/unclear → unresolved. */
function mapRecheckResultToStatus(resultText: string): TrustStatus {
  const t = resultText.toLowerCase()
  if (/모순|불일치|contradict|여전히.*다르|확인되지 않|사실과 다름/.test(resultText)) return 'disputed'
  if (/확인됨|일치|사실로 확인|정상|confirm/.test(resultText) && !/모순|불일치/.test(resultText)) return 'ok'
  return 'unresolved'
}

/**
 * Runs up to CROSS_CHECK_CONST.MAX_RECHECK_CALLS Perplexity searches for
 * 'disputed' findings, updating their status/recheck field in place on a
 * shallow copy. Never throws — a failed/timed-out call degrades to
 * 'unresolved', never 'ok'.
 */
async function autoReinvestigate(findings: DataFinding[]): Promise<{ findings: DataFinding[]; callsUsed: number }> {
  const disputed = findings.filter((f) => f.status === 'disputed')
  if (disputed.length === 0) return { findings, callsUsed: 0 }

  const toRecheck = disputed.slice(0, CROSS_CHECK_CONST.MAX_RECHECK_CALLS)
  let executeJejuSearches: typeof import('@/lib/jeju/deep').executeJejuSearches
  try {
    ;({ executeJejuSearches } = await import('@/lib/jeju/deep'))
  } catch (e: unknown) {
    console.warn('[jeju/cross-check] could not load search helper:', e instanceof Error ? e.message : e)
    return { findings, callsUsed: 0 }
  }

  const merged: CrossCheckSearchItem[] = toRecheck.map((f) => ({
    query: buildRecheckQuery(f),
    requestedBy: ['data-cross-check'],
  }))

  let results: Awaited<ReturnType<typeof executeJejuSearches>>
  try {
    results = await executeJejuSearches({ merged })
  } catch (e: unknown) {
    console.warn('[jeju/cross-check] recheck search threw:', e instanceof Error ? e.message : e)
    // Degrade the attempted findings to 'unresolved' — never leave them
    // silently 'disputed'-with-no-recheck-note, and never mark 'ok'.
    const degraded = new Set(toRecheck)
    return {
      findings: findings.map((f) =>
        degraded.has(f) ? { ...f, status: 'unresolved' as TrustStatus, recheck: '재조사 호출 실패' } : f
      ),
      callsUsed: 0,
    }
  }

  const byQuery = new Map(results.map((r) => [r.query, r]))
  const updated = findings.map((f) => {
    const idx = toRecheck.indexOf(f)
    if (idx === -1) return f
    const r = byQuery.get(merged[idx]!.query)
    if (!r || !r.ok || !r.result) {
      return { ...f, status: 'unresolved' as TrustStatus, recheck: r?.error ?? '재조사 결과 없음' }
    }
    return { ...f, status: mapRecheckResultToStatus(r.result), recheck: r.result }
  })

  return { findings: updated, callsUsed: toRecheck.length }
}

// ── Demo hook (env-gated, off by default, never active in prod unless overridden) ──

function demoCorruptionEnabled(): boolean {
  if (process.env.JEJU_DEMO_CORRUPT !== '1') return false
  if (process.env.NODE_ENV !== 'production') return true
  return process.env.JEJU_DEMO_ALLOW_PROD === '1'
}

/**
 * Injects one deliberately-stale marine timestamp (KHOA water-temp) into a
 * SHALLOW COPY of the snapshot so the R1 staleness path can be demonstrated
 * live. The corrupted value is tagged in the text itself so it can never be
 * mistaken for a genuine reading downstream.
 */
function applyDemoCorruption(snapshot: JejuSnapshot): JejuSnapshot {
  if (!demoCorruptionEnabled()) return snapshot
  const idx = snapshot.sources.findIndex((s) => s.id === 'khoa-jeju-watertemp' && s.ok)
  if (idx === -1) return snapshot

  const stale = new Date(nowKst().getTime() - 9 * 60 * 60 * 1000)
  const staleHm = `${String(stale.getUTCHours()).padStart(2, '0')}:${String(stale.getUTCMinutes()).padStart(2, '0')}`
  const original = snapshot.sources[idx]!
  const corruptedText =
    original.text.replace(/\(\d{1,2}:\d{2}\s*관측\)/g, `(${staleHm} 관측)`) +
    '\n[DEMO: JEJU_DEMO_CORRUPT=1로 인위적으로 변조된 관측 시각 — 실데이터 아님]'

  const sources = snapshot.sources.slice()
  sources[idx] = { ...original, text: corruptedText }
  return { ...snapshot, sources }
}

// ── Runner ────────────────────────────────────────────────────────────────

/**
 * Runs the full cross-check pass: five rules → optional auto re-investigation
 * of 'disputed' findings. Never throws — any internal failure returns
 * { findings: [], hasIssues: false, recheckCallsUsed: 0 } and logs.
 */
export async function runJejuCrossCheck(params: { snapshot: JejuSnapshot }): Promise<DataTrustResult> {
  try {
    const snapshot = applyDemoCorruption(params.snapshot)

    const r3 = ruleMissingOrMalformed(snapshot)
    const findings = [
      ...ruleStaleness(snapshot),
      ...ruleCrossSourceWeatherMarine(snapshot),
      ...r3.findings,
      ...ruleDirectionalCoupling(snapshot),
      ...ruleTimestampSkew(snapshot),
    ]

    if (findings.length === 0 && r3.fieldNotes.length === 0) {
      return { findings: [], hasIssues: false, fieldNotes: [], recheckCallsUsed: 0 }
    }

    const { findings: rechecked, callsUsed } = await autoReinvestigate(findings)
    const hasIssues = rechecked.some((f) => f.status !== 'ok')

    return {
      findings: rechecked,
      hasIssues,
      fieldNotes: r3.fieldNotes,
      recheckCallsUsed: callsUsed,
    }
  } catch (e: unknown) {
    console.warn('[jeju/cross-check] runJejuCrossCheck threw:', e instanceof Error ? e.message : e)
    return { findings: [], hasIssues: false, fieldNotes: [], recheckCallsUsed: 0 }
  }
}

// ── Prompt block builder (INPUT to debate/chair/analyst prompts) ───────────

function statusLabel(status: TrustStatus): string {
  return status === 'ok' ? '정상 확인' : status === 'disputed' ? '불일치' : '확인 불가'
}

/**
 * Renders the "■ [데이터 신뢰도 점검]" block appended to debate-round,
 * chair-verdict, open-brief analyst, and open-brief synthesis prompts.
 * Returns '' when there are no issues — strict no-op when unused, matching
 * buildJejuSupplementBlock's contract.
 */
export function buildDataTrustBlock(block: DataTrustBlock): string {
  if (!block.hasIssues || block.findings.length === 0) return ''
  const lines: string[] = ['', '■ [데이터 신뢰도 점검]', CROSS_CHECK_DIRECTIVE]
  block.findings.forEach((f, i) => {
    lines.push(`  · [점검 ${i + 1}] ${f.item} — ${statusLabel(f.status)}`)
    lines.push(`    출처: ${f.sources.join(', ')}`)
    lines.push(`    불일치: ${f.conflict}`)
    if (f.recheck) lines.push(`    재조사 결과: ${f.recheck}`)
    if (f.verifyWith) lines.push(`    확인 필요 기관: ${f.verifyWith}`)
  })
  return lines.join('\n')
}

// ── Chair-verdict OUTPUT section (code-rendered — never LLM-authored) ──────

/**
 * Deterministically renders the "데이터 이견 및 확인 필요 사항" section body.
 * Code-rendered (not left to the chair's free-form prose) for the same
 * reliability reason fallbackMinorityReport exists in deep.ts: the content is
 * exact structured data, so generating it in code guarantees it is never
 * dropped, paraphrased, or hallucinated by the model.
 */
export function renderDataTrustSection(block: DataTrustBlock): string {
  if (!block.hasIssues || block.findings.length === 0) return '데이터 출처 간 불일치 없음.'
  return block.findings
    .map((f, i) => {
      const excluded = f.status === 'ok' ? '결론에 반영됨' : f.status === 'disputed' ? '참고만 하고 결론에서 제외됨' : '데이터 미확인으로 결론에서 제외됨'
      const lines = [
        `${i + 1}. ${f.item}`,
        `   무엇이 어긋났는지: ${f.conflict}`,
        `   재조사 결과: ${f.recheck ?? '재조사 미실시'} (${statusLabel(f.status)})`,
        `   결론 반영 여부: ${excluded}`,
        `   확인 필요 기관: ${f.verifyWith ?? '해당 없음'}`,
      ]
      return lines.join('\n')
    })
    .join('\n\n')
}

// ── Evidence ledger (chair-verdict appendix — ALWAYS rendered) ──────────────

function conclusionLabel(status: TrustStatus): string {
  return status === 'ok' ? '반영' : status === 'disputed' ? '참고만' : '미반영'
}

function statusPriority(status: TrustStatus): number {
  return status === 'unresolved' ? 2 : status === 'disputed' ? 1 : 0
}

/**
 * Renders the "출처 | 확보 | 기준시각 | 점검결과 | 결론 반영" table from the
 * EXISTING JejuSnapshot.sources[] — no new data, no DB change. Rendered
 * ALWAYS (not only when hasIssues), as a plain space-padded table (verdict
 * sections are shown as whitespace-pre-wrap plain text, not markdown).
 *
 * Presentation rules (presentation fix — no rule logic change):
 *   - Rows: ONLY sources with ok === true that were actually fed into this
 *     deliberation. Failed/unused connectors are excluded from the table
 *     entirely and counted in the header summary line instead.
 *   - Defaults: a source with no finding renders 점검결과='이상 없음' and
 *     결론 반영='반영'. 기준시각='정기 갱신' when no timestamp parses.
 *     Never '—', '미표기', 'N/A', or empty.
 *   - Header summary line (code-rendered, never LLM-authored) above the
 *     table carries TOTAL / USED / OK / 확인 필요 counts.
 *   - Field-level footnotes (R3 scope fix): when a source's primary payload
 *     parsed but a single secondary field did not, the source stays 'ok'
 *     and 결론 반영='반영'. The missing field is rendered as a footnote
 *     line under the table — never as a source-level exclusion. The ledger
 *     must never claim a source was excluded from the conclusion when its
 *     values are present in the deliberation context.
 */
export function buildEvidenceLedger(
  snapshot: JejuSnapshot,
  findings: DataFinding[],
  fieldNotes: DataFieldNote[] = []
): string {
  // TOTAL = the full registered connector set. gatherJejuSnapshot (lib/jeju/brief.ts)
  // always fetches every registered governance source, ok or not, so
  // snapshot.sources.length is the registered count — effectively constant per
  // deployment, independent of this run's pass/fail outcomes.
  const total = snapshot.sources.length

  const okSources = snapshot.sources.filter((s) => s.ok)
  const used = okSources.length

  const rows: string[][] = okSources.map((s) => {
    const matched = findings.filter((f) => f.sources.includes(s.id))
    const worst = matched.reduce<DataFinding | null>((acc, f) => {
      if (!acc) return f
      return statusPriority(f.status) > statusPriority(acc.status) ? f : acc
    }, null)
    const status: TrustStatus = worst?.status ?? 'ok'
    const asOf = extractAsOfLabel(s) ?? '정기 갱신'
    return [s.label, '성공', asOf, worst ? statusLabel(status) : '이상 없음', conclusionLabel(status)]
  })

  const okCount = rows.filter((r) => r[3] === '이상 없음' || r[3] === '정상 확인').length
  const disputedCount = rows.filter((r) => r[3] === '불일치').length
  const unresolvedCount = rows.filter((r) => r[3] === '확인 불가').length
  const needsAttention = disputedCount + unresolvedCount

  const summaryLine = `데이터 점검 요약 — 연동 ${total}종 중 이번 심의 활용 ${used}종 / 정상 ${okCount} / 확인 필요 ${needsAttention}`

  const header = ['출처', '확보', '기준시각', '점검결과', '결론 반영']
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)))
  const padRow = (cols: string[]) => cols.map((c, i) => c.padEnd(widths[i]!)).join(' | ')
  const sep = widths.map((w) => '-'.repeat(w)).join('-+-')

  const tableLines = [summaryLine, '', padRow(header), sep, ...rows.map(padRow)]

  // Field-level footnotes — rendered ONLY when present. Each note is a single
  // line prefixed with '※' and the source label, so a reader can tell at a
  // glance that the source is still reflected in the conclusion.
  if (fieldNotes.length > 0) {
    const labelById = new Map(snapshot.sources.map((s) => [s.id, s.label]))
    const noteLines = fieldNotes.map((n) => {
      const label = labelById.get(n.sourceId) ?? n.sourceId
      return `※ ${label} — ${n.field} 미파싱: ${n.note}`
    })
    return [...tableLines, '', ...noteLines].join('\n')
  }

  return tableLines.join('\n')
}
