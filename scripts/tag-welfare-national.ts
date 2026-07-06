/**
 * scripts/tag-welfare-national.ts — nationwide local-government welfare tagger.
 *
 * Ingests the 지자체복지서비스 dataset (all 17 시·도, ~4,683 records), AI-tags each
 * with the SAME schema + plain-language extraction as scripts/tag-welfare.ts, and
 * upserts into the SAME table jeju_welfare_services with:
 *   region = residence region slug (seoul / busan / … / jeju — from
 *            lib/care/residence.sidoNameToRegionKey, so a user's residence resolves
 *            to exactly these rows)
 *   source = 'local-national'
 *   seq    = numeric part of servId (conflict target: region, source, seq)
 *
 * Data source:
 *   list   https://apis.data.go.kr/B554287/LocalGovernmentWelfareInformations/LcgvWelfarelist
 *   detail https://apis.data.go.kr/B554287/LocalGovernmentWelfareInformations/LcgvWelfaredetailed
 *   (XML, <wantedList><servList>, filterable by ctpvNm=시도, KPX_SERVICE_KEY)
 *
 * Default mode is LIST-ONLY (no per-record detail fetch) — uses list fields
 * (servDgst, 대상/생애주기, 담당부서, servNm, etc.) for AI tagging. List pagination
 * is ~50 data.go.kr calls total, well under the dev daily cap. 준비물/연락처 get
 * sensible defaults; Perplexity can enrich at view-time later.
 *
 * Optional --with-detail fetches LcgvWelfaredetailed per servId (for future use with
 * a higher-traffic operating account; subject to ~1,000 detail calls/day on dev keys).
 *
 * Resumable: existing (region, source='local-national', seq) rows are loaded up
 * front and skipped. With default --concurrency=6, full run (~4,683 records) ≈ 1–2 h.
 *
 * Does NOT modify Jeju originals (app/jeju, lib/jeju, scripts/tag-welfare.ts).
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/tag-welfare-national.ts
 *   npx tsx --env-file=.env.local scripts/tag-welfare-national.ts --concurrency=8
 *   npx tsx --env-file=.env.local scripts/tag-welfare-national.ts --with-detail
 *   npx tsx --env-file=.env.local scripts/tag-welfare-national.ts --sido=경기도
 *   npx tsx --env-file=.env.local scripts/tag-welfare-national.ts --retag
 */

import { XMLParser } from 'fast-xml-parser'
import { createClient } from '@supabase/supabase-js'
import { sidoNameToRegionKey } from '@/lib/care/residence'

// ── Config ────────────────────────────────────────────────────────────────────

const LIST_API =
  'https://apis.data.go.kr/B554287/LocalGovernmentWelfareInformations/LcgvWelfarelist'
const DETAIL_API =
  'https://apis.data.go.kr/B554287/LocalGovernmentWelfareInformations/LcgvWelfaredetailed'

const SOURCE = 'local-national'
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? ''
const KPX_KEY = process.env.KPX_SERVICE_KEY ?? ''
const MODEL = 'claude-sonnet-4-6'
const PAGE_SIZE = 100
const DELAY_MS = 200
const DEFAULT_CONCURRENCY = 6

/** List-only defaults when detail API is off (준비물/연락처 enriched at view-time later). */
const LIST_ONLY_PREPARE: string[] = ['신분증 등 기본 서류']
const LIST_ONLY_APPLY_WHERE = '가까운 읍·면·동 행정복지센터(주민센터)에 문의하세요'

