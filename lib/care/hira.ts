/**
 * HIRA (심평원) connector — hospital & pharmacy basic info. National senior-care.
 *
 * Nationalized: callers pass a HIRA `sidoCd` (from the user's residence,
 * lib/care/residence) so search is scoped to the user's 시·도 nationwide.
 * Source: 건강보험심사평가원 병원정보서비스 / 약국정보서비스 (data.go.kr, XML).
 *
 * NOTE: these endpoints return FACTS only — name, address, phone, coords,
 * clinic type, sub-region. They do NOT include 진료과목(departments) or
 * 운영시간(hours). Those are filled separately (Perplexity / other sources).
 */

import { XMLParser } from 'fast-xml-parser'

const HOSP_URL = 'https://apis.data.go.kr/B551182/hospInfoServicev2/getHospBasisList'
const PHAR_URL = 'https://apis.data.go.kr/B551182/pharmacyInfoService/getParmacyBasisList'

/** Legacy region-key → HIRA sidoCd map (kept for back-compat callers). */
const REGION_SIDO: Record<string, string> = {
  jeju: '390000',
}

/** Fallback sidoCd when neither sidoCd nor a known region is supplied: 서울. */
const DEFAULT_SIDO = '110000'

const PARSER = new XMLParser({ ignoreAttributes: false, parseTagValue: true, isArray: () => false })

// ── Types ────────────────────────────────────────────────────────────────────

export interface MedicalFacility {
  name: string          // yadmNm
  addr: string          // addr
  tel: string | null    // telno
  lng: number | null    // XPos
  lat: number | null    // YPos
  type: string | null   // clCdNm (종별: 종합병원/병원/의원/약국…)
  sgguCdNm: string | null // 제주시 / 서귀포시
}

export interface SearchOptions {
  /** Free-text keyword — matches against name (and address). */
  query?: string
  /** Sub-region filter by HIRA sgguCdNm (e.g. '종로구'). */
  sgguCdNm?: string
  /** HIRA sidoCd (e.g. '110000'). Preferred — comes from the user's residence. */
  sidoCd?: string
  /**
   * HIRA sgguCd (시·군·구 코드, e.g. '110025' = 서울 금천구). When supplied, the
   * API itself narrows to that district: far fewer pages and results already
   * local to the user. Optional — omit it and the search stays 시·도-wide,
   * exactly as before.
   */
  sgguCd?: string
  /** Legacy region key (e.g. 'jeju'); used only if sidoCd is absent. */
  region?: string
  /** Max records to fetch from the API before filtering (default 1000). */
  fetchLimit?: number
  /** Max records to return after filtering (default 40). */
  limit?: number
}

/** Resolve the effective sidoCd from options (sidoCd > region map > default). */
function resolveSidoCd(opts: SearchOptions): string {
  if (opts.sidoCd && /^\d{6}$/.test(opts.sidoCd)) return opts.sidoCd
  if (opts.region && REGION_SIDO[opts.region]) return REGION_SIDO[opts.region]!
  return DEFAULT_SIDO
}

/**
 * The district code to send, or undefined to stay 시·도-wide. Malformed values
 * are dropped rather than forwarded — a bad sgguCd would make HIRA return an
 * empty set, which reads to the user as "no hospitals near you".
 */
function resolveSgguCd(opts: SearchOptions): string | undefined {
  return opts.sgguCd && /^\d{6}$/.test(opts.sgguCd) ? opts.sgguCd : undefined
}

// ── Fetch with retry (data.go.kr is flaky) ─────────────────────────────────────

