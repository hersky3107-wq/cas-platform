/**
 * scripts/tag-welfare.ts — batch job (manual, not part of app bundle).
 *
 * Ingests TWO welfare sources in one run, tags each with Claude, and upserts
 * into Supabase jeju_welfare_services:
 *   1. Jeju provincial welfare (region='jeju',     source='jeju-d01')
 *   2. Central-government welfare, filtered to elderly/disability/low-income
 *      relevance (region='national', source='national')
 *
 * Conflict target (region, source, seq) keeps the two sources from colliding.
 *
 * Run: npx tsx --env-file=.env.local scripts/tag-welfare.ts
 */

import { XMLParser } from 'fast-xml-parser'
import { createClient } from '@supabase/supabase-js'

// ── Config ────────────────────────────────────────────────────────────────────

const JEJU_API =
  'https://www.jeju.go.kr/rest/JejuWelfareServiceInfo/getJejuWelfareServiceInfoList'
const NATIONAL_LIST_API =
  'http://apis.data.go.kr/B554287/NationalWelfareInformationsV001/NationalWelfarelistV001'
const NATIONAL_DETAIL_API =
  'http://apis.data.go.kr/B554287/NationalWelfareInformationsV001/NationalWelfaredetailedV001'

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? ''
const KPX_KEY = process.env.KPX_SERVICE_KEY ?? ''
const MODEL = 'claude-sonnet-4-6'
const PAGE_SIZE = 100
const DELAY_MS = 200

// Central-gov relevance filter — keep only vulnerable/elderly-adjacent services.
const NATIONAL_KEEP_KEYWORDS = ['노년', '노인', '장애인', '저소득', '한부모', '기초생활', '차상위']

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

if (!ANTHROPIC_KEY) { console.error('ERROR: ANTHROPIC_API_KEY not set'); process.exit(1) }
if (!KPX_KEY) { console.error('ERROR: KPX_SERVICE_KEY not set'); process.exit(1) }
if (!SUPABASE_URL) { console.error('ERROR: NEXT_PUBLIC_SUPABASE_URL not set'); process.exit(1) }
if (!SUPABASE_SERVICE_ROLE_KEY) { console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY not set'); process.exit(1) }

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// ── Types ─────────────────────────────────────────────────────────────────────

/** Normalized record shared by both sources; feeds the common tag+upsert path. */
interface NormalizedRecord {
  region: string
  source: string
  seq: string
  name: string
  support: string // 지원대상
  contents: string // 지원내용
  application: string // 신청방법
  allLoc: boolean
  jejuLoc: boolean
  seogwipoLoc: boolean
  // extra AI context (not stored as columns) — populated for national records
  criteria?: string // 선정기준
  outline?: string // 개요
}

interface WelfareTag {
  target: string[]
  lifeCycle: string
  situation: string[]
  minAge: number | null
  isElderlyRelevant: boolean
  oneLineSummary: string
  // plain-language fields for elderly readers
  eligibilityPlain: string[]
  benefitPlain: string | null
  preparePlain: string[]
  applyWherePlain: string | null
}

interface SourceStats {
  label: string
  fetched: number
  filteredOut: number
  taggedOk: number
  tagFailed: number
  upserted: number
  elderlyCount: number
  failures: { seq: string; name: string; error: string }[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sep(title: string) {
  console.log('\n' + '═'.repeat(72))
  console.log(`  ${title}`)
  console.log('═'.repeat(72))
}

function stripHtml(html: unknown): string {
  if (typeof html !== 'string') return ''
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

function toBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') return v.toLowerCase() === 'true'
  return false
}

/** Coerce a fast-xml-parser value into an array of objects. */
function asArray(v: unknown): Record<string, unknown>[] {
  if (Array.isArray(v)) return v as Record<string, unknown>[]
  if (v && typeof v === 'object') return [v as Record<string, unknown>]
  return []
}

const FETCH_HEADERS = { 'User-Agent': 'Mozilla/5.0' }
const FETCH_MAX_ATTEMPTS = 4
const FETCH_RETRY_DELAY_MS = 2000

/** Fetch a welfare API URL; retry on network errors (e.g. ECONNRESET). */
async function fetchPageWithRetry(
  url: string,
  label: string | number
): Promise<{ ok: true; xml: string } | { ok: false; xml: string; status: number }> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= FETCH_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { headers: FETCH_HEADERS })
      const xml = await res.text()
      if (!res.ok) {
        return { ok: false, xml, status: res.status }
      }
      return { ok: true, xml }
    } catch (e) {
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

// ── XML parser (shared) ─────────────────────────────────────────────────────────

const parser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: true,
  isArray: (tag) =>
    ['list', 'servList', 'applmetList', 'inqplCtadrList'].includes(tag),
})

