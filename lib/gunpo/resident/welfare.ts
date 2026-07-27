import 'server-only'

/**
 * SHARED Gunpo 복지·행정 (welfare / administration) layer — 시민(resident) mode.
 * Cloned from lib/jeju/welfare.ts. Consumed by:
 *   GET  /api/gunpo/resident/welfare              → deadline-soon 공고 (cached per KST day)
 *   POST /api/gunpo/resident/welfare/match        → user-condition subsidy match (NOT cached)
 *   GET  /api/gunpo/resident/welfare/guide?topic= → admin how-to guide (cached per topic/day)
 *
 * Sources:
 *   a. 보조금24 OpenAPI (행안부, dataset 15113968) via odcloud gateway
 *        api.odcloud.kr/api/gov24/v3/serviceList — 공공서비스(혜택) 목록. National
 *        dataset with no clean region field — see REGION_KEYWORDS below for how
 *        Gunpo-relevance is decided.
 *   b. Perplexity — CURRENT 군포시 공고 (군포시청 + 경기도청 산본/금정 권역).
 *
 * ANTI-HALLUCINATION + DATE SAFETY (welfare errors cause real harm):
 *   - AI may ONLY filter/explain REAL items (보조금24 or Perplexity). No item
 *     without a source (기관명 or url) is surfaced.
 *   - CODE-level deadline filter: parse 신청기한; DROP deadline < today (KST).
 *     Never trust the AI to judge dates.
 *   - Perplexity items carry contextMeta + "정확한 내용은 소관기관에 확인하세요".
 *   - Eligibility is never asserted as fact → "해당 가능성 있음, 기관 확인 필요".
 *
 * ISOLATION: 'server-only'; sessionId/userId null for AI; cache via
 * supabaseAdmin (gunpo_welfare_cache — degrades to no-cache if table missing).
 * MUST NOT import lib/jeju or lib/motie. Never throws.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { runSingleAiProvider, type ExtendedAiProviderName } from '@/lib/ai/router'
import { supabaseAdmin } from '@/lib/supabase/server'
import {
  cleanPerplexityText,
  extractAsOf,
  extractJsonObject,
  kstNowIso,
  kstTodayIso,
  strOrNull,
  type ContextMeta,
} from './shared'

// ── Constants ─────────────────────────────────────────────────────────────────

const GOV24_BASE = 'https://api.odcloud.kr/api/gov24/v3'
const TIMEOUT_MS = 15_000
const RETRY_DELAY_MS = 500
const PERPLEXITY_TIMEOUT_MS = 20_000
const BODY_SNIPPET = 300
const PERPLEXITY_PROVIDER: ExtendedAiProviderName = 'perplexity'
const MATCH_MAX_TOKENS = 2600
const GUIDE_MAX_TOKENS = 1400
/** deadline-soon window (today → +N days). */
const SOON_DAYS = 30
const FRESHNESS_NOTE = '보조금24 + 군포시청 공고 검색 기반 (마감 안 지난 것만)'
const DISCLAIMER =
  '정확한 자격·금액·기한은 반드시 소관기관에 확인하세요. 이 안내는 참고용이며 실제 지원 여부와 다를 수 있어요.'
const CONFIRM_NOTE = '정확한 내용은 소관기관에 확인하세요.'

/**
 * 보조금24 지역 텍스트 필터. odcloud gov24 dataset은 깨끗한 지역 필드가 없으므로,
 * "군포 관련 키워드가 있으면 통과 / 다른 특정 시·군 키워드가 있으면 제외 / 둘 다
 * 없으면(=전국 공통 사업) 통과"로 판단한다. 완전 지역코드 필터가 아니라 텍스트
 * 매칭이라 상위 몇 개 오탐/누락은 있을 수 있음 — Perplexity 공고 쪽이 실제 지역
 * 소스다.
 */
