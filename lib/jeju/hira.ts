/**
 * HIRA (심평원) connector — hospital & pharmacy basic info.
 *
 * Region-agnostic (like welfare.ts): defaults to Jeju (sidoCd=390000).
 * Source: 건강보험심사평가원 병원정보서비스 / 약국정보서비스 (data.go.kr, XML).
 *
 * NOTE: these endpoints return FACTS only — name, address, phone, coords,
 * clinic type, sub-region. They do NOT include 진료과목(departments) or
 * 운영시간(hours). Those are filled separately (Perplexity / other sources).
 */

import { XMLParser } from 'fast-xml-parser'

const HOSP_URL = 'https://apis.data.go.kr/B551182/hospInfoServicev2/getHospBasisList'
const PHAR_URL = 'https://apis.data.go.kr/B551182/pharmacyInfoService/getParmacyBasisList'

/** Map region key → HIRA sidoCd. Jeju = 390000 (verified). */
const REGION_SIDO: Record<string, string> = {
  jeju: '390000',
}

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
  /** Sub-region filter, e.g. '제주시' or '서귀포시'. */
  sgguCdNm?: string
  /** Region key (default 'jeju'). */
  region?: string
  /** Max records to fetch from the API before filtering (default 1000). */
  fetchLimit?: number
  /** Max records to return after filtering (default 40). */
  limit?: number
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

function parseItems(xml: string): Record<string, unknown>[] {
  const parsed = PARSER.parse(xml) as Record<string, unknown>
  const body = (parsed?.response as Record<string, unknown>)?.body
  if (!body) return []
  const items = (body as Record<string, unknown>).items
  if (!items) return []
  const item = (items as Record<string, unknown>).item
  if (!item) return []
  return Array.isArray(item) ? (item as Record<string, unknown>[]) : [item as Record<string, unknown>]
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

// ── Core fetch (paginated) ───────────────────────────────────────────────────

async function fetchAll(baseUrl: string, sidoCd: string, fetchLimit: number): Promise<MedicalFacility[]> {
  const serviceKey = process.env.KPX_SERVICE_KEY
  if (!serviceKey) throw new Error('KPX_SERVICE_KEY not configured')

  const pageSize = 100
  const out: MedicalFacility[] = []
  let pageNo = 1

  while (out.length < fetchLimit) {
    const params = new URLSearchParams({
      serviceKey,
      sidoCd,
      pageNo: String(pageNo),
      numOfRows: String(pageSize),
    })
    const xml = await fetchXmlWithRetry(baseUrl, params)
    const rows = parseItems(xml)
    if (rows.length === 0) break
    out.push(...rows.map(normalize))
    if (rows.length < pageSize) break
    pageNo++
    if (pageNo > 50) break // hard safety cap
  }
  return out
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
  const region = opts.region ?? 'jeju'
  const sidoCd = REGION_SIDO[region] ?? REGION_SIDO.jeju!
  const list = await fetchAll(HOSP_URL, sidoCd, opts.fetchLimit ?? 1000)
  return applyFilters(list, opts)
}

export async function searchPharmacies(opts: SearchOptions = {}): Promise<MedicalFacility[]> {
  const region = opts.region ?? 'jeju'
  const sidoCd = REGION_SIDO[region] ?? REGION_SIDO.jeju!
  const list = await fetchAll(PHAR_URL, sidoCd, opts.fetchLimit ?? 1000)
  return applyFilters(list, opts)
}