/** Shared abort flag when data.go.kr daily traffic cap is hit. */
class TrafficLimitError extends Error {
  constructor(message = 'data.go.kr traffic limit') {
    super(message)
    this.name = 'TrafficLimitError'
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

if (!ANTHROPIC_KEY) { console.error('ERROR: ANTHROPIC_API_KEY not set'); process.exit(1) }
if (!KPX_KEY) { console.error('ERROR: KPX_SERVICE_KEY not set'); process.exit(1) }
if (!SUPABASE_URL) { console.error('ERROR: NEXT_PUBLIC_SUPABASE_URL not set'); process.exit(1) }
if (!SUPABASE_SERVICE_ROLE_KEY) { console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY not set'); process.exit(1) }

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// ── CLI args ──────────────────────────────────────────────────────────────────

interface Args {
  sido: string | null
  max: number | null
  retag: boolean
  withDetail: boolean
  concurrency: number
}

function parseArgs(): Args {
  const out: Args = {
    sido: null,
    max: null,
    retag: false,
    withDetail: false,
    concurrency: DEFAULT_CONCURRENCY,
  }
  for (const raw of process.argv.slice(2)) {
    if (raw.startsWith('--sido=')) out.sido = raw.slice('--sido='.length).trim() || null
    else if (raw.startsWith('--max=')) {
      const n = parseInt(raw.slice('--max='.length), 10)
      if (Number.isFinite(n) && n > 0) out.max = n
    } else if (raw.startsWith('--concurrency=')) {
      const n = parseInt(raw.slice('--concurrency='.length), 10)
      if (Number.isFinite(n) && n >= 1 && n <= 32) out.concurrency = n
    } else if (raw === '--retag') out.retag = true
    else if (raw === '--with-detail') out.withDetail = true
    else if (raw === '--skip-detail') {
      console.warn('  (--skip-detail is deprecated; list-only is now the default. Use --with-detail to enable detail fetch.)')
    }
  }
  return out
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface NormalizedRecord {
  region: string
  source: string
  seq: string
  servId: string
  ctpvNm: string
  sggNm: string
  name: string
  support: string // 지원대상
  contents: string // 지원내용
  application: string // 신청방법 (merged for storage)
  criteria?: string // 선정기준
  outline?: string // 개요
  aplyMtdCn?: string // 신청방법/기한 원문 (often embeds 연락처·제출서류)
  contactStructured?: string // inqplCtadrList (often empty)
  prepareDocs?: string // basfrmList (often empty)
}

interface WelfareTag {
  target: string[]
  lifeCycle: string
  situation: string[]
  minAge: number | null
  isElderlyRelevant: boolean
  oneLineSummary: string
  eligibilityPlain: string[]
  benefitPlain: string | null
  preparePlain: string[]
  applyWherePlain: string | null
}

interface RegionStats {
  region: string
  ctpvNm: string
  total: number
  skipped: number
  taggedOk: number
  tagFailed: number
  upserted: number
  elderlyCount: number
}

// ── Helpers (mirrors tag-welfare.ts) ────────────────────────────────────────────

function sep(title: string) {
  console.log('\n' + '═'.repeat(72))
  console.log(`  ${title}`)
  console.log('═'.repeat(72))
}

function stripHtml(html: unknown): string {
  if (typeof html !== 'string') return html == null ? '' : String(html)
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&bull;/g, '•')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#xD;/g, '')
    .replace(/&[a-z#0-9]+;/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function trunc(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + '…' : s
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

function asArray(v: unknown): Record<string, unknown>[] {
  if (Array.isArray(v)) return v as Record<string, unknown>[]
  if (v && typeof v === 'object') return [v as Record<string, unknown>]
  return []
}

/** Derive an integer seq from a servId like "WLF00006549" → "6549"; hash fallback. */
function seqFromServId(servId: string): string {
  const digits = servId.match(/\d+/)
  if (digits) {
    const n = parseInt(digits[0], 10)
    if (Number.isFinite(n)) return String(n)
  }
  let h = 0
  for (let i = 0; i < servId.length; i++) h = (h * 31 + servId.charCodeAt(i)) >>> 0
  return String(h)
}

const FETCH_HEADERS = { 'User-Agent': 'Mozilla/5.0' }
const FETCH_MAX_ATTEMPTS = 4
const FETCH_RETRY_DELAY_MS = 2000

const TRAFFIC_LIMIT_PATTERNS = [
  /LIMITED_NUMBER_OF_SERVICE_REQUESTS/i,
  /OVER_REQUEST_LIMIT/i,
  /일일\s*(?:트래픽|호출|이용)\s*한도/i,
  /traffic\s*limit/i,
  /SERVICE_ACCESS_DENIED.*LIMIT/i,
]

function isTrafficLimitResponse(xml: string, status: number): boolean {
  if (status === 429) return true
  return TRAFFIC_LIMIT_PATTERNS.some((re) => re.test(xml))
}

async function fetchWithRetry(
  url: string,
  label: string
): Promise<{ ok: true; xml: string } | { ok: false; xml: string; status: number }> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= FETCH_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { headers: FETCH_HEADERS })
      const xml = await res.text()
      if (isTrafficLimitResponse(xml, res.status)) {
        throw new TrafficLimitError(`${label}: daily traffic cap (HTTP ${res.status})`)
      }
      if (!res.ok) return { ok: false, xml, status: res.status }
      return { ok: true, xml }
    } catch (e) {
      if (e instanceof TrafficLimitError) throw e
      lastErr = e
      if (attempt < FETCH_MAX_ATTEMPTS) {
        const msg = e instanceof Error ? e.message : String(e)
        console.warn(
          `  ${label} network error (attempt ${attempt}/${FETCH_MAX_ATTEMPTS}): ${msg}. Retrying in ${FETCH_RETRY_DELAY_MS / 1000}s...`
        )
        await sleep(FETCH_RETRY_DELAY_MS)
      }
    }
  }
  throw lastErr
}

/** Simple promise worker pool — at most `concurrency` tasks in flight. */
async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
  shouldStop: () => boolean
): Promise<void> {
  if (items.length === 0) return
  let next = 0

  async function runWorker() {
    while (!shouldStop()) {
      const i = next++
      if (i >= items.length) break
      await worker(items[i]!, i)
    }
  }

  const n = Math.min(concurrency, items.length)
  await Promise.all(Array.from({ length: n }, () => runWorker()))
}

// ── XML parser (shared) ─────────────────────────────────────────────────────────

const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: true,
  isArray: (tag) =>
    ['servList', 'applmetList', 'inqplCtadrList', 'basfrmList'].includes(tag),
})