export const REGION_KEYWORDS = ['군포', '산본', '금정'] as const
const OTHER_CITY_HINTS = [
  '제주',
  '서귀포',
  '부산',
  '대구',
  '인천',
  '광주',
  '대전',
  '울산',
  '수원',
  '성남',
  '고양',
  '용인',
  '창원',
  '청주',
  '전주',
  '천안',
] as const

function matchesGunpoOrNational(text: string): boolean {
  if (REGION_KEYWORDS.some((k) => text.includes(k))) return true
  if (OTHER_CITY_HINTS.some((k) => text.includes(k))) return false
  return true
}

/** Fixed admin how-to topics (button-driven) — generic, not region-specific. */
export const GUIDE_TOPICS = [
  '전입신고',
  '종량제봉투 구입',
  '자동차 등록',
  '건축 신고',
  '출생신고',
  '사망신고',
  '주민등록등본 발급',
  '대형폐기물 신고',
  '전월세 신고',
  '여권 발급',
] as const

export type GuideTopic = (typeof GUIDE_TOPICS)[number]

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SubsidyItem {
  name: string
  org: string | null
  target: string | null
  deadline: string | null // YYYY-MM-DD or free text like '상시'
  how: string | null
  url: string | null
  source: '보조금24' | '검색'
  asOf: string | null
  note: string | null
  /** parsed deadline for sorting; null = 상시/미정 (kept, sorts last) */
  deadlineDate: string | null
}

export interface MatchResult {
  ok: boolean
  matches: SubsidyItem[]
  contextMeta: ContextMeta | null
  disclaimer: string
  errors: string[]
}

export interface WelfarePayload {
  ok: true
  deadlineSoon: SubsidyItem[]
  windowDays: number
  today: string
  contextMeta: ContextMeta | null
  disclaimer: string
  freshnessNote: string
  updatedAt: string
  errors: string[]
  fromCache: boolean
}

export type WelfareResult = WelfarePayload | { ok: false; error: string }

export interface GuideStep {
  step: number
  text: string
}

export interface GuideResult {
  ok: boolean
  topic: string
  intro: string
  steps: GuideStep[]
  documents: string[]
  where: string | null
  contextMeta: ContextMeta | null
  disclaimer: string
  errors: string[]
  fromCache: boolean
}

export interface MatchInput {
  age?: number | null
  job?: string | null
  situation?: string | null
  household?: string | null
}

// ── In-process race guards ─────────────────────────────────────────────────────

const welfareInflight = new Map<string, Promise<WelfarePayload>>()
const guideInflight = new Map<string, Promise<GuideResult>>()

// ── Helpers ───────────────────────────────────────────────────────────────────

function serviceKey(): string {
  return process.env.DATA_GO_KR_KEY ?? process.env.KPX_SERVICE_KEY ?? ''
}

function noDbSupabase(): SupabaseClient {
  return createClient('http://localhost', 'gunpo-welfare-no-db') as unknown as SupabaseClient
}

function redact(url: string): string {
  return url.replace(/serviceKey=[^&]+/i, 'serviceKey=***')
}

function bodySnippet(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, BODY_SNIPPET)
}

function str(v: unknown): string {
  return v === undefined || v === null ? '' : String(v).trim()
}

function parseYmd(iso: string): Date | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return Number.isNaN(d.getTime()) ? null : d
}

function addDaysIso(iso: string, days: number): string {
  const d = parseYmd(iso)!
  d.setUTCDate(d.getUTCDate() + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/**
 * Parse a deadline string into YYYY-MM-DD.
 * Handles "2026-07-31", "2026.07.31", "2026년 7월 31일", "~2026.7.31".
 * Returns null for 상시/수시/연중/미정/예산소진 (no fixed date → not a hard cut).
 */
function parseDeadline(raw: string): { date: string | null; perpetual: boolean } {
  const s = raw.trim()
  if (!s) return { date: null, perpetual: false }
  if (/상시|수시|연중|예산\s*소진|소진\s*시|별도\s*공고|미정|상시모집/.test(s)) {
    return { date: null, perpetual: true }
  }
  const full = s.match(/(\d{4})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})/)
  if (full) {
    return {
      date: `${full[1]}-${full[2].padStart(2, '0')}-${full[3].padStart(2, '0')}`,
      perpetual: false,
    }
  }
  return { date: null, perpetual: false }
}