// ── Source 1: Jeju provincial welfare ──────────────────────────────────────────

async function fetchJejuRecords(): Promise<NormalizedRecord[]> {
  sep('SOURCE 1 (Jeju): Fetch ALL records (paginated)')

  const out: NormalizedRecord[] = []
  let pageNo = 1
  let totalExpected: number | null = null

  while (true) {
    const url = `${JEJU_API}?pageNo=${pageNo}&numOfRows=${PAGE_SIZE}`
    console.log(`  Fetching page ${pageNo}: ${url}`)

    let xml: string
    try {
      const result = await fetchPageWithRetry(url, `Jeju page ${pageNo}`)
      if (result.ok === false) {
        console.error(`  HTTP ${result.status} — aborting pagination`)
        break
      }
      xml = result.xml
    } catch (e) {
      console.error(`  Fetch error on page ${pageNo} after ${FETCH_MAX_ATTEMPTS} attempts:`, e)
      break
    }

    const parsed = parser.parse(xml) as Record<string, unknown>
    const root =
      (parsed?.jejunetApi as Record<string, unknown> | undefined) ??
      (parsed?.response as Record<string, unknown> | undefined) ??
      parsed

    if (totalExpected === null) {
      const query = root?.query as Record<string, unknown> | undefined
      const rows = query?.rows ?? (root?.totalCount as unknown)
      if (rows !== undefined && rows !== null) {
        totalExpected = Number(rows)
        console.log(`  Total records reported by API: ${totalExpected}`)
      }
    }

    const data = (root?.data as Record<string, unknown> | undefined) ?? root
    const rawItems = asArray(data?.list)

    if (rawItems.length === 0) {
      console.log(`  Page ${pageNo}: 0 items — done.`)
      break
    }
    console.log(`  Page ${pageNo}: ${rawItems.length} items`)

    for (const item of rawItems) {
      const str = (v: unknown) => stripHtml(v)
      out.push({
        region: 'jeju',
        source: 'jeju-d01',
        seq: String(item.seq ?? item.id ?? ''),
        name: str(item.name ?? item.n ?? item.servNm ?? ''),
        support: str(item.support ?? item.sprtCn ?? ''),
        contents: str(item.contents ?? item.servDgst ?? item.content ?? ''),
        application: str(item.application ?? item.aplyMtdCn ?? ''),
        allLoc: toBool(item.allLoc),
        jejuLoc: toBool(item.jejuLoc),
        seogwipoLoc: toBool(item.seogwipoLoc),
      })
    }

    if (rawItems.length < PAGE_SIZE) break
    if (totalExpected !== null && out.length >= totalExpected) break
    pageNo++
  }

  console.log(`\n  Total Jeju fetched: ${out.length} records`)
  return out
}

// ── Source 2: Central-government welfare ────────────────────────────────────────