function parseList(xml: string): { items: Record<string, unknown>[]; totalCount: number } {
  const parsed = parser.parse(xml) as Record<string, unknown>
  const root = (parsed?.wantedList ?? parsed) as Record<string, unknown>
  const totalCount = Number(root?.totalCount ?? 0)
  const items = asArray(root?.servList)
  return { items, totalCount }
}

// ── List: fetch all pages (optionally filtered by ctpvNm) ───────────────────────

async function fetchAllList(ctpvNm: string | null): Promise<Record<string, unknown>[]> {
  sep(`Fetch list${ctpvNm ? ` (ctpvNm=${ctpvNm})` : ' (nationwide)'}`)

  const out: Record<string, unknown>[] = []
  let pageNo = 1
  let totalExpected: number | null = null

  while (true) {
    const params = new URLSearchParams({
      serviceKey: KPX_KEY,
      callTp: 'L',
      pageNo: String(pageNo),
      numOfRows: String(PAGE_SIZE),
    })
    if (ctpvNm) params.set('ctpvNm', ctpvNm)
    const url = `${LIST_API}?${params}`

    let xml: string
    try {
      const r = await fetchWithRetry(url, `list page ${pageNo}`)
      if (r.ok === false) {
        console.error(`  HTTP ${r.status} on page ${pageNo} — aborting pagination`)
        break
      }
      xml = r.xml
    } catch (e) {
      if (e instanceof TrafficLimitError) throw e
      console.error(`  Fetch error on page ${pageNo}:`, e instanceof Error ? e.message : e)
      break
    }

    const { items, totalCount } = parseList(xml)
    if (totalExpected === null && totalCount > 0) {
      totalExpected = totalCount
      console.log(`  totalCount reported: ${totalExpected}`)
    }
    if (items.length === 0) {
      console.log(`  Page ${pageNo}: 0 items — done.`)
      break
    }
    console.log(`  Page ${pageNo}: ${items.length} items (running total ${out.length + items.length})`)
    out.push(...items)

    if (items.length < PAGE_SIZE) break
    if (totalExpected !== null && out.length >= totalExpected) break
    pageNo++
  }

  console.log(`\n  List fetched: ${out.length} records`)
  return out
}

// ── Detail: enrich a single record (if authorized) ──────────────────────────────

function joinApplmet(detail: Record<string, unknown>): string {
  const steps = asArray(detail.applmetList)
  const parts = steps
    .map((s) => stripHtml(s.servSeDetailLink ?? s.servSeDetailNm ?? ''))
    .filter((s) => s.length > 0)
  return parts.join(' / ')
}

function joinContacts(detail: Record<string, unknown>): string {
  const list = asArray(detail.inqplCtadrList)
  const parts = list
    .map((c) => {
      const nm = stripHtml(c.servSeDetailNm ?? '')
      const link = stripHtml(c.servSeDetailLink ?? '')
      if (nm && link && nm !== link) return `${nm} (${link})`
      return nm || link
    })
    .filter((s) => s.length > 0)
  return Array.from(new Set(parts)).join(', ')
}

function joinBasfrm(detail: Record<string, unknown>): string {
  const list = asArray(detail.basfrmList)
  const parts = list
    .map((b) => {
      const nm = stripHtml(b.servSeDetailNm ?? '')
      const link = stripHtml(b.servSeDetailLink ?? '')
      if (nm && link && nm !== link) return `${nm}: ${link}`
      return nm || link
    })
    .filter((s) => s.length > 0)
  return Array.from(new Set(parts)).join(', ')
}