/**
 * CODE-level deadline safety cut. Keeps an item only if:
 *   - it has a source (org or url), AND
 *   - its deadline is today-or-later, OR it is perpetual (상시), OR no parseable
 *     date (kept but flagged — 기관 확인 필요).
 * DROPS any item with a parsed deadline strictly before today.
 */
function passesDeadline(item: SubsidyItem, todayIso: string): boolean {
  if (!item.org && !item.url) return false // no source → never show
  if (!item.deadlineDate) return true // 상시/미정 → keep (sorts last)
  return item.deadlineDate >= todayIso
}

// ── 보조금24 (odcloud gov24 serviceList) ──────────────────────────────────────

interface OdcloudEnvelope {
  code?: number
  msg?: string
  data?: Record<string, unknown>[]
  currentCount?: number
  totalCount?: number
}

async function fetchJsonAttempt(url: string): Promise<OdcloudEnvelope> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (Gunpo-Welfare/1.0)' },
      cache: 'no-store',
    })
    const text = await res.text()
    const trimmed = text.trim()
    let json: OdcloudEnvelope | null = null
    try {
      json = JSON.parse(trimmed) as OdcloudEnvelope
    } catch {
      throw new Error(`Non-JSON body — ${bodySnippet(trimmed)}`)
    }
    if (typeof json.code === 'number' && json.code < 0) {
      throw new Error(`code ${json.code}: ${json.msg ?? ''} (HTTP ${res.status})`)
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${bodySnippet(trimmed)}`)
    return json
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

async function fetchJson(url: string): Promise<OdcloudEnvelope> {
  try {
    return await fetchJsonAttempt(url)
  } catch (e: unknown) {
    if (!isRetryableFetchError(e)) throw e
    await sleep(RETRY_DELAY_MS)
    return await fetchJsonAttempt(url)
  }
}

/** Field-name-tolerant getter (odcloud Korean keys vary by dataset revision). */
function pick(row: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = row[k]
    if (v !== undefined && v !== null && String(v).trim()) return String(v).trim()
  }
  return null
}

function rowToSubsidy(row: Record<string, unknown>): SubsidyItem | null {
  const name = pick(row, ['서비스명', '서비스명칭', 'servNm', 'SVC_NM'])
  if (!name) return null
  const org = pick(row, ['소관기관명', '부서명', '소관조직명', 'jurMnofNm', 'INST_NM'])
  const target = pick(row, ['지원대상', '서비스목적요약', '서비스목적', 'tgtCvgNm'])
  const how = pick(row, ['신청방법', '신청방법내용', 'aplyMtdNm'])
  const url = pick(row, ['상세조회URL', '상세조회url', 'servDtlLink', 'url'])
  const deadlineRaw = pick(row, ['신청기한', '신청기한내용', 'aplyPrdSeCd', '접수기간']) ?? ''
  const { date, perpetual } = parseDeadline(deadlineRaw)
  return {
    name,
    org,
    target,
    deadline: deadlineRaw || (perpetual ? '상시' : null),
    how,
    url,
    source: '보조금24',
    asOf: null,
    note: null,
    deadlineDate: date,
  }
}

/**
 * Fetch 보조금24 services, keeping national items + anything matching Gunpo
 * REGION_KEYWORDS while dropping items that clearly belong to another named
 * city (see matchesGunpoOrNational above).
 */
async function fetchGov24(errors: string[]): Promise<SubsidyItem[]> {
  const key = serviceKey()
  if (!key) {
    errors.push('gov24: no service key')
    return []
  }
  const url = `${GOV24_BASE}/serviceList?page=1&perPage=200&serviceKey=${encodeURIComponent(key)}`
  console.log('[gunpo-welfare] gov24 →', redact(url))
  try {
    const env = await fetchJson(url)
    const rows = Array.isArray(env.data) ? env.data : []
    if (rows[0]) console.log('[gunpo-welfare] gov24 sample keys →', Object.keys(rows[0]).join(','))
    const out: SubsidyItem[] = []
    for (const r of rows) {
      const item = rowToSubsidy(r)
      if (!item) continue
      const haystack = `${item.name} ${item.org ?? ''} ${item.target ?? ''}`
      if (!matchesGunpoOrNational(haystack)) continue
      out.push(item)
    }
    return out
  } catch (e: unknown) {
    errors.push(`gov24: ${e instanceof Error ? e.message : String(e)}`)
    return []
  }
}

// ── Perplexity: 군포시 공고 ─────────────────────────────────────────────────────

async function fetchGunpoAnnouncements(
  today: string,
  errors: string[],
  userConditions?: string,
): Promise<{ items: SubsidyItem[]; meta: ContextMeta }> {
  const retrievedAt = kstNowIso()
  const systemPrompt =
    `오늘은 ${today}입니다. ` +
    '경기도 군포시청(gunpo.go.kr), 산본1동·산본2동·금정동 등 행정복지센터 및 경기도청을 기준으로, ' +
    '현재 신청 가능한(마감 안 지난) 군포시 복지·지원금·보조금 공고를 최신순으로 모으세요. ' +
    '각 항목에 소관기관(org), 신청기한(deadline), 출처(url 또는 기관명)를 반드시 포함하세요. ' +
    '이미 마감된 공고는 절대 넣지 마세요. 실제로 존재하는 공고만, 지어내지 마세요. ' +
    '출처(기관명 또는 url)가 없는 항목은 넣지 마세요. ' +
    '한국어로만. 인용 번호([1][3] 등)와 한자·중문·일문 문장부호(。「」 등)를 쓰지 마세요. ' +
    (userConditions ? `사용자 조건: ${userConditions}. 이 조건에 해당할 수 있는 것을 우선하세요. ` : '') +
    '반드시 아래 JSON만 출력하세요(설명·마크다운·코드펜스 금지):\n' +
    '{"items":[{"name":"사업명","org":"소관기관","target":"지원대상",' +
    '"deadline":"YYYY-MM-DD 또는 상시","how":"신청방법","url":"출처 링크","asOf":"공고일 YYYY-MM-DD"}]}'
  const prompt =
    `${today} 기준 현재 신청 가능한 경기도 군포시 복지·지원금·보조금 공고를 JSON으로 주세요. ` +
    '군포시청·산본1동·산본2동·금정동 행정복지센터 기준. 마감 지난 것 제외, 출처 필수.'

  try {
    const r = await runSingleAiProvider({
      supabase: noDbSupabase(),
      sessionId: null,
      userId: null,
      provider: PERPLEXITY_PROVIDER,
      prompt,
      systemPrompt,
      maxCompletionTokens: MATCH_MAX_TOKENS,
      timeoutMs: PERPLEXITY_TIMEOUT_MS,
      temperature: 0.1,
      skipLanguageInjection: true,
    })
    if (r.error || !r.text?.trim()) {
      errors.push(`announcements: ${r.error || 'empty'}`)
      return { items: [], meta: { source: '검색', retrievedAt, asOf: null } }
    }
    const cleaned = cleanPerplexityText(r.text)
    let parsed: unknown
    try {
      parsed = JSON.parse(extractJsonObject(cleaned))
    } catch {
      try {
        parsed = JSON.parse(extractJsonObject(r.text))
      } catch {
        errors.push('announcements: JSON parse failed')
        return { items: [], meta: { source: '검색', retrievedAt, asOf: null } }
      }
    }
    const arr =
      parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).items)
        ? ((parsed as Record<string, unknown>).items as unknown[])
        : Array.isArray(parsed)
          ? (parsed as unknown[])
          : []

    const items: SubsidyItem[] = []
    for (const row of arr) {
      if (!row || typeof row !== 'object') continue
      const it = row as Record<string, unknown>
      const name = strOrNull(it.name)
      const org = strOrNull(it.org)
      const url = strOrNull(it.url)
      // ANTI-HALLUCINATION: no source → skip
      if (!name || (!org && !url)) continue
      const deadlineRaw = str(it.deadline)
      const { date, perpetual } = parseDeadline(deadlineRaw)
      items.push({
        name: cleanPerplexityText(name),
        org,
        target: strOrNull(it.target),
        deadline: deadlineRaw || (perpetual ? '상시' : null),
        how: strOrNull(it.how),
        url,
        source: '검색',
        asOf: strOrNull(it.asOf),
        note: CONFIRM_NOTE,
        deadlineDate: date,
      })
    }
    return { items, meta: { source: '검색', retrievedAt, asOf: today } }
  } catch (e: unknown) {
    errors.push(`announcements: ${e instanceof Error ? e.message : String(e)}`)
    return { items: [], meta: { source: '검색', retrievedAt, asOf: null } }
  }
}

// ── Merge + dedupe + deadline safety ───────────────────────────────────────────

function normName(s: string): string {
  return s.toLowerCase().replace(/[\s\-·,.()[\]{}!?'"~/]+/g, '')
}

function mergeSubsidies(gov24: SubsidyItem[], local: SubsidyItem[]): SubsidyItem[] {
  const seen = new Map<string, SubsidyItem>()
  for (const it of gov24) seen.set(normName(it.name), it)
  for (const it of local) {
    const k = normName(it.name)
    if (!seen.has(k)) seen.set(k, it)
  }
  return Array.from(seen.values())
}

function sortByDeadline(items: SubsidyItem[]): SubsidyItem[] {
  return [...items].sort((a, b) => {
    if (a.deadlineDate && b.deadlineDate) return a.deadlineDate.localeCompare(b.deadlineDate)
    if (a.deadlineDate) return -1
    if (b.deadlineDate) return 1
    return a.name.localeCompare(b.name, 'ko')
  })
}

// ── Section 1: subsidy match (POST, NOT cached) ────────────────────────────────

function conditionsToText(input: MatchInput): string {
  const parts: string[] = []
  if (input.age != null) parts.push(`나이 ${input.age}세`)
  if (input.job) parts.push(`직업/상황 ${input.job}`)
  if (input.situation) parts.push(`상황 ${input.situation}`)
  if (input.household) parts.push(`가구 ${input.household}`)
  return parts.join(', ')
}

/**
 * Match user conditions to REAL subsidy items. The AI only re-ranks / explains
 * items we pass in; it cannot introduce new ones (we ignore any name not in the
 * candidate set). Eligibility is framed as "가능성 있음 · 기관 확인 필요".
 */
async function explainMatches(
  candidates: SubsidyItem[],
  conditions: string,
  today: string,
  errors: string[],
): Promise<SubsidyItem[]> {
  if (candidates.length === 0 || !conditions) return candidates
  const byName = new Map(candidates.map((c) => [normName(c.name), c]))

  const list = candidates
    .slice(0, 30)
    .map((c, i) => `${i + 1}. ${c.name} | 대상:${c.target ?? '?'} | 기관:${c.org ?? '?'} | 기한:${c.deadline ?? '?'}`)
    .join('\n')

  const systemPrompt =
    `오늘은 ${today}입니다. ` +
    '아래 "후보 목록"에 있는 항목만 사용하세요. 목록에 없는 지원금을 새로 만들지 마세요. ' +
    `사용자 조건(${conditions})에 해당할 가능성이 있는 항목을 골라 왜 맞는지 한 줄로 설명하세요. ` +
    '자격을 단정하지 말고 "해당 가능성 있음, 기관 확인 필요" 톤으로 쓰세요. ' +
    '한국어만. 인용 번호·한자·중문·일문 문장부호 금지. ' +
    '반드시 JSON만: {"picks":[{"n":후보번호,"why":"맞는 이유 한 줄"}]}'
  const prompt = `후보 목록:\n${list}\n\n사용자 조건: ${conditions}\n해당 가능성 있는 항목 번호와 이유를 JSON으로.`

  try {
    const r = await runSingleAiProvider({
      supabase: noDbSupabase(),
      sessionId: null,
      userId: null,
      provider: 'anthropic',
      prompt,
      systemPrompt,
      modelOverride: 'claude-sonnet-4-6',
      maxCompletionTokens: 900,
      timeoutMs: TIMEOUT_MS + 5_000,
      temperature: 0.2,
      skipLanguageInjection: true,
    })
    if (r.error || !r.text?.trim()) {
      errors.push(`match-explain: ${r.error || 'empty'}`)
      return candidates
    }
    const parsed = JSON.parse(extractJsonObject(cleanPerplexityText(r.text))) as Record<string, unknown>
    const picks = Array.isArray(parsed.picks) ? parsed.picks : []
    const out: SubsidyItem[] = []
    for (const p of picks) {
      if (!p || typeof p !== 'object') continue
      const n = Number((p as Record<string, unknown>).n)
      const why = strOrNull((p as Record<string, unknown>).why)
      const cand = candidates[n - 1]
      if (!cand) continue
      if (!byName.has(normName(cand.name))) continue
      out.push({
        ...cand,
        note: [why ? `해당 가능성: ${why}` : '해당 가능성 있음', '기관 확인 필요', cand.note]
          .filter(Boolean)
          .join(' · '),
      })
    }
    return out.length ? out : candidates
  } catch {
    errors.push('match-explain: parse failed — returning unranked candidates')
    return candidates
  }
}

/** POST /match — user-specific, NOT cached. */
export async function matchSubsidies(input: MatchInput): Promise<MatchResult> {
  const errors: string[] = []
  const today = kstTodayIso()
  const conditions = conditionsToText(input)

  const [govSettled, localSettled] = await Promise.allSettled([
    fetchGov24(errors),
    fetchGunpoAnnouncements(today, errors, conditions || undefined),
  ])

  const gov = govSettled.status === 'fulfilled' ? govSettled.value : []
  const local = localSettled.status === 'fulfilled' ? localSettled.value.items : []
  let contextMeta: ContextMeta | null = null
  if (localSettled.status === 'fulfilled') contextMeta = localSettled.value.meta

  const merged = mergeSubsidies(gov, local).filter((it) => passesDeadline(it, today))
  const dated = sortByDeadline(merged)

  const matches = await explainMatches(dated, conditions, today, errors)

  return {
    ok: true,
    matches: matches.slice(0, 25),
    contextMeta,
    disclaimer: DISCLAIMER,
    errors,
  }
}

// ── Section 3 + cache: main GET (deadline-soon) ────────────────────────────────

async function buildWelfarePayload(): Promise<WelfarePayload> {
  const errors: string[] = []
  const today = kstTodayIso()
  const soonEnd = addDaysIso(today, SOON_DAYS)

  const [govSettled, localSettled] = await Promise.allSettled([
    fetchGov24(errors),
    fetchGunpoAnnouncements(today, errors),
  ])
  const gov = govSettled.status === 'fulfilled' ? govSettled.value : []
  const local = localSettled.status === 'fulfilled' ? localSettled.value.items : []
  let contextMeta: ContextMeta | null = null
  if (localSettled.status === 'fulfilled') contextMeta = localSettled.value.meta
  else errors.push(`announcements(settled): ${String((localSettled as PromiseRejectedResult).reason)}`)

  const merged = mergeSubsidies(gov, local).filter((it) => passesDeadline(it, today))

  const soon = sortByDeadline(
    merged.filter((it) => it.deadlineDate && it.deadlineDate >= today && it.deadlineDate <= soonEnd),
  )

  if (soon.length === 0) errors.push('welfare: no dated 공고 within 30 days (상시/미정 제외)')

  return {
    ok: true,
    deadlineSoon: soon,
    windowDays: SOON_DAYS,
    today,
    contextMeta,
    disclaimer: DISCLAIMER,
    freshnessNote: FRESHNESS_NOTE,
    updatedAt: new Date().toISOString(),
    errors,
    fromCache: false,
  }
}

// ── Cache I/O (gunpo_welfare_cache; key = date OR date:guide:topic) ────────────
// Degrades gracefully (treated as a cache miss) if the table doesn't exist yet —
// no DB migration is included in this change.

async function readCache(cacheKey: string): Promise<Record<string, unknown> | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('gunpo_welfare_cache')
      .select('payload')
      .eq('cache_date', cacheKey)
      .maybeSingle()
    if (error) {
      console.warn('[gunpo-welfare] cache read:', error.message)
      return null
    }
    if (!data?.payload || typeof data.payload !== 'object') return null
    return data.payload as Record<string, unknown>
  } catch (e: unknown) {
    console.warn('[gunpo-welfare] cache read threw:', e instanceof Error ? e.message : e)
    return null
  }
}

async function writeCache<T extends object>(cacheKey: string, payload: T): Promise<T> {
  try {
    const { error } = await supabaseAdmin.from('gunpo_welfare_cache').insert({
      cache_date: cacheKey,
      payload: { ...payload, fromCache: false },
    })
    if (!error) return payload
    const isConflict = error.code === '23505' || /duplicate|unique/i.test(error.message)
    if (isConflict) {
      console.log('[gunpo-welfare] cache race — re-reading winner for', cacheKey)
      const winner = await readCache(cacheKey)
      if (winner) return winner as T
    } else {
      console.warn('[gunpo-welfare] cache write:', error.message)
    }
  } catch (e: unknown) {
    console.warn('[gunpo-welfare] cache write threw:', e instanceof Error ? e.message : e)
  }
  return payload
}

// ── Public: main GET (cached per KST day) ──────────────────────────────────────

export interface GetWelfareOptions {
  force?: boolean
}

export async function getWelfare(opts: GetWelfareOptions = {}): Promise<WelfareResult> {
  const cacheKey = kstTodayIso()
  const force = Boolean(opts.force)

  if (!force) {
    const cached = await readCache(cacheKey)
    if (cached && cached.ok && Array.isArray(cached.deadlineSoon)) {
      console.log('[gunpo-welfare] cache hit', cacheKey)
      return { ...(cached as unknown as WelfarePayload), fromCache: true }
    }
  } else {
    console.log('[gunpo-welfare] force bypass', cacheKey)
  }

  const existing = welfareInflight.get(cacheKey)
  if (existing && !force) return existing

  const work = (async (): Promise<WelfarePayload> => {
    const fresh = await buildWelfarePayload()
    if (force) return fresh
    return writeCache(cacheKey, fresh)
  })()

  if (!force) welfareInflight.set(cacheKey, work)
  try {
    return await work
  } finally {
    if (!force) welfareInflight.delete(cacheKey)
  }
}

// ── Section 2: 민원 안내 guide (GET, cached per topic/day) ─────────────────────

async function buildGuide(topic: string): Promise<GuideResult> {
  const errors: string[] = []
  const today = kstTodayIso()
  const retrievedAt = kstNowIso()

  const systemPrompt =
    `오늘은 ${today}입니다. ` +
    '당신은 경기도 군포시 민원·행정 안내 도우미입니다. ' +
    `"${topic}"을(를) 군포시(군포시청, 산본1동·산본2동·금정동 행정복지센터) 기준으로 처리하는 방법을 안내하세요. ` +
    '군포시 기관·온라인(정부24 등)·방문 절차를 반영하세요. ' +
    '한국어만. 인용 번호([1][3] 등)와 한자·중문·일문 문장부호(。「」 등)를 쓰지 마세요. ' +
    '확실하지 않은 세부는 단정하지 말고 관할 기관 확인을 권하세요. ' +
    '반드시 JSON만 출력(설명·마크다운·코드펜스 금지):\n' +
    '{"intro":"한 줄 요약","steps":["1단계","2단계","3단계"],' +
    '"documents":["준비물1","준비물2"],"where":"신청 장소/온라인"}'
  const prompt = `군포시에서 "${topic}" 하는 방법을 단계별로 알려주세요. 준비물과 신청 장소 포함. JSON으로.`

  try {
    const r = await runSingleAiProvider({
      supabase: noDbSupabase(),
      sessionId: null,
      userId: null,
      provider: PERPLEXITY_PROVIDER,
      prompt,
      systemPrompt,
      maxCompletionTokens: GUIDE_MAX_TOKENS,
      timeoutMs: PERPLEXITY_TIMEOUT_MS,
      temperature: 0.1,
      skipLanguageInjection: true,
    })
    if (r.error || !r.text?.trim()) {
      errors.push(`guide: ${r.error || 'empty'}`)
      return {
        ok: false,
        topic,
        intro: '',
        steps: [],
        documents: [],
        where: null,
        contextMeta: { source: '검색', retrievedAt, asOf: null },
        disclaimer: DISCLAIMER,
        errors,
        fromCache: false,
      }
    }
    const cleaned = cleanPerplexityText(r.text)
    let parsed: Record<string, unknown> = {}
    try {
      parsed = JSON.parse(extractJsonObject(cleaned)) as Record<string, unknown>
    } catch {
      try {
        parsed = JSON.parse(extractJsonObject(r.text)) as Record<string, unknown>
      } catch {
        errors.push('guide: JSON parse failed')
      }
    }
    const stepsRaw = Array.isArray(parsed.steps) ? parsed.steps : []
    const steps: GuideStep[] = stepsRaw
      .map((s, i) => ({ step: i + 1, text: cleanPerplexityText(str(s)) }))
      .filter((s) => s.text)
    const documents = Array.isArray(parsed.documents)
      ? parsed.documents.map((d) => cleanPerplexityText(str(d))).filter(Boolean)
      : []

    return {
      ok: steps.length > 0,
      topic,
      intro: cleanPerplexityText(str(parsed.intro)),
      steps,
      documents,
      where: strOrNull(parsed.where),
      contextMeta: { source: '검색', retrievedAt, asOf: extractAsOf(cleaned) ?? today },
      disclaimer: DISCLAIMER,
      errors,
      fromCache: false,
    }
  } catch (e: unknown) {
    errors.push(`guide: ${e instanceof Error ? e.message : String(e)}`)
    return {
      ok: false,
      topic,
      intro: '',
      steps: [],
      documents: [],
      where: null,
      contextMeta: { source: '검색', retrievedAt, asOf: null },
      disclaimer: DISCLAIMER,
      errors,
      fromCache: false,
    }
  }
}

/** GET /guide?topic= — cached per KST day per topic. */
export async function getGuide(topic: string, opts: { force?: boolean } = {}): Promise<GuideResult> {
  const clean = (topic ?? '').trim()
  if (!clean) {
    return {
      ok: false,
      topic: '',
      intro: '',
      steps: [],
      documents: [],
      where: null,
      contextMeta: null,
      disclaimer: DISCLAIMER,
      errors: ['topic이 필요해요.'],
      fromCache: false,
    }
  }
  const cacheKey = `${kstTodayIso()}:guide:${clean}`
  const force = Boolean(opts.force)

  if (!force) {
    const cached = await readCache(cacheKey)
    if (cached && cached.ok && Array.isArray(cached.steps)) {
      console.log('[gunpo-welfare] guide cache hit', cacheKey)
      return { ...(cached as unknown as GuideResult), fromCache: true }
    }
  }

  const existing = guideInflight.get(cacheKey)
  if (existing && !force) return existing

  const work = (async (): Promise<GuideResult> => {
    const fresh = await buildGuide(clean)
    if (!force && fresh.ok) return writeCache(cacheKey, fresh)
    return fresh
  })()

  if (!force) guideInflight.set(cacheKey, work)
  try {
    return await work
  } finally {
    if (!force) guideInflight.delete(cacheKey)
  }
}