/** Derive an integer seq from a servId like "WLF00000026" → "26"; hash if unparseable. */
function seqFromServId(servId: string): string {
  const digits = servId.match(/\d+/)
  if (digits) {
    const n = parseInt(digits[0], 10)
    if (Number.isFinite(n)) return String(n)
  }
  // Stable fallback hash
  let h = 0
  for (let i = 0; i < servId.length; i++) h = (h * 31 + servId.charCodeAt(i)) >>> 0
  return String(h)
}

function nationalPasses(item: Record<string, unknown>): boolean {
  const life = stripHtml(item.lifeArray).toLowerCase()
  const trgt = stripHtml(item.trgterIndvdlArray).toLowerCase()
  const hay = `${life} ${trgt}`
  return NATIONAL_KEEP_KEYWORDS.some((k) => hay.includes(k.toLowerCase()))
}

/** Join the applmet (신청방법) step array into one readable string. */
function joinApplmet(detail: Record<string, unknown>): string {
  const steps = asArray(detail.applmetList)
  const parts = steps
    .map((s) => stripHtml(s.servSeDetailLink ?? s.servSeDetailNm ?? ''))
    .filter((s) => s.length > 0)
  return parts.join(' / ')
}

/** Join the inqplCtadr (문의처) array into "name (contact)" pairs. */
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

async function fetchNationalRecords(): Promise<{ records: NormalizedRecord[]; total: number; filteredOut: number }> {
  sep('SOURCE 2 (National): Fetch list, filter, then fetch details')

  // ── Step A: paginate the list ────────────────────────────────────────────
  const rawItems: Record<string, unknown>[] = []
  let pageNo = 1
  let totalExpected: number | null = null

  while (true) {
    const url = `${NATIONAL_LIST_API}?serviceKey=${KPX_KEY}&callTp=L&pageNo=${pageNo}&numOfRows=${PAGE_SIZE}&srchKeyCode=003`
    console.log(`  Fetching list page ${pageNo}…`)

    let xml: string
    try {
      const result = await fetchPageWithRetry(url, `National list page ${pageNo}`)
      if (result.ok === false) {
        console.error(`  HTTP ${result.status} — aborting national list pagination`)
        break
      }
      xml = result.xml
    } catch (e) {
      console.error(`  National list fetch error on page ${pageNo}:`, e)
      break
    }

    const parsed = parser.parse(xml) as Record<string, unknown>
    const root = (parsed?.wantedList ?? parsed) as Record<string, unknown>

    if (totalExpected === null && root?.totalCount !== undefined) {
      totalExpected = Number(root.totalCount)
      console.log(`  Total national services reported: ${totalExpected}`)
    }

    const items = asArray(root?.servList)
    if (items.length === 0) {
      console.log(`  List page ${pageNo}: 0 items — done.`)
      break
    }
    console.log(`  List page ${pageNo}: ${items.length} items`)
    rawItems.push(...items)

    if (items.length < PAGE_SIZE) break
    if (totalExpected !== null && rawItems.length >= totalExpected) break
    pageNo++
  }

  const total = rawItems.length
  console.log(`\n  National list fetched: ${total} items`)

  // ── Step B: relevance filter ─────────────────────────────────────────────
  const kept = rawItems.filter(nationalPasses)
  const filteredOut = total - kept.length
  console.log(`  Relevance filter: ${kept.length} kept / ${filteredOut} dropped (of ${total})`)

  // ── Step C: detail fetch → normalized records ────────────────────────────
  const records: NormalizedRecord[] = []
  for (let i = 0; i < kept.length; i++) {
    const item = kept[i]!
    const servId = String(item.servId ?? '')
    const servNm = stripHtml(item.servNm ?? '')
    const label = `[${i + 1}/${kept.length}] ${servId}`

    if (!servId) {
      console.warn(`  ${label} ⚠ no servId — skipping`)
      continue
    }

    const url = `${NATIONAL_DETAIL_API}?serviceKey=${KPX_KEY}&callTp=D&servId=${servId}`
    let detailXml: string
    try {
      const result = await fetchPageWithRetry(url, `National detail ${servId}`)
      if (result.ok === false) {
        console.warn(`  ${label} ⚠ detail HTTP ${result.status} — storing list-only`)
        // Fall back to list-level data
        records.push({
          region: 'national',
          source: 'national',
          seq: seqFromServId(servId),
          name: servNm,
          support: stripHtml(item.trgterIndvdlArray ?? ''),
          contents: stripHtml(item.servDgst ?? ''),
          application: '',
          allLoc: false,
          jejuLoc: false,
          seogwipoLoc: false,
          outline: stripHtml(item.servDgst ?? ''),
        })
        if (i < kept.length - 1) await sleep(DELAY_MS)
        continue
      }
      detailXml = result.xml
    } catch (e) {
      console.warn(`  ${label} ⚠ detail fetch failed — storing list-only:`, e instanceof Error ? e.message : e)
      records.push({
        region: 'national',
        source: 'national',
        seq: seqFromServId(servId),
        name: servNm,
        support: stripHtml(item.trgterIndvdlArray ?? ''),
        contents: stripHtml(item.servDgst ?? ''),
        application: '',
        allLoc: false,
        jejuLoc: false,
        seogwipoLoc: false,
        outline: stripHtml(item.servDgst ?? ''),
      })
      if (i < kept.length - 1) await sleep(DELAY_MS)
      continue
    }

    const dParsed = parser.parse(detailXml) as Record<string, unknown>
    const dtl = (dParsed?.wantedDtl ?? dParsed) as Record<string, unknown>

    records.push({
      region: 'national',
      source: 'national',
      seq: seqFromServId(servId),
      name: stripHtml(dtl.servNm ?? servNm),
      support: stripHtml(dtl.tgtrDtlCn ?? item.trgterIndvdlArray ?? ''), // 지원대상
      contents: stripHtml(dtl.alwServCn ?? item.servDgst ?? ''), // 지원내용
      application: joinApplmet(dtl), // 신청방법 (joined array)
      allLoc: false,
      jejuLoc: false,
      seogwipoLoc: false,
      criteria: stripHtml(dtl.slctCritCn ?? ''), // 선정기준 (AI context)
      outline: stripHtml(dtl.wlfareInfoOutlCn ?? item.servDgst ?? ''), // 개요 (AI context)
    })

    console.log(`  ${label} "${trunc(servNm, 28)}" → detail OK`)
    if (i < kept.length - 1) await sleep(DELAY_MS)
  }

  console.log(`\n  National detailed records built: ${records.length}`)
  return { records, total, filteredOut }
}