/** Returns the detail root (<wantedDtl>) or null on HTTP / parse failure. Throws TrafficLimitError. */
async function fetchDetail(servId: string): Promise<Record<string, unknown> | null> {
  const params = new URLSearchParams({
    serviceKey: KPX_KEY,
    callTp: 'D',
    servId,
  })
  const url = `${DETAIL_API}?${params}`
  let r: Awaited<ReturnType<typeof fetchWithRetry>>
  try {
    r = await fetchWithRetry(url, `detail ${servId}`)
  } catch (e) {
    if (e instanceof TrafficLimitError) throw e
    return null
  }
  if (r.ok === false) return null
  const parsed = parser.parse(r.xml) as Record<string, unknown>
  return (parsed?.wantedDtl ?? parsed) as Record<string, unknown>
}

// ── Normalize a list item (with optional detail) → NormalizedRecord ─────────────

function normalizeListOnly(item: Record<string, unknown>, region: string): NormalizedRecord {
  const servId = String(item.servId ?? '')
  const support = [stripHtml(item.trgterIndvdlNmArray), stripHtml(item.lifeNmArray)]
    .filter(Boolean)
    .join(' / ')
  const application = [stripHtml(item.aplyMtdNm), stripHtml(item.bizChrDeptNm)]
    .filter(Boolean)
    .join(' / ')
  return {
    region,
    source: SOURCE,
    seq: seqFromServId(servId),
    servId,
    ctpvNm: stripHtml(item.ctpvNm),
    sggNm: stripHtml(item.sggNm),
    name: stripHtml(item.servNm),
    support,
    contents: stripHtml(item.servDgst),
    application,
    outline: stripHtml(item.servDgst),
  }
}

function mergeDetail(base: NormalizedRecord, dtl: Record<string, unknown>): NormalizedRecord {
  const contactStructured = joinContacts(dtl)
  const prepareDocs = joinBasfrm(dtl)
  const applmet = joinApplmet(dtl)
  const aplyMtdCn = stripHtml(dtl.aplyMtdCn)
  const support =
    stripHtml(dtl.sprtTrgtCn) || stripHtml(dtl.tgtrDtlCn) || base.support // 지원대상
  const applicationParts = [aplyMtdCn, applmet, contactStructured].filter(Boolean)
  return {
    ...base,
    name: stripHtml(dtl.servNm) || base.name,
    support,
    contents: stripHtml(dtl.alwServCn) || base.contents, // 지원내용
    application: applicationParts.join(' · ') || base.application,
    criteria: stripHtml(dtl.slctCritCn) || undefined, // 선정기준
    outline: stripHtml(dtl.wlfareInfoOutlCn) || base.outline, // 개요
    aplyMtdCn: aplyMtdCn || undefined,
    contactStructured: contactStructured || undefined,
    prepareDocs: prepareDocs || undefined,
  }
}

// ── AI tagging (schema + prompt copied from tag-welfare.ts) ──────────────────────

const LIST_ONLY_SYSTEM_PROMPT = `당신은 복지서비스 데이터 분류 전문가입니다.
사용자가 제공하는 복지서비스 텍스트(목록 API 요약 필드)를 읽고, 아래 JSON 스키마에 맞는 JSON만 출력하세요.
마크다운, 코드블록, 설명, 전처리 없이 순수 JSON만 반환하세요.
텍스트에 명시된 내용만 기반으로 추출하고, 없는 내용은 절대 만들어내지 마세요. 불확실하면 빈 배열/null을 사용하세요.

목록 API에는 구비서류·연락처 상세가 없습니다. preparePlain은 빈 배열 [], applyWherePlain은 null로 두세요 (앱에서 기본 안내를 표시합니다).

JSON 스키마:
{
  "target": string[],
  "lifeCycle": string,
  "situation": string[],
  "minAge": number | null,
  "isElderlyRelevant": boolean,
  "oneLineSummary": string,
  "eligibilityPlain": string[],
  "benefitPlain": string | null,
  "preparePlain": string[],
  "applyWherePlain": string | null
}`