async function fetchXmlWithRetry(url: string, params: URLSearchParams, attempts = 2): Promise<string> {
  let lastErr: unknown
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(`${url}?${params.toString()}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(12_000),
      })
      const text = await res.text()
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return text
    } catch (e) {
      lastErr = e
      if (i < attempts) await new Promise((r) => setTimeout(r, 2000))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('HIRA fetch failed')
}

/**
 * Parses one page: its rows AND the response-level `totalCount`. The count is
 * what lets us fan the remaining pages out in parallel instead of discovering
 * the end one sequential request at a time; null when the API omits it.
 */
function parsePage(xml: string): { rows: Record<string, unknown>[]; totalCount: number | null } {
  const parsed = PARSER.parse(xml) as Record<string, unknown>
  const body = (parsed?.response as Record<string, unknown>)?.body
  if (!body) return { rows: [], totalCount: null }
  const b = body as Record<string, unknown>
  const totalCount = toNum(b.totalCount)
  const items = b.items
  if (!items) return { rows: [], totalCount }
  const item = (items as Record<string, unknown>).item
  if (!item) return { rows: [], totalCount }
  const rows = Array.isArray(item)
    ? (item as Record<string, unknown>[])
    : [item as Record<string, unknown>]
  return { rows, totalCount }
}

function toNum(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function toStr(v: unknown): string {
  return v === undefined || v === null ? '' : String(v)
}

function normalize(row: Record<string, unknown>): MedicalFacility {
  return {
    name: toStr(row.yadmNm),
    addr: toStr(row.addr),
    tel: toStr(row.telno) || null,
    lng: toNum(row.XPos),
    lat: toNum(row.YPos),
    type: toStr(row.clCdNm) || null,
    sgguCdNm: toStr(row.sgguCdNm) || null,
  }
}

// ── Core fetch (paginated, parallel after page 1) ────────────────────────────

const PAGE_SIZE = 100
/** Hard safety cap on pages (1…50), unchanged from the original sequential loop. */
const MAX_PAGE = 50
/** Pages requested concurrently — enough to cut latency, gentle on a flaky API. */
const PAGE_BATCH = 5

/** One page of results. Throws on failure so the caller can skip just that page. */
async function fetchPage(params: {
  baseUrl: string
  serviceKey: string
  sidoCd: string
  pageNo: number
  sgguCd?: string
}): Promise<{ rows: Record<string, unknown>[]; totalCount: number | null }> {
  const qs = new URLSearchParams({
    serviceKey: params.serviceKey,
    sidoCd: params.sidoCd,
    pageNo: String(params.pageNo),
    numOfRows: String(PAGE_SIZE),
  })
  if (params.sgguCd) qs.set('sgguCd', params.sgguCd)
  return parsePage(await fetchXmlWithRetry(params.baseUrl, qs))
}

/**
 * Fetches up to `fetchLimit` records.
 *
 * Page 1 is fetched first for its `totalCount`, which tells us exactly how many
 * pages exist; pages 2…N then go out in parallel batches instead of one
 * blocking round-trip each. A page that fails is SKIPPED rather than aborting
 * the whole search — a partial list still answers "어느 병원에 가면 되나".
 *
 * `sgguCd` (optional) narrows the query to one 시·군·구 at the API level, which
 * usually collapses the whole thing to a single page.
 */
async function fetchAll(
  baseUrl: string,
  sidoCd: string,
  fetchLimit: number,
  sgguCd?: string
): Promise<MedicalFacility[]> {
  const serviceKey = process.env.KPX_SERVICE_KEY
  if (!serviceKey) throw new Error('KPX_SERVICE_KEY not configured')

  const first = await fetchPage({ baseUrl, serviceKey, sidoCd, pageNo: 1, sgguCd })
  const out: MedicalFacility[] = first.rows.map(normalize)

  // Nothing more to page through: empty result, a short (final) page, or we
  // already have everything the caller asked for.
  if (first.rows.length < PAGE_SIZE || out.length >= fetchLimit) {
    return out.slice(0, fetchLimit)
  }

  // totalCount is authoritative when present; without it, assume the caller's
  // limit is reachable and let MAX_PAGE bound the work.
  const available = first.totalCount ?? fetchLimit
  const lastPage = Math.min(Math.ceil(Math.min(fetchLimit, available) / PAGE_SIZE), MAX_PAGE)

  for (let start = 2; start <= lastPage; start += PAGE_BATCH) {
    const batch: number[] = []
    for (let p = start; p < start + PAGE_BATCH && p <= lastPage; p++) batch.push(p)

    const settled = await Promise.allSettled(
      batch.map((pageNo) => fetchPage({ baseUrl, serviceKey, sidoCd, pageNo, sgguCd }))
    )
    for (const s of settled) {
      if (s.status !== 'fulfilled') continue // skip the failed page, keep going
      out.push(...s.value.rows.map(normalize))
    }
    if (out.length >= fetchLimit) break
  }

  return out.slice(0, fetchLimit)
}

function applyFilters(list: MedicalFacility[], opts: SearchOptions): MedicalFacility[] {
  let out = list
  if (opts.sgguCdNm) {
    out = out.filter((f) => f.sgguCdNm === opts.sgguCdNm)
  }
  if (opts.query && opts.query.trim()) {
    const q = opts.query.trim().toLowerCase()
    out = out.filter(
      (f) => f.name.toLowerCase().includes(q) || f.addr.toLowerCase().includes(q)
    )
  }
  return out.slice(0, opts.limit ?? 40)
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function searchHospitals(opts: SearchOptions = {}): Promise<MedicalFacility[]> {
  const sidoCd = resolveSidoCd(opts)
  const list = await fetchAll(HOSP_URL, sidoCd, opts.fetchLimit ?? 1000, resolveSgguCd(opts))
  return applyFilters(list, opts)
}

export async function searchPharmacies(opts: SearchOptions = {}): Promise<MedicalFacility[]> {
  const sidoCd = resolveSidoCd(opts)
  const list = await fetchAll(PHAR_URL, sidoCd, opts.fetchLimit ?? 1000, resolveSgguCd(opts))
  return applyFilters(list, opts)
}