// ── Shared: AI tagging ───────────────────────────────────────────────────────

const SYSTEM_PROMPT = `당신은 복지서비스 데이터 분류 전문가입니다.
사용자가 제공하는 복지서비스 텍스트를 읽고, 아래 JSON 스키마에 맞는 JSON만 출력하세요.
마크다운, 코드블록, 설명, 전처리 없이 순수 JSON만 반환하세요.
텍스트에 명시된 내용만 기반으로 추출하고, 없는 내용은 절대 만들어내지 마세요. 불확실하면 빈 배열/null을 사용하세요.

JSON 스키마:
{
  "target": string[],            // 해당되는 값: "노인" | "장애인" | "저소득" | "아동" | "청년" | "여성" | "임산부" | "다문화" | "한부모" | "일반"
  "lifeCycle": string,           // 하나만: "영유아" | "아동" | "청소년" | "청년" | "중장년" | "노년" | "전연령"
  "situation": string[],         // 해당되는 값: "일자리" | "의료비" | "돌봄" | "주거" | "출산" | "양육" | "생계" | "교육" | "문화여가" | "법률" | "안전"
  "minAge": number | null,       // 명시된 최소 연령 (없으면 null)
  "isElderlyRelevant": boolean,  // 노인(65세 이상)에게 직접 유관한 서비스이면 true
  "oneLineSummary": string,      // 어르신도 이해할 쉬운 말 한 문장 (50자 이내, 한국어)
  "eligibilityPlain": string[],  // [지원대상 텍스트에서] 누가 받을 수 있는지. 어르신이 이해할 짧은 문구 최대 4개. 예: "65세 이상", "혼자 사는 분", "기초연금 받는 분". 복합 조건은 항목 분리.
  "benefitPlain": string | null, // [서비스 설명 텍스트에서] 무엇을 얼마나 받는지 한 문장. 실제 금액/내용 포함. 예: "월 20만원 지원", "냉난방비 지원". 없으면 null.
  "preparePlain": string[],      // [신청방법 텍스트에서] 가져갈 서류 목록. 예: ["신분증", "통장 사본", "진단서"]. 서류 언급 없으면 빈 배열.
  "applyWherePlain": string | null // [신청방법 텍스트에서] 어디서 신청하는지 짧게. 예: "읍·면·동 주민센터", "제주시청 사회복지과". 전화번호가 있으면 뒤에 추가 예: "제주시니어클럽 (☎ 745-3998)". 없으면 null.
}`