const DETAIL_SYSTEM_PROMPT = `당신은 복지서비스 데이터 분류 전문가입니다.
사용자가 제공하는 복지서비스 텍스트를 읽고, 아래 JSON 스키마에 맞는 JSON만 출력하세요.
마크다운, 코드블록, 설명, 전처리 없이 순수 JSON만 반환하세요.
텍스트에 명시된 내용만 기반으로 추출하고, 없는 내용은 절대 만들어내지 마세요. 불확실하면 빈 배열/null을 사용하세요.

지자체 복지 API 특성: 문의처(inqplCtadrList)와 구비서류(basfrmList)가 비어 있는 경우가 많습니다.
이때 전화번호·제출서류는 "신청방법/기한(원문)" aplyMtdCn 긴 텍스트 안에 포함되어 있습니다.
- preparePlain: 구비서류(구조화)가 있으면 우선 사용. 없으면 aplyMtdCn에서 "제출서류", "구비서류", "필요서류" 등으로 나열된 항목을 추출.
- applyWherePlain: 접수처·담당부서·신청 장소를 짧게. 전화번호(연락처)가 aplyMtdCn이나 문의처에 있으면 반드시 포함. 예: "○○시청 사회복지과 (☎ 051-555-1389)". 없으면 null.

JSON 스키마:
{
  "target": string[],            // 해당되는 값: "노인" | "장애인" | "저소득" | "아동" | "청년" | "여성" | "임산부" | "다문화" | "한부모" | "일반"
  "lifeCycle": string,           // 하나만: "영유아" | "아동" | "청소년" | "청년" | "중장년" | "노년" | "전연령"
  "situation": string[],         // 해당되는 값: "일자리" | "의료비" | "돌봄" | "주거" | "출산" | "양육" | "생계" | "교육" | "문화여가" | "법률" | "안전"
  "minAge": number | null,       // 명시된 최소 연령 (없으면 null)
  "isElderlyRelevant": boolean,  // 노인(65세 이상)에게 직접 유관한 서비스이면 true
  "oneLineSummary": string,      // 어르신도 이해할 쉬운 말 한 문장 (50자 이내, 한국어)
  "eligibilityPlain": string[],  // [지원대상 텍스트에서] 누가 받을 수 있는지. 어르신이 이해할 짧은 문구 최대 4개. 예: "65세 이상", "혼자 사는 분", "기초연금 받는 분". 복합 조건은 항목 분리.
  "benefitPlain": string | null, // [지원내용 텍스트에서] 무엇을 얼마나 받는지 한 문장. 실제 금액/내용 포함. 예: "월 20만원 지원", "냉난방비 지원". 없으면 null.
  "preparePlain": string[],      // [구비서류 또는 aplyMtdCn] 가져갈 서류 목록. 예: ["신분증", "통장 사본", "진단서"]. 서류 언급 없으면 빈 배열.
  "applyWherePlain": string | null // [신청방법/aplyMtdCn/문의처] 어디서 신청·문의하는지 + 연락처(전화). 예: "읍·면·동 주민센터 (☎ 064-740-3998)". 없으면 null.
}`

function applyListOnlyFallbacks(tag: WelfareTag): WelfareTag {
  return {
    ...tag,
    preparePlain: LIST_ONLY_PREPARE,
    applyWherePlain: LIST_ONLY_APPLY_WHERE,
  }
}

async function tagOne(rec: NormalizedRecord, useDetail: boolean): Promise<WelfareTag> {
  const userText = [
    `서비스명: ${rec.name}`,
    rec.support ? `지원대상: ${trunc(rec.support, 400)}` : null,
    rec.criteria ? `선정기준: ${trunc(rec.criteria, 300)}` : null,
    rec.contents ? `지원내용: ${trunc(rec.contents, 600)}` : null,
    rec.aplyMtdCn ? `신청방법/기한(원문): ${trunc(rec.aplyMtdCn, 900)}` : null,
    rec.prepareDocs ? `구비서류(구조화): ${trunc(rec.prepareDocs, 300)}` : null,
    rec.contactStructured ? `문의처(구조화): ${trunc(rec.contactStructured, 200)}` : null,
    rec.application ? `신청방법(통합): ${trunc(rec.application, 400)}` : null,
    rec.outline ? `개요: ${trunc(rec.outline, 200)}` : null,
    `지역: ${rec.ctpvNm}${rec.sggNm ? ' ' + rec.sggNm : ''}`,
  ]
    .filter(Boolean)
    .join('\n')

  const body = JSON.stringify({
    model: MODEL,
    max_tokens: 700,
    system: useDetail ? DETAIL_SYSTEM_PROMPT : LIST_ONLY_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userText }],
  })

  for (let attempt = 1; attempt <= 4; attempt++) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body,
    })

    if (response.status === 429) {
      const wait = attempt * 8000
      console.warn(`  Anthropic rate limit — waiting ${wait / 1000}s (attempt ${attempt}/4)`)
      await sleep(wait)
      continue
    }

    const data = (await response.json()) as {
      content?: Array<{ type: string; text: string }>
      error?: { type: string; message: string }
    }

    if (data.error) {
      if (data.error.type === 'rate_limit_error' && attempt < 4) {
        const wait = attempt * 8000
        console.warn(`  Anthropic rate limit — waiting ${wait / 1000}s (attempt ${attempt}/4)`)
        await sleep(wait)
        continue
      }
      throw new Error(`Anthropic API error: ${data.error.type} — ${data.error.message}`)
    }

    const rawText = data.content?.find((b) => b.type === 'text')?.text ?? ''
    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error(`No JSON in response: ${rawText.slice(0, 200)}`)

    const tag = JSON.parse(jsonMatch[0]) as WelfareTag
    return useDetail ? tag : applyListOnlyFallbacks(tag)
  }

  throw new Error('Anthropic API rate limit — retries exhausted')
}

