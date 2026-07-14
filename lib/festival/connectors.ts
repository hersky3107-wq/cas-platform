import 'server-only'

/**
 * FESTIVAL-only connector — 한국관광공사 TourAPI 4.0 (KorService2), read-only.
 *
 * ISOLATION INVARIANT (non-negotiable):
 *   - This file lives ONLY under lib/festival/. It does NOT import from and is
 *     NOT imported by lib/jeju/* or lib/motie/*. Those modules have their own
 *     data.go.kr connectors (lib/jeju/connectors.ts, lib/motie/connectors.ts)
 *     which this file NEVER touches.
 *   - Auth: READS the same shared data.go.kr service key from env
 *     (DATA_GO_KR_KEY → KPX_SERVICE_KEY fallback) that Jeju/MOTIE also read —
 *     this is a shared credential, not shared code. No new env var is added.
 *   - Deleting lib/festival/* (including this file) leaves MOTIE + Jeju
 *     byte-for-byte identical.
 *
 * Endpoints used (https://apis.data.go.kr/B551011/KorService2):
 *   - areaCode2       — 지역코드 조회. No `areaCode` param → depth-1 시/도 list.
 *                       With `areaCode=<sido>` → depth-2 시/군/구 list. Used ONLY
 *                       to resolve a free-text region string into the legacy
 *                       areaCode/sigunguCode pair that searchFestival2 expects
 *                       (searchFestival2 does NOT accept the newer 법정동
 *                       lDongRegnCd/lDongSignguCd codes from ldongCode2, so
 *                       areaCode2 — not ldongCode2 — is the correct resolver
 *                       for this specific downstream call). VERIFIED against a
 *                       live serviceKey: parsing + field casing confirmed correct.
 *   - searchFestival2 — 공식 축제/행사 검색 (제목·기간·지역).
 *
 * DESIGN NOTE — why this queries the PAST, not the plan's own dates:
 *   A festival plan almost always describes a FUTURE event. Querying
 *   searchFestival2 with the plan's own future eventStartDate correctly (and
 *   uselessly) returns 0 rows, because TourAPI only has festivals that are
 *   already officially registered/scheduled — future one-off/new events
 *   aren't in it yet. Verified live: querying 제주(areaCode=39) with a past
 *   date returns real rows; the plan's own future window returns none. That's
 *   not a bug, it's the wrong question. The benchmark question is "how did
 *   COMPARABLE past festivals in this area actually do?" — so this connector
 *   queries the same region over the past ~2 years, then ranks results by
 *   festival-type keyword overlap and seasonal (month) proximity to the
 *   plan's dates, surfacing the most comparable past events as the fact
 *   anchor for the benchmark stage (lib/festival/pipeline.ts step 2:
 *   Perplexity looks up THEIR actual outcomes).
 *
 *   eventStartDate/eventEndDate quirk (empirically confirmed live): sending
 *   BOTH params together made searchFestival2 return 0 rows even for
 *   areaCode=39 with a 2-year window that should trivially contain data.
 *   Sending ONLY eventStartDate (as a lower bound, no upper bound) returns
 *   real rows. So this connector sends eventStartDate=windowStart alone and
 *   NEVER sends eventEndDate to the API — the past-vs-future upper boundary
 *   (windowEnd = today) is instead enforced client-side in
 *   fetchFestivalCandidates() by dropping any item whose own eventStartDate
 *   is after today.
 *
 *   Region-agnostic sigungu fallback: a sigungu-scoped query (e.g. areaCode=
 *   39 + sigunguCode=4 for 서귀포시) can legitimately return 0 rows even when
 *   the wider 시/도 has plenty of festivals on record — TourAPI's sigungu
 *   tagging coverage varies by region and this is nationwide (경주/경북,
 *   부산, ... not just Jeju). So when the sigungu-scoped query returns zero
 *   raw items, searchFestivalOfficial() retries with the SAME resolved
 *   areaCode and no sigunguCode — never a hardcoded region — and tags the
 *   fallback results generically from resolved.areaName (e.g. "[제주 전역
 *   유사 축제]", "[경북 전역 유사 축제]").
 *
 *   searchFestival2 params (verified live): do NOT send `listYN` (KorService2
 *   rejects with resultCode=10 INVALID_REQUEST_PARAMETER_ERROR). Do NOT send
 *   `eventEndDate` together with eventStartDate (0 rows). Send only
 *   eventStartDate as a lower bound; filter past-vs-future in code.
 *
 * Never throws. Every exported function returns an explicit { ok, ... } shape
 * and degrades gracefully to { ok: false, error } on any failure (missing key,
 * timeout, HTTP error, unparseable body, empty result).
 */