async function tagOne(rec: NormalizedRecord): Promise<WelfareTag | null> {
  const userText = [
    `서비스명: ${rec.name}`,
    rec.support ? `지원대상: ${trunc(rec.support, 400)}` : null,
    rec.criteria ? `선정기준: ${trunc(rec.criteria, 300)}` : null,
    rec.contents ? `지원내용: ${trunc(rec.contents, 600)}` : null,
    rec.application ? `신청방법: ${trunc(rec.application, 300)}` : null,
    rec.outline ? `개요: ${trunc(rec.outline, 200)}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 700,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userText }],
    }),
  })

  const data = (await response.json()) as {
    content?: Array<{ type: string; text: string }>
    error?: { type: string; message: string }
  }

  if (data.error) {
    throw new Error(`Anthropic API error: ${data.error.type} — ${data.error.message}`)
  }

  const rawText = data.content?.find((b) => b.type === 'text')?.text ?? ''
  const jsonMatch = rawText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error(`No JSON in response: ${rawText.slice(0, 200)}`)

  return JSON.parse(jsonMatch[0]) as WelfareTag
}

// ── Shared: Upsert to Supabase ──────────────────────────────────────────────

async function upsertRecord(rec: NormalizedRecord, tag: WelfareTag | null) {
  const row = {
    region: rec.region,
    source: rec.source,
    seq: rec.seq,
    name: rec.name,
    support: rec.support,
    contents: rec.contents,
    application: rec.application,
    all_loc: rec.allLoc,
    jeju_loc: rec.jejuLoc,
    seogwipo_loc: rec.seogwipoLoc,
    // tag fields — null when tagging failed
    target: tag?.target ?? null,
    life_cycle: tag?.lifeCycle ?? null,
    situation: tag?.situation ?? null,
    min_age: tag?.minAge ?? null,
    is_elderly_relevant: tag?.isElderlyRelevant ?? null,
    one_line_summary: tag?.oneLineSummary ?? null,
    // plain-language fields
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

// ── Shared: tag + upsert a set of records ───────────────────────────────────

async function tagAndUpsertAll(
  records: NormalizedRecord[],
  label: string,
  extra: { total?: number; filteredOut?: number } = {}
): Promise<SourceStats> {
  sep(`${label}: Tag & upsert ${records.length} records`)

  const stats: SourceStats = {
    label,
    fetched: extra.total ?? records.length,
    filteredOut: extra.filteredOut ?? 0,
    taggedOk: 0,
    tagFailed: 0,
    upserted: 0,
    elderlyCount: 0,
    failures: [],
  }

  for (let i = 0; i < records.length; i++) {
    const rec = records[i]!
    const idx = `[${i + 1}/${records.length}]`

    let tag: WelfareTag | null = null
    try {
      tag = await tagOne(rec)
      stats.taggedOk++
      if (tag?.isElderlyRelevant) stats.elderlyCount++
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      stats.tagFailed++
      stats.failures.push({ seq: rec.seq, name: rec.name, error: msg })
      console.warn(`  ${idx} seq=${rec.seq} ⚠ TAG FAILED: ${msg}`)
    }

    try {
      await upsertRecord(rec, tag)
      stats.upserted++
      const status = tag
        ? `✓ [${tag.target.join('/')}]${tag.isElderlyRelevant ? ' 👴' : ''} | ${tag.benefitPlain ?? '(benefit?)'} | where: ${tag.applyWherePlain ?? '?'}`
        : '⚠ no tag (raw saved)'
      console.log(`  ${idx} seq=${rec.seq} "${trunc(rec.name, 28)}" → ${status}`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`  ${idx} seq=${rec.seq} ✗ UPSERT FAILED: ${msg}`)
    }

    if (i < records.length - 1) await sleep(DELAY_MS)
  }

  return stats
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const t0 = Date.now()

  // ── Source 1: Jeju (unchanged behavior) ──────────────────────────────────
  const jejuRecords = await fetchJejuRecords()
  let jejuStats: SourceStats | null = null
  if (jejuRecords.length === 0) {
    console.error('No Jeju records fetched — continuing to national.')
  } else {
    jejuStats = await tagAndUpsertAll(jejuRecords, 'SOURCE 1 (Jeju)')
  }

  // ── Source 2: National (filtered) ─────────────────────────────────────────
  let nationalStats: SourceStats | null = null
  try {
    const { records, total, filteredOut } = await fetchNationalRecords()
    if (records.length === 0) {
      console.error('No national records to tag (after filter/detail).')
    } else {
      nationalStats = await tagAndUpsertAll(records, 'SOURCE 2 (National)', { total, filteredOut })
    }
  } catch (e) {
    console.error('National ingestion failed:', e instanceof Error ? e.message : e)
  }

  // ── Combined summary ──────────────────────────────────────────────────────
  const elapsed = Date.now() - t0
  sep('FINAL SUMMARY')

  const printStats = (s: SourceStats | null, name: string) => {
    if (!s) { console.log(`\n${name}: (skipped / no records)`); return }
    console.log(`\n${name}`)
    if (s.filteredOut > 0 || s.fetched !== s.upserted) {
      console.log(`  Fetched (list):       ${s.fetched}`)
      if (s.filteredOut > 0) console.log(`  Filtered out:         ${s.filteredOut}`)
    }
    console.log(`  Tagged OK:            ${s.taggedOk}`)
    console.log(`  Tag failures:         ${s.tagFailed}`)
    console.log(`  Upserted:             ${s.upserted}`)
    console.log(`  isElderlyRelevant:    ${s.elderlyCount}`)
    if (s.failures.length > 0) {
      console.log(`  Failed records:`)
      for (const f of s.failures) console.log(`    seq=${f.seq} "${trunc(f.name, 30)}": ${f.error}`)
    }
  }

  printStats(jejuStats, 'JEJU (region=jeju, source=jeju-d01)')
  printStats(nationalStats, 'NATIONAL (region=national, source=national)')

  const totalUpserted = (jejuStats?.upserted ?? 0) + (nationalStats?.upserted ?? 0)
  const totalElderly = (jejuStats?.elderlyCount ?? 0) + (nationalStats?.elderlyCount ?? 0)
  console.log(`\nTOTAL upserted:         ${totalUpserted}`)
  console.log(`TOTAL elderly-relevant: ${totalElderly}`)
  console.log(`Elapsed:                ${(elapsed / 1000).toFixed(1)}s`)
  console.log('\nDone.\n')
}

main().catch((e) => {
  console.error('\nFATAL:', e)
  process.exit(1)
})