// ── Upsert ──────────────────────────────────────────────────────────────────────

async function upsertRecord(rec: NormalizedRecord, tag: WelfareTag | null) {
  const row = {
    region: rec.region,
    source: rec.source,
    seq: rec.seq,
    name: rec.name,
    support: rec.support,
    contents: rec.contents,
    application: rec.application,
    all_loc: false,
    jeju_loc: false,
    seogwipo_loc: false,
    target: tag?.target ?? null,
    life_cycle: tag?.lifeCycle ?? null,
    situation: tag?.situation ?? null,
    min_age: tag?.minAge ?? null,
    is_elderly_relevant: tag?.isElderlyRelevant ?? null,
    one_line_summary: tag?.oneLineSummary ?? null,
    eligibility_plain: tag?.eligibilityPlain ?? null,
    benefit_plain: tag?.benefitPlain ?? null,
    prepare_plain: tag?.preparePlain ?? null,
    apply_where_plain: tag?.applyWherePlain ?? null,
    tagged_at: tag ? new Date().toISOString() : null,
  }

  const { error } = await db
    .from('jeju_welfare_services')
    .upsert(row, { onConflict: 'region,source,seq' })

  if (error) throw new Error(`Supabase upsert error: ${error.message}`)
}

// ── Resumability: load existing (region, seq) for this source ────────────────────

async function loadExistingKeys(): Promise<Set<string>> {
  const keys = new Set<string>()
  const pageSize = 1000
  let from = 0
  while (true) {
    const { data, error } = await db
      .from('jeju_welfare_services')
      .select('region, seq')
      .eq('source', SOURCE)
      .range(from, from + pageSize - 1)
    if (error) {
      console.warn(`  (resume) could not load existing keys: ${error.message} — proceeding without skip`)
      break
    }
    const rows = (data ?? []) as { region: string; seq: string }[]
    for (const r of rows) keys.add(`${r.region}:${r.seq}`)
    if (rows.length < pageSize) break
    from += pageSize
  }
  return keys
}

interface ProcessOutcome {
  taggedOk: boolean
  tagFailed: boolean
  upserted: boolean
  elderly: boolean
}