const BASE = 'https://apis.data.go.kr/B551011/KorService2'
const TIMEOUT_MS = 12_000
const MOBILE_OS = 'ETC'
const MOBILE_APP = 'CAS-Festival'

function serviceKey(): string {
  return process.env.DATA_GO_KR_KEY ?? process.env.KPX_SERVICE_KEY ?? ''
}

function masked(url: string): string {
  return url.replace(/serviceKey=[^&]+/i, 'serviceKey=***')
}

function buildKorServiceUrl(path: string, params: Record<string, string>): string | null {
  const key = serviceKey()
  if (!key) return null
  const qs = new URLSearchParams({
    serviceKey: key,
    MobileOS: MOBILE_OS,
    MobileApp: MOBILE_APP,
    _type: 'json',
    numOfRows: '50',
    pageNo: '1',
    ...params,
  })
  return `${BASE}/${path}?${qs.toString()}`
}

function asArray<T>(item: unknown): T[] {
  if (Array.isArray(item)) return item as T[]
  if (item === undefined || item === null || item === '') return []
  return [item as T]
}

function str(v: unknown): string | null {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

type KorServiceEnvelope = {
  response?: {
    header?: { resultCode?: string; resultMsg?: string }
    body?: {
      items?: { item?: unknown } | '' | null
      totalCount?: number
    }
  }
}

/** Low-level GET against KorService2 — never throws, one shared timeout. */
async function fetchKorService2<T>(
  path: string,
  params: Record<string, string>
): Promise<{ ok: true; data: T[] } | { ok: false; error: string }> {
  const url = buildKorServiceUrl(path, params)
  if (!url) return { ok: false, error: 'TourAPI 서비스키가 설정되지 않았습니다 (DATA_GO_KR_KEY).' }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    const text = await res.text()

    if (!res.ok) {
      console.error(`[festival:connectors] HTTP ${res.status} for ${masked(url)}`)
      return { ok: false, error: `TourAPI 오류 (HTTP ${res.status})` }
    }

    // TourAPI sometimes returns an XML error envelope even with _type=json
    // (e.g. SERVICE_KEY_IS_NOT_REGISTERED_ERROR, LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR).
    const trimmed = text.trimStart()
    if (trimmed.startsWith('<')) {
      const codeMatch = trimmed.match(/<returnReasonCode>([^<]*)<\/returnReasonCode>/i) ?? trimmed.match(/<cmmMsgHeader>[\s\S]*?<errMsg>([^<]*)<\/errMsg>/i)
      console.error(`[festival:connectors] XML error envelope (${codeMatch?.[1] ?? '?'}) for ${masked(url)}`)
      return { ok: false, error: 'TourAPI가 오류를 반환했습니다.' }
    }

    let json: KorServiceEnvelope
    try {
      json = JSON.parse(text) as KorServiceEnvelope
    } catch {
      console.error(`[festival:connectors] Unparseable response for ${masked(url)}: ${text.slice(0, 200)}`)
      return { ok: false, error: 'TourAPI 응답을 해석하지 못했습니다.' }
    }

    const header = json.response?.header
    if (header?.resultCode && header.resultCode !== '0000' && header.resultCode !== '00') {
      // NODATA is a valid empty result, not a failure.
      if (/NODATA/i.test(header.resultMsg ?? '') || header.resultCode === '03') {
        return { ok: true, data: [] }
      }
      console.error(`[festival:connectors] resultCode=${header.resultCode} (${header.resultMsg ?? ''}) for ${masked(url)}`)
      return { ok: false, error: header.resultMsg || 'TourAPI 오류' }
    }

    const rawItems = json.response?.body?.items
    const item = rawItems && typeof rawItems === 'object' ? rawItems.item : undefined
    return { ok: true, data: asArray<T>(item) }
  } catch (e) {
    const aborted = (e as { name?: string })?.name === 'AbortError'
    console.error(`[festival:connectors] ${aborted ? 'timeout' : 'fetch error'} for ${masked(url)}`)
    return { ok: false, error: aborted ? 'TourAPI 요청이 시간 초과되었습니다.' : 'TourAPI 요청에 실패했습니다.' }
  } finally {
    clearTimeout(timer)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Region resolver — free-text "시/도 시/군/구" → { areaCode, sigunguCode }
// ─────────────────────────────────────────────────────────────────────────────

type AreaEntry = { code: string; name: string }

/** Module-level cache — reference data is near-static; safe to keep per warm instance. */
let sidoCache: AreaEntry[] | null = null
const sigunguCache = new Map<string, AreaEntry[]>()

async function fetchSidoList(): Promise<AreaEntry[]> {
  if (sidoCache) return sidoCache
  const r = await fetchKorService2<{ code?: unknown; name?: unknown }>('areaCode2', { numOfRows: '30' })
  if (!r.ok) return []
  const list = r.data
    .map((it) => ({ code: str(it.code) ?? '', name: str(it.name) ?? '' }))
    .filter((e) => e.code && e.name)
  sidoCache = list
  return list
}

async function fetchSigunguList(areaCode: string): Promise<AreaEntry[]> {
  const cached = sigunguCache.get(areaCode)
  if (cached) return cached
  const r = await fetchKorService2<{ code?: unknown; name?: unknown }>('areaCode2', {
    areaCode,
    numOfRows: '60',
  })
  if (!r.ok) return []
  const list = r.data
    .map((it) => ({ code: str(it.code) ?? '', name: str(it.name) ?? '' }))
    .filter((e) => e.code && e.name)
  sigunguCache.set(areaCode, list)
  return list
}

/** Longest-first suffix strip — avoids partial mis-strip (e.g. 특별자치도 before 도). */
function stripSuffix(name: string, suffixes: readonly string[]): string {
  const sorted = [...suffixes].sort((a, b) => b.length - a.length)
  for (const suf of sorted) {
    if (name.length > suf.length && name.endsWith(suf)) return name.slice(0, -suf.length)
  }
  return name
}

const SIDO_SUFFIXES = ['특별자치시', '특별자치도', '광역시', '특별시', '자치도', '도'] as const
const SIGUNGU_SUFFIXES = ['시', '군', '구'] as const

function normalize(s: string): string {
  return s.trim().toLowerCase()
}

/**
 * Finds the best match for `token` among `entries`, or null.
 * Exact → stripped-suffix fallback → (optionally) containment.
 *
 * `allowContainment` defaults to true for the normal single-list lookups
 * (sido list, or one sido's sigungu list) where the candidate pool is small
 * and naming drift is the main risk. It is disabled during the nationwide
 * bare-sigungu scan (findSigunguAcrossAllSido) where the candidate pool is
 * every sigungu in the country — containment there risks false positives
 * (e.g. a short substring matching an unrelated region).
 */
function matchArea(
  token: string,
  entries: AreaEntry[],
  suffixes: readonly string[],
  allowContainment = true
): AreaEntry | null {
  const t = normalize(token)
  const exact = entries.find((e) => normalize(e.name) === t)
  if (exact) return exact

  const tStripped = normalize(stripSuffix(token, suffixes))
  const strippedMatch = entries.find((e) => normalize(stripSuffix(e.name, suffixes)) === tStripped)
  if (strippedMatch) return strippedMatch

  if (!allowContainment) return null

  // Fallback: containment (handles minor naming drift either direction).
  const contains = entries.find(
    (e) => normalize(e.name).includes(tStripped) || tStripped.includes(normalize(e.name))
  )
  return contains ?? null
}

/** True when `token` ends with a 시/군/구 suffix (and isn't just the bare suffix itself). */
function looksLikeSigungu(token: string): boolean {
  return SIGUNGU_SUFFIXES.some((suf) => token.length > suf.length && token.endsWith(suf))
}

/**
 * Nationwide bare-sigungu resolver: scans EVERY 시/도's 시/군/구 list to find
 * `token` (e.g. "경주시", "전주시", "여수시") without a 시/도 prefix. Fetches
 * all sigungu lists in parallel (each individually cached by fetchSigunguList,
 * so repeat lookups — including subsequent bare-sigungu calls — are free).
 * Uses strict matching (no containment) since the candidate pool spans the
 * whole country. Returns the first match plus whether more than one 시/도
 * had a same-named 시/군/구 (e.g. 고성군 exists in both 강원도 and 경상남도).
 */
async function findSigunguAcrossAllSido(
  token: string,
  sidoList: readonly AreaEntry[]
): Promise<{ sido: AreaEntry; sigungu: AreaEntry; ambiguous: boolean } | null> {
  const sigunguLists = await Promise.all(sidoList.map((sido) => fetchSigunguList(sido.code)))

  const matches: { sido: AreaEntry; sigungu: AreaEntry }[] = []
  for (let i = 0; i < sidoList.length; i++) {
    const match = matchArea(token, sigunguLists[i], SIGUNGU_SUFFIXES, false)
    if (match) matches.push({ sido: sidoList[i], sigungu: match })
  }

  if (matches.length === 0) return null
  return { sido: matches[0].sido, sigungu: matches[0].sigungu, ambiguous: matches.length > 1 }
}

export type FestivalRegionResolution = {
  ok: boolean
  areaCode: string | null
  areaName: string | null
  sigunguCode: string | null
  sigunguName: string | null
  note?: string
}

/**
 * Resolves a free-text region string into TourAPI's legacy
 * areaCode/sigunguCode pair via areaCode2. Never throws. Two input shapes:
 * - "시/도 시/군/구" (e.g. "제주특별자치도 서귀포시") — the normal path.
 * - Bare 시/군/구 only (e.g. "경주시", "전주시", "여수시"), no 시/도 prefix —
 *   when the first token doesn't match any 시/도, and it looks like a
 *   시/군/구 name, this scans every 시/도's 시/군/구 list nationwide to find
 *   its parent province (see findSigunguAcrossAllSido).
 *
 * - Sido unresolved (and no bare-sigungu match either) → { ok: false }
 *   (caller should not fall back to an unfiltered nationwide search — that
 *   defeats "competing festivals in THIS region").
 * - Sido resolved but sigungu unresolved → { ok: true, sigunguCode: null }
 *   (province-level scope is still meaningful).
 */
export async function resolveFestivalRegion(regionRaw: string): Promise<FestivalRegionResolution> {
  const region = (regionRaw ?? '').trim()
  if (!region) {
    return { ok: false, areaCode: null, areaName: null, sigunguCode: null, sigunguName: null, note: '지역 미입력' }
  }

  const tokens = region.split(/\s+/).filter(Boolean)
  const sidoToken = tokens[0] ?? region
  const sigunguToken = tokens.slice(1).join(' ') || null

  const sidoList = await fetchSidoList()
  if (sidoList.length === 0) {
    return {
      ok: false,
      areaCode: null,
      areaName: null,
      sigunguCode: null,
      sigunguName: null,
      note: 'TourAPI 지역코드 조회 실패(서비스키/네트워크 확인 필요)',
    }
  }

  const sido = matchArea(sidoToken, sidoList, SIDO_SUFFIXES)
  if (!sido) {
    // Bare 시/군/구 fallback (no 시/도 prefix, e.g. "경주시") — only when
    // there's exactly one token (nothing left over to be a sigungu name) and
    // it looks like a 시/군/구. Scans nationwide for its parent province.
    if (!sigunguToken && looksLikeSigungu(sidoToken)) {
      const found = await findSigunguAcrossAllSido(sidoToken, sidoList)
      if (found) {
        return {
          ok: true,
          areaCode: found.sido.code,
          areaName: found.sido.name,
          sigunguCode: found.sigungu.code,
          sigunguName: found.sigungu.name,
          ...(found.ambiguous
            ? { note: `동명 시/군/구가 여러 시/도에 존재 — ${found.sido.name} ${found.sigungu.name}을 사용` }
            : {}),
        }
      }
    }
    return {
      ok: false,
      areaCode: null,
      areaName: null,
      sigunguCode: null,
      sigunguName: null,
      note: `시/도 미해석: "${sidoToken}"`,
    }
  }

  if (!sigunguToken) {
    return { ok: true, areaCode: sido.code, areaName: sido.name, sigunguCode: null, sigunguName: null }
  }

  const sigunguList = await fetchSigunguList(sido.code)
  const sigungu = matchArea(sigunguToken, sigunguList, SIGUNGU_SUFFIXES)
  if (!sigungu) {
    return {
      ok: true,
      areaCode: sido.code,
      areaName: sido.name,
      sigunguCode: null,
      sigunguName: null,
      note: `시/군/구 미해석: "${sigunguToken}" (시/도 단위로 조회)`,
    }
  }

  return {
    ok: true,
    areaCode: sido.code,
    areaName: sido.name,
    sigunguCode: sigungu.code,
    sigunguName: sigungu.name,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// searchFestival2 — PAST comparable festival search by region + type + season
// ─────────────────────────────────────────────────────────────────────────────

/** How far back to look for comparable past festivals. */
const PAST_WINDOW_YEARS = 2
/** How many ranked comparables to keep for the benchmark prompt. */
const MAX_RANKED_EVENTS = 8
/** Pool size fetched before ranking — wide enough for type/season filtering to matter. */
const SEARCH_POOL_ROWS = '100'

export type OfficialFestivalEvent = {
  title: string
  addr: string | null
  eventStartDate: string | null
  eventEndDate: string | null
  contentId: string | null
  /** True if the plan's 축제유형 keywords matched this event's title. */
  typeMatch: boolean
  /** Circular month distance (0=same month, 6=opposite season), or null if undated. */
  seasonalDistance: number | null
}

export type OfficialFestivalSearchResult =
  | {
      ok: true
      events: OfficialFestivalEvent[]
      areaName: string | null
      sigunguName: string | null
      windowStart: string
      windowEnd: string
      /** True when the sigungu-scoped query returned nothing and results are from the wider 시/도 instead. */
      fallbackUsed: boolean
      note?: string
    }
  | { ok: false; error: string; areaName?: string | null; sigunguName?: string | null }

/** 'YYYY-MM-DD' or 'YYYYMMDD' → month 1-12, or null if unparseable. */
function extractMonth(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null
  const digits = dateStr.replace(/-/g, '')
  if (digits.length < 6) return null
  const m = parseInt(digits.slice(4, 6), 10)
  return m >= 1 && m <= 12 ? m : null
}

/** Circular distance between two calendar months (1-12), range 0-6. */
function monthDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 12
  return Math.min(diff, 12 - diff)
}

function ymd(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

/** [eventStartDate, eventEndDate] for the past PAST_WINDOW_YEARS up to today, YYYYMMDD. */
function pastComparableWindow(): { start: string; end: string } {
  const now = new Date()
  const past = new Date(now)
  past.setUTCFullYear(now.getUTCFullYear() - PAST_WINDOW_YEARS)
  return { start: ymd(past), end: ymd(now) }
}

/** Splits free-text 축제유형 (e.g. "체험·미디어아트·먹거리") into matchable keywords. */
function festivalTypeKeywords(festivalType: string | undefined | null): string[] {
  if (!festivalType) return []
  return festivalType
    .split(/[·,\/\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2)
}

function titleMatchesAnyKeyword(title: string, keywords: string[]): boolean {
  if (keywords.length === 0) return false
  const t = title.toLowerCase()
  return keywords.some((kw) => t.includes(kw.toLowerCase()))
}

type SearchFestivalItem = {
  title?: unknown
  addr1?: unknown
  addr2?: unknown
  eventstartdate?: unknown
  eventenddate?: unknown
  contentid?: unknown
}

/** Raw searchFestival2 call + parse into candidates (no ranking yet). Never throws. */
async function fetchFestivalCandidates(
  query: Record<string, string>,
  keywords: string[],
  targetMonthStart: number | null,
  targetMonthEnd: number | null,
  pastCutoffYmd: string
): Promise<{ ok: true; rawItemCount: number; candidates: OfficialFestivalEvent[]; droppedFuture: number } | { ok: false; error: string }> {
  const r = await fetchKorService2<SearchFestivalItem>('searchFestival2', query)
  if (!r.ok) return { ok: false, error: r.error }

  const seen = new Set<string>()
  const candidates: OfficialFestivalEvent[] = []
  let droppedFuture = 0
  for (const it of r.data) {
    const title = str(it.title)
    if (!title) continue
    const contentId = str(it.contentid)
    const dedupeKey = contentId ?? title
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)

    const eventStartDate = str(it.eventstartdate)
    // TourAPI's eventStartDate query param is a LOWER bound only (see file-level
    // DESIGN NOTE) — passing eventEndDate too was empirically breaking results
    // (0 rows even where known-good data exists), so we no longer send it to the
    // API. Instead we filter the past-vs-future boundary here in code: keep only
    // events that have already STARTED as of today (genuinely "past", the thing
    // this connector is supposed to benchmark against), dropping future-dated
    // ones that a lower-bound-only query would otherwise include.
    const startDigits = eventStartDate?.replace(/-/g, '') ?? ''
    if (startDigits.length === 8 && startDigits > pastCutoffYmd) {
      droppedFuture++
      continue
    }

    const addrParts = [str(it.addr1), str(it.addr2)].filter(Boolean)
    const eventMonth = extractMonth(eventStartDate)
    const seasonalDistance =
      eventMonth === null || targetMonthStart === null
        ? null
        : Math.min(
            monthDistance(eventMonth, targetMonthStart),
            targetMonthEnd !== null ? monthDistance(eventMonth, targetMonthEnd) : Infinity
          )
    candidates.push({
      title,
      addr: addrParts.length > 0 ? addrParts.join(' ') : null,
      eventStartDate,
      eventEndDate: str(it.eventenddate),
      contentId,
      typeMatch: titleMatchesAnyKeyword(title, keywords),
      seasonalDistance,
    })
  }

  return { ok: true, rawItemCount: r.data.length, candidates, droppedFuture }
}

/** Type match first (strongest comparability signal), then closer season. */
function rankFestivalCandidates(candidates: OfficialFestivalEvent[]): OfficialFestivalEvent[] {
  return [...candidates].sort((a, b) => {
    if (a.typeMatch !== b.typeMatch) return a.typeMatch ? -1 : 1
    const aDist = a.seasonalDistance ?? 6
    const bDist = b.seasonalDistance ?? 6
    return aDist - bDist
  })
}

/**
 * PAST comparable-festival search for a region, ranked by festival-type
 * keyword overlap and seasonal (month) proximity to the plan's own dates.
 *
 * Resolves the region via resolveFestivalRegion first; a fully-unresolved
 * region returns ok:false (see resolveFestivalRegion doc). An empty result
 * after ranking is a VALID result (ok:true, events:[]) — "no comparable past
 * festival on record" is itself a meaningful signal for the benchmark stage,
 * not an error.
 *
 * If the sigungu-scoped query returns zero raw items, retries with the same
 * resolved areaCode and no sigunguCode (nationwide-safe — never hardcoded to
 * any specific region; see file-level DESIGN NOTE).
 *
 * `dateStart`/`dateEnd` here are the PLAN's own (future) dates — used ONLY to
 * derive the target month(s) for seasonal ranking, NEVER as the query window
 * (see file-level DESIGN NOTE for why querying the plan's future dates
 * directly against TourAPI is the wrong question).
 */
export async function searchFestivalOfficial(params: {
  region: string
  dateStart: string
  dateEnd?: string
  festivalType?: string
}): Promise<OfficialFestivalSearchResult> {
  const { region, dateStart, dateEnd, festivalType } = params

  const resolved = await resolveFestivalRegion(region)
  if (!resolved.ok) {
    return {
      ok: false,
      error: `지역명을 해석하지 못해 과거 유사 축제 목록을 조회하지 못했습니다: "${region}"${resolved.note ? ` (${resolved.note})` : ''}`,
    }
  }

  const { start: windowStart, end: windowEnd } = pastComparableWindow()
  const targetMonthStart = extractMonth(dateStart)
  const targetMonthEnd = extractMonth(dateEnd) ?? targetMonthStart
  const keywords = festivalTypeKeywords(festivalType)

  // NOTE: eventEndDate is deliberately NOT sent to the API — see the
  // fetchFestivalCandidates() comment for why. eventStartDate=windowStart is
  // a LOWER bound only; the upper (past-vs-future) boundary is enforced
  // client-side against windowEnd inside fetchFestivalCandidates().
  //
  // NOTE: `listYN` is NOT a valid searchFestival2 param — sending it caused
  // TourAPI to reject the request outright (resultCode=10,
  // INVALID_REQUEST_PARAMETER_ERROR(listYN)). `arrange` is also omitted:
  // this connector re-ranks by type/season match in code anyway
  // (rankFestivalCandidates), so upstream ordering doesn't matter.
  const baseQuery: Record<string, string> = {
    eventStartDate: windowStart,
    numOfRows: SEARCH_POOL_ROWS,
  }
  if (resolved.areaCode) baseQuery.areaCode = resolved.areaCode

  const sigunguQuery = resolved.sigunguCode ? { ...baseQuery, sigunguCode: resolved.sigunguCode } : baseQuery

  const first = await fetchFestivalCandidates(sigunguQuery, keywords, targetMonthStart, targetMonthEnd, windowEnd)
  if (!first.ok) {
    return { ok: false, error: first.error, areaName: resolved.areaName, sigunguName: resolved.sigunguName }
  }

  let candidates = first.candidates
  let fallbackUsed = false
  let scopeNote: string | undefined

  // Sigungu coverage varies by region nationwide — if the sigungu-scoped
  // query came back empty, retry at the wider 시/도 scope using the SAME
  // resolved areaCode (never a hardcoded region) before giving up.
  if (first.rawItemCount === 0 && resolved.sigunguCode) {
    const wider = await fetchFestivalCandidates(baseQuery, keywords, targetMonthStart, targetMonthEnd, windowEnd)
    if (wider.ok && wider.candidates.length > 0) {
      candidates = wider.candidates
      fallbackUsed = true
      scopeNote = `${resolved.sigunguName ?? region} 지역 데이터 없음 — ${resolved.areaName ?? '해당 시/도'} 전역으로 대체 조회`
    }
  }

  const ranked = rankFestivalCandidates(candidates)
  const events = ranked.slice(0, MAX_RANKED_EVENTS)

  const truncationNote =
    candidates.length > events.length
      ? `과거 ${PAST_WINDOW_YEARS}년 내 ${candidates.length}건 중 축제유형·계절 유사도 상위 ${events.length}건`
      : undefined

  const note = [scopeNote, truncationNote].filter(Boolean).join(' · ') || resolved.note

  return {
    ok: true,
    events,
    areaName: resolved.areaName,
    sigunguName: fallbackUsed ? null : resolved.sigunguName,
    windowStart,
    windowEnd,
    fallbackUsed,
    ...(note ? { note } : {}),
  }
}

/**
 * Renders an official search result as a [공식 데이터] tagged text block —
 * the single source of truth for that provenance tag, consumed directly by
 * the festival benchmark stage (lib/festival/pipeline.ts).
 */
export function formatOfficialFestivalsForPrompt(result: OfficialFestivalSearchResult): string {
  if (!result.ok) {
    return `[공식 데이터 — 한국관광공사 TourAPI] 조회 실패: ${result.error}`
  }

  // Region-agnostic scope label: sigungu-scoped scope when that query had
  // results; "{areaName} 전역" (whichever 시/도 was resolved — 제주, 경북,
  // 부산, ...) when the sigungu query was empty and we fell back wider.
  const scope = result.fallbackUsed
    ? `${result.areaName ?? '(지역 미확정)'} 전역`
    : [result.areaName, result.sigunguName].filter(Boolean).join(' ') || '(지역 미확정)'
  const scopeTag = result.fallbackUsed ? `[${result.areaName ?? '해당 지역'} 전역 유사 축제] ` : ''

  const fmtWindow = (ymdStr: string) =>
    ymdStr.length === 8 ? `${ymdStr.slice(0, 4)}-${ymdStr.slice(4, 6)}-${ymdStr.slice(6, 8)}` : ymdStr
  const windowLabel = `${fmtWindow(result.windowStart)}~${fmtWindow(result.windowEnd)}`

  if (result.events.length === 0) {
    return `[공식 데이터 — 한국관광공사 TourAPI] ${scopeTag}${scope}, 과거 ${windowLabel} 기간에 등록된 유사 축제/행사가 없습니다(searchFestival2 기준).${result.note ? ` (${result.note})` : ''}`
  }
  const lines = result.events.map((e) => {
    const tags = [
      e.typeMatch ? '유형일치' : null,
      e.seasonalDistance !== null && e.seasonalDistance <= 1 ? '계절일치' : null,
    ].filter(Boolean)
    const tagStr = tags.length > 0 ? ` [${tags.join('·')}]` : ''
    return `- ${e.title} (${e.eventStartDate ?? '?'}~${e.eventEndDate ?? '?'}${e.addr ? `, ${e.addr}` : ''})${tagStr}`
  })
  return [
    `[공식 데이터 — 한국관광공사 TourAPI] ${scopeTag}${scope}, 과거 ${windowLabel} 기간의 유사 축제/행사 (searchFestival2 기준, 축제유형·계절 유사도 순)${result.note ? ` — ${result.note}` : ''}:`,
    ...lines,
  ].join('\n')
}