async function processRecord(
  rec: NormalizedRecord,
  useDetail: boolean
): Promise<{ finalRec: NormalizedRecord; tag: WelfareTag | null; outcome: ProcessOutcome }> {
  await sleep(DELAY_MS)

  let finalRec = rec
  if (useDetail) {
    const dtl = await fetchDetail(rec.servId)
    if (dtl) {
      finalRec = mergeDetail(rec, dtl)
    }
    await sleep(DELAY_MS)
  }

  let tag: WelfareTag | null = null
  const outcome: ProcessOutcome = {
    taggedOk: false,
    tagFailed: false,
    upserted: false,
    elderly: false,
  }

  try {
    tag = await tagOne(finalRec, useDetail)
    outcome.taggedOk = true
    if (tag.isElderlyRelevant) outcome.elderly = true
  } catch {
    outcome.tagFailed = true
  }

  try {
    await upsertRecord(finalRec, tag)
    outcome.upserted = true
  } catch {
    // upsert failure counted via upserted staying false
  }

  await sleep(DELAY_MS)
  return { finalRec, tag, outcome }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs()
  const t0 = Date.now()

  sep('NATIONAL LOCAL-GOVERNMENT WELFARE TAGGER')
  console.log(`  Source key:  ${SOURCE}`)
  console.log(`  Filter 시도: ${args.sido ?? '(nationwide, all 17)'}`)
  console.log(`  Max records: ${args.max ?? '(no cap)'}`)
  console.log(`  Concurrency: ${args.concurrency}`)
  console.log(`  Detail mode: ${args.withDetail ? 'ON (--with-detail)' : 'OFF (list-only, default)'}`)
  console.log(`  Re-tag mode: ${args.retag ? 'ON (ignore existing)' : 'OFF (skip existing = resumable)'}`)

  // ── Step 1: fetch list ────────────────────────────────────────────────────
  let rawItems: Record<string, unknown>[]
  try {
    rawItems = await fetchAllList(args.sido)
  } catch (e) {
    if (e instanceof TrafficLimitError) {
      sep('일일 트래픽 한도 도달')
      console.log('\n  일일 트래픽 한도 도달 (list fetch) — 내일 이어서 실행하세요.\n')
      process.exit(0)
    }
    throw e
  }
  if (rawItems.length === 0) {
    console.error('No list records fetched. Aborting.')
    process.exit(1)
  }

  const useDetail = args.withDetail
  if (useDetail) {
    console.log('\n  ⚠ --with-detail: per-record detail fetch (subject to ~1,000/day data.go.kr cap).')
  } else {
    console.log('\n  List-only mode (default): servDgst / categories / 담당부서 — ~50 list API calls total.')
    console.log(`  Fallbacks: prepare_plain=${JSON.stringify(LIST_ONLY_PREPARE)}, apply_where="${LIST_ONLY_APPLY_WHERE}"`)
  }

  // ── Step 2: normalize + group by region ───────────────────────────────────
  const byRegion = new Map<string, NormalizedRecord[]>()
  const unknownSido = new Set<string>()
  for (const item of rawItems) {
    const ctpv = stripHtml(item.ctpvNm)
    const region = sidoNameToRegionKey(ctpv)
    if (!region) {
      unknownSido.add(ctpv)
      continue
    }
    const rec = normalizeListOnly(item, region)
    if (!rec.servId) continue
    const arr = byRegion.get(region) ?? []
    arr.push(rec)
    byRegion.set(region, arr)
  }
  if (unknownSido.size > 0) {
    console.warn(`\n  ⚠ Unmapped ctpvNm (skipped): ${[...unknownSido].join(', ')}`)
  }

  // ── Step 3: load existing for resume ──────────────────────────────────────
  const existing = args.retag ? new Set<string>() : await loadExistingKeys()
  console.log(`\n  Existing ${SOURCE} rows in table: ${existing.size}`)

  // ── Step 4: tag + upsert, region by region (concurrent pool per 시도) ───────
  const stats: RegionStats[] = []
  let globalProcessed = 0
  let stopEarly = false
  let trafficLimitHit = false
  let totalTaggedThisRun = 0

  const regionOrder = [...byRegion.keys()].sort()
  const allPending: NormalizedRecord[] = []
  for (const region of regionOrder) {
    const recs = byRegion.get(region)!
    for (const rec of recs) {
      if (!existing.has(`${rec.region}:${rec.seq}`)) allPending.push(rec)
    }
  }
  const totalToProcess =
    args.max !== null ? Math.min(allPending.length, args.max) : allPending.length

  const progress = {
    completed: 0,
    total: totalToProcess,
    currentSido: '',
    lastPrintAt: 0,
  }

  function printProgress(force = false) {
    const now = Date.now()
    if (!force && now - progress.lastPrintAt < 3000 && progress.completed % 25 !== 0) return
    progress.lastPrintAt = now
    console.log(
      `  ▶ ${progress.completed.toLocaleString()} / ${progress.total.toLocaleString()} tagged` +
        (progress.currentSido ? `, ${progress.currentSido} 진행중…` : '') +
        ` (${totalTaggedThisRun.toLocaleString()} ok this run)`
    )
  }

  function shouldStop() {
    return stopEarly || trafficLimitHit
  }

  for (const region of regionOrder) {
    if (shouldStop()) break
    const recs = byRegion.get(region)!
    const ctpvNm = recs[0]?.ctpvNm ?? region
    sep(`시도 ${ctpvNm} (${region}) — ${recs.length} records`)

    const rs: RegionStats = {
      region, ctpvNm, total: recs.length, skipped: 0,
      taggedOk: 0, tagFailed: 0, upserted: 0, elderlyCount: 0,
    }

    const pending: NormalizedRecord[] = []
    for (const rec of recs) {
      const key = `${rec.region}:${rec.seq}`
      if (existing.has(key)) {
        rs.skipped++
        continue
      }
      pending.push(rec)
    }

    if (pending.length === 0) {
      console.log(`  (all ${recs.length} already tagged — skipping)`)
      stats.push(rs)
      continue
    }

    progress.currentSido = ctpvNm
    printProgress(true)

    let regionProcessed = 0
    await runPool(
      pending,
      args.concurrency,
      async (rec) => {
        if (shouldStop()) return
        if (args.max !== null && globalProcessed >= args.max) {
          stopEarly = true
          return
        }

        try {
          const { finalRec, tag, outcome } = await processRecord(rec, useDetail)
          if (outcome.taggedOk) {
            rs.taggedOk++
            totalTaggedThisRun++
          }
          if (outcome.tagFailed) rs.tagFailed++
          if (outcome.upserted) rs.upserted++
          if (outcome.elderly) rs.elderlyCount++

          progress.completed++
          globalProcessed++
          regionProcessed++
          printProgress()

          if (regionProcessed <= 3 || regionProcessed % 50 === 0) {
            const status = tag
              ? `✓ [${tag.target.join('/')}]${tag.isElderlyRelevant ? ' 👴' : ''} | ${tag.benefitPlain ?? '(benefit?)'}`
              : '⚠ no tag (raw saved)'
            console.log(`  seq=${finalRec.seq} "${trunc(finalRec.name, 26)}" → ${status}`)
          }
        } catch (e) {
          if (e instanceof TrafficLimitError) {
            trafficLimitHit = true
            return
          }
          rs.tagFailed++
          progress.completed++
          globalProcessed++
          regionProcessed++
          printProgress()
          console.warn(
            `  seq=${rec.seq} ⚠ FAILED: ${e instanceof Error ? e.message : e}`
          )
        }
      },
      shouldStop
    )

    if (trafficLimitHit) {
      sep('일일 트래픽 한도 도달')
      console.log(
        `\n  일일 트래픽 한도 도달 — 지금까지 ${totalTaggedThisRun.toLocaleString()}개 태깅됨, 내일 이어서 실행하세요.`
      )
      console.log('  (Resumable: re-run the same command to continue where it left off.)\n')
      stats.push(rs)
      break
    }

    if (args.max !== null && globalProcessed >= args.max) {
      console.log(`  Reached --max=${args.max}. Stopping.`)
      stopEarly = true
    }

    console.log(
      `  → ${ctpvNm}: upserted ${rs.upserted}, skipped ${rs.skipped}, tag-failed ${rs.tagFailed}, elderly ${rs.elderlyCount}`
    )
    stats.push(rs)
  }

  // ── Final summary ─────────────────────────────────────────────────────────
  const elapsed = Date.now() - t0
  sep('FINAL SUMMARY')
  console.log(`\n  시도                        total  skip  tagOK  tagFail  upsert  elderly`)
  console.log('  ' + '─'.repeat(72))
  let tTotal = 0, tSkip = 0, tOk = 0, tFail = 0, tUp = 0, tEld = 0
  for (const s of stats) {
    console.log(
      `  ${s.ctpvNm.padEnd(24)} ${String(s.total).padStart(5)} ${String(s.skipped).padStart(5)} ` +
      `${String(s.taggedOk).padStart(6)} ${String(s.tagFailed).padStart(7)} ${String(s.upserted).padStart(7)} ${String(s.elderlyCount).padStart(8)}`
    )
    tTotal += s.total; tSkip += s.skipped; tOk += s.taggedOk; tFail += s.tagFailed; tUp += s.upserted; tEld += s.elderlyCount
  }
  console.log('  ' + '─'.repeat(72))
  console.log(
    `  ${'TOTAL'.padEnd(24)} ${String(tTotal).padStart(5)} ${String(tSkip).padStart(5)} ` +
    `${String(tOk).padStart(6)} ${String(tFail).padStart(7)} ${String(tUp).padStart(7)} ${String(tEld).padStart(8)}`
  )
  console.log(`\n  Mode:         ${useDetail ? 'detail (--with-detail)' : 'list-only (default)'}`)
  console.log(`  Concurrency:  ${args.concurrency}`)
  console.log(`  List API:     ~${Math.ceil(rawItems.length / PAGE_SIZE)} pages (~${Math.ceil(rawItems.length / PAGE_SIZE)} calls)`)
  if (trafficLimitHit) {
    console.log(`  Stopped:      data.go.kr daily traffic limit (${totalTaggedThisRun.toLocaleString()} tagged this run)`)
  }
  console.log(`  Elapsed:      ${(elapsed / 1000 / 60).toFixed(1)} min`)
  if (!trafficLimitHit) {
    console.log('\nDone. Re-run the same command to continue where it left off.\n')
  }
}

main().catch((e) => {
  console.error('\nFATAL:', e instanceof Error ? e.message : e)
  process.exit(1)
})
