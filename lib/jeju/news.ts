import 'server-only'

/**
 * SHARED Jeju local-news briefing — 도민(resident) mode.
 * Consumed by GET /api/domin/news.
 *
 * LIGHTWEIGHT but broad-sweep: UP TO TWO Perplexity calls per KST calendar
 * day (cached in jeju_news_cache, so still one Perplexity bill/day overall).
 * Call 1 sweeps all categories across national + local Jeju press; call 2
 * digs deeper into the two usually-highest-volume categories (정치·도정,
 * 경제·산업) in local press. Results are merged + deduped. Do NOT reuse the
 * governance 4-beat DEEP news engine. Reuses fishery helpers:
 * cleanPerplexityText, kstTodayIso, ContextMeta.
 *
 * Lens: ordinary Jeju residents' daily life. Jeju-only stories (national
 * politics only when it directly affects Jeju), sourced from BOTH major
 * national outlets' Jeju coverage (연합뉴스/KBS/조선/중앙/한겨레 등) AND Jeju
 * local press (제주일보/제주의소리/한라일보/제주도민일보/KBS제주/JIBS).
 *
 * Politics is INCLUDED (정치·도정) but must stay strictly neutral: facts of
 * what was done/decided/announced only — never evaluation, never advocacy,
 * never taking sides. See NEUTRALITY rules in the system prompt below; this
 * matters because this project is hosted by 제주도청.
 *
 * Recency: only articles from the last 3 KST days (prefer today/yesterday).
 * Volume: target 8-15 real recent items across categories, hard-capped at
 * HARD_CAP. NEVER pad / invent / widen the window to hit a count — honest
 * fewer beats stale filler.
 *
 * ISOLATION: 'server-only'; sessionId/userId null for the AI call;
 * cache I/O via supabaseAdmin. MUST NOT import governance/synod/DEEP/Arena.
 * Never throws; empty briefing + errors[] on fail.
 */

import { runSingleAiProvider, type ExtendedAiProviderName } from '@/lib/ai/router'
import {
  cleanPerplexityText,
  kstTodayIso,
  type ContextMeta,
} from '@/lib/jeju/fishery'
import { supabaseAdmin } from '@/lib/supabase/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// ── Constants ─────────────────────────────────────────────────────────────────

/** Perplexity call budget per call — up to two calls (sweep + follow-up). */
const TIMEOUT_MS = 25_000
const MAX_TOKENS = 4000
const PERPLEXITY_PROVIDER: ExtendedAiProviderName = 'perplexity'
const FRESHNESS_NOTE = '최근 제주 뉴스 검색 기반 (최근 3일)'
/** Hard cap after merge+dedupe — never invent to fill; real recent Jeju news only. */
const HARD_CAP = 30
/** Keep articles whose publish date is within this many days of today (KST). */
const MAX_AGE_DAYS = 3
/** Rough volume target communicated to the model (honest fewer is fine). */
const TARGET_MIN = 8
const TARGET_MAX = 15

/** Resident-life categories, including politics/administration framed neutrally. */
export const NEWS_CATEGORIES = [
  '정치·도정',
  '경제·산업',
  '생활·물가',
  '교통·공항',
  '날씨·재난·안전',
  '사회·사건',
  '행사·축제',
] as const

export type NewsCategory = (typeof NEWS_CATEGORIES)[number]

/** The two categories local press tends to cover most densely — targeted follow-up digs here. */
const HIGH_VOLUME_CATEGORIES: readonly NewsCategory[] = ['정치·도정', '경제·산업']

export interface NewsItem {
  category: NewsCategory
  headline: string
  summary: string
  /** 왜 도민에게 중요한지 한 줄 */
  why: string
  /** 언론사명 if stated */
  source: string | null
  /** ARTICLE publish date (YYYY-MM-DD), not the fetch time */
  asOf: string | null
}

export interface NewsPayload {
  ok: true
  briefing: NewsItem[]
  contextMeta: ContextMeta
  freshnessNote: string
  updatedAt: string
  errors: string[]
  /** Whether this response came from jeju_news_cache (same KST day). */
  fromCache: boolean
}

export type NewsResult = NewsPayload | { ok: false; error: string }

export interface GetNewsOptions {
  /** Bypass daily cache (admin/testing). */
  force?: boolean
}

// ── In-process race guard (same Node isolate) ─────────────────────────────────

const inflight = new Map<string, Promise<NewsPayload>>()

// ── Helpers ───────────────────────────────────────────────────────────────────

function noDbSupabase(): SupabaseClient {
  return createClient('http://localhost', 'news-no-db') as unknown as SupabaseClient
}

/** Full ISO timestamp with +09:00 — ContextMeta.retrievedAt. */
function kstNowIso(): string {
  const now = new Date()
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())}` +
    `T${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}:${pad(kst.getUTCSeconds())}+09:00`
  )
}

function extractJsonObject(raw: string): string {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i)
  if (fence && fence[1]) text = fence[1].trim()
  if (text.startsWith('{')) return text
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  return start !== -1 && end > start ? text.slice(start, end + 1) : text
}

/** Parse a publish date into YYYY-MM-DD. Rejects year-month-only (too vague). */
function extractAsOf(text: string): string | null {
  const full = text.match(/(\d{4})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})/)
  if (full) {
    return `${full[1]}-${full[2].padStart(2, '0')}-${full[3].padStart(2, '0')}`
  }
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  return null
}

function coerceCategory(v: unknown): NewsCategory | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return (NEWS_CATEGORIES as readonly string[]).includes(t) ? (t as NewsCategory) : null
}

function strOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = cleanPerplexityText(v)
  return s || null
}

/** YYYY-MM-DD → UTC midnight Date for day-diff math. */
function parseYmd(ymd: string): Date | null {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return Number.isNaN(d.getTime()) ? null : d
}

/** Inclusive: keep if asOf is within [today - MAX_AGE_DAYS, today]. */
function isWithinRecency(asOf: string, todayYmd: string): boolean {
  const article = parseYmd(asOf)
  const today = parseYmd(todayYmd)
  if (!article || !today) return false
  const diffMs = today.getTime() - article.getTime()
  const diffDays = diffMs / (24 * 60 * 60 * 1000)
  // Future-dated (clock skew / model error) → drop; older than window → drop.
  return diffDays >= 0 && diffDays <= MAX_AGE_DAYS
}

function parseBriefing(raw: unknown): NewsItem[] {
  if (!raw || typeof raw !== 'object') return []
  const obj = raw as Record<string, unknown>
  const arr = Array.isArray(obj.briefing) ? obj.briefing : Array.isArray(raw) ? raw : []
  const out: NewsItem[] = []

  for (const row of arr) {
    if (!row || typeof row !== 'object') continue
    const it = row as Record<string, unknown>
    const category = coerceCategory(it.category)
    const headline = strOrNull(it.headline)
    if (!category || !headline) continue

    const summary = strOrNull(it.summary) ?? ''
    const why = strOrNull(it.why) ?? ''
    const source = strOrNull(it.source)
    let asOf = strOrNull(it.asOf)
    if (asOf) {
      asOf = extractAsOf(asOf)
    } else {
      asOf = extractAsOf(`${headline} ${summary} ${why}`)
    }

    out.push({ category, headline, summary, why, source, asOf })
  }
  return out
}

/**
 * Drop items older than MAX_AGE_DAYS or without a parseable article date.
 * Sort newest-first. Cap at HARD_CAP (no padding).
 */
function filterAndSort(items: NewsItem[], todayYmd: string, errors: string[]): NewsItem[] {
  const kept: NewsItem[] = []
  let droppedNoDate = 0
  let droppedOld = 0

  for (const it of items) {
    if (!it.asOf || !parseYmd(it.asOf)) {
      droppedNoDate++
      continue
    }
    if (!isWithinRecency(it.asOf, todayYmd)) {
      droppedOld++
      continue
    }
    kept.push(it)
  }

  if (droppedNoDate > 0) {
    errors.push(`recency: dropped ${droppedNoDate} item(s) with no parseable article date`)
  }
  if (droppedOld > 0) {
    errors.push(`recency: dropped ${droppedOld} item(s) older than ${MAX_AGE_DAYS} days`)
  }

  kept.sort((a, b) => {
    // Newest first; stable tie-break by headline.
    const cmp = (b.asOf ?? '').localeCompare(a.asOf ?? '')
    return cmp !== 0 ? cmp : a.headline.localeCompare(b.headline, 'ko')
  })

  return kept.slice(0, HARD_CAP)
}

/** Newest article date among items → envelope contextMeta.asOf. */
function envelopeAsOf(items: NewsItem[]): string | null {
  const dates = items
    .map((i) => i.asOf)
    .filter((d): d is string => Boolean(d))
    .sort()
  return dates.length ? dates[dates.length - 1]! : null
}

// ── Cache I/O ─────────────────────────────────────────────────────────────────

async function readCache(cacheDate: string): Promise<NewsPayload | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('jeju_news_cache')
      .select('payload')
      .eq('cache_date', cacheDate)
      .maybeSingle()
    if (error) {
      console.warn('[news] cache read:', error.message)
      return null
    }
    if (!data?.payload || typeof data.payload !== 'object') return null
    const payload = data.payload as NewsPayload
    if (!payload.ok || !Array.isArray(payload.briefing)) return null
    return { ...payload, fromCache: true }
  } catch (e: unknown) {
    console.warn('[news] cache read threw:', e instanceof Error ? e.message : e)
    return null
  }
}

/**
 * Insert-if-absent on cache_date. On unique conflict (race), re-read the
 * winner's row so both callers converge on one payload / one Perplexity bill.
 */
async function writeCache(cacheDate: string, payload: NewsPayload): Promise<NewsPayload> {
  try {
    const { error } = await supabaseAdmin.from('jeju_news_cache').insert({
      cache_date: cacheDate,
      payload: { ...payload, fromCache: false },
    })
    if (!error) return payload

    // 23505 = unique_violation — another request won the race.
    const isConflict =
      error.code === '23505' ||
      /duplicate|unique/i.test(error.message)
    if (isConflict) {
      console.log('[news] cache race — re-reading winner for', cacheDate)
      const winner = await readCache(cacheDate)
      if (winner) return winner
    } else {
      console.warn('[news] cache write:', error.message)
    }
  } catch (e: unknown) {
    console.warn('[news] cache write threw:', e instanceof Error ? e.message : e)
  }
  return payload
}

// ── Shared prompt fragments ───────────────────────────────────────────────────

/**
 * Political neutrality — non-negotiable. This project is hosted by 제주도청,
 * so any evaluative slant on 정치·도정 items is a real risk. Applied to both
 * calls; the model is told to omit a story rather than editorialize it.
 */
const NEUTRALITY_RULES =
  '【정치 중립 원칙 — 반드시 지키세요】 ' +
  '정치·도정 소식은 "누가 무엇을 했다/발표했다/의결했다"처럼 행위·결정·발표 사실만 전하세요. ' +
  '"잘했다/옳다/실패했다/무능하다/훌륭하다" 같은 평가·옹호·비판 표현은 절대 쓰지 마세요. ' +
  '특정 정당·정치인을 편들거나 깎아내리는 표현, 감정적·선동적 형용사를 쓰지 마세요. ' +
  '갈등이 있는 사안은 "A측은 ~라고 했고, B측은 ~라고 했다"처럼 양측 입장을 사실 그대로, 균형 있게 전하세요. ' +
  'why(도민 관점) 필드도 정치적 판단이 아니라 "도민 생활에 ~한 영향을 준다"처럼 사실적으로만 쓰세요. ' +
  '중립적으로 쓸 수 없는 사안이면 그 기사는 포함하지 마세요.'

/** Both national-outlet Jeju coverage AND Jeju local press — local press catches small daily items a generic search misses. */
const SOURCE_NOTE =
  '출처는 두 갈래 모두 살펴보세요: (1) 연합뉴스·KBS·조선일보·중앙일보·한겨레 등 주요 전국 언론의 제주 관련 기사, ' +
  '(2) 제주 지역 언론(제주일보, 제주의소리, 한라일보, 제주도민일보, KBS제주, JIBS) — ' +
  '지역 언론에는 전국 언론이 놓치는 소규모 일간 소식이 많으니 꼼꼼히 살펴보세요.'

const CATEGORY_SCHEMA = NEWS_CATEGORIES.join('|')
const HIGH_VOLUME_SCHEMA = HIGH_VOLUME_CATEGORIES.join('|')

function buildSweepSystemPrompt(today: string): string {
  return (
    `오늘은 ${today}입니다. ` +
    `각 기사는 반드시 실제 발행일(asOf, YYYY-MM-DD)을 포함하세요. ` +
    `오늘(${today}) 기준 최근 ${MAX_AGE_DAYS}일 이내 기사만 포함하세요. 오늘·어제 기사를 최우선으로 하세요. ` +
    `${MAX_AGE_DAYS}일보다 오래된 기사, 날짜를 알 수 없는 기사, 저번 주 기사는 절대 넣지 마세요. 기간을 넓히지 마세요. ` +
    '당신은 제주 도민을 위한 생활 뉴스 브리핑 편집자입니다. ' +
    '대상은 평범한 제주 거주 성인입니다. 정책 분석가 톤도, 어르신용 쉬운말 톤도 쓰지 마세요. ' +
    '제주 도민의 생활에 실제로 영향을 주는 소식을 모든 카테고리에서 폭넓게 모으세요: ' +
    `${CATEGORY_SCHEMA}. ` +
    '전국·외교 뉴스는 제주와 직접 연결될 때만 포함하세요. ' +
    `${SOURCE_NOTE} ` +
    `${NEUTRALITY_RULES} ` +
    '한국어로만 답하세요. 인용 번호([1][3] 등)와 한자·중문·일문 문장부호(。「」 등)를 쓰지 마세요. ' +
    '반드시 아래 JSON 형식만 출력하세요(설명·마크다운·코드펜스 금지):\n' +
    `{"briefing":[{"category":"${CATEGORY_SCHEMA}",` +
    '"headline":"제목","summary":"2~3문장","why":"도민에게 중요한 이유 한 줄(사실적으로만)",' +
    '"source":"언론사명","asOf":"YYYY-MM-DD"}]}\n' +
    `목표는 최근 ${MAX_AGE_DAYS}일 안 실제 기사 ${TARGET_MIN}~${TARGET_MAX}개 이상, 여러 카테고리에 분산(특히 ${HIGH_VOLUME_SCHEMA}에 소식이 많을 수 있음). 상한 ${HARD_CAP}개. ` +
    '기사가 적으면 적게 반환하세요. 개수를 맞추려고 지어내거나, 오래된 기사·날짜 없는 기사를 넣거나, 기간을 넓히거나, 패딩하지 마세요. ' +
    '뉴스가 있는 카테고리만 넣고 빈 카테고리는 건너뛰세요. ' +
    'summary는 성인 읽기 수준으로 2~3문장, 명확하게.'
  )
}

function buildSweepPrompt(today: string): string {
  return (
    `제주 도민 생활 뉴스 브리핑을 ${today} 기준으로 작성해 주세요. ` +
    `최근 ${MAX_AGE_DAYS}일(${today} 포함) 제주 관련 실기사만 — ${CATEGORY_SCHEMA} 전 카테고리를 훑어주세요. ` +
    '전국 언론의 제주 보도와 제주 지역 언론(제주일보/제주의소리/한라일보/제주도민일보/KBS제주/JIBS) 기사를 모두 찾아주세요. ' +
    `목표 ${TARGET_MIN}~${TARGET_MAX}개 이상(최대 ${HARD_CAP}개), 없으면 적게 답하세요. 패딩 금지, 정치는 중립 사실만.`
  )
}

/** Targeted follow-up — digs deeper into the two usually-highest-volume categories in local press. */
function buildFollowUpSystemPrompt(today: string): string {
  return (
    `오늘은 ${today}입니다. 이번엔 제주 "${HIGH_VOLUME_SCHEMA}" 카테고리만 집중적으로 더 찾아주세요 ` +
    '(이미 다른 검색에서 찾았을 기사와 중복돼도 괜찮습니다 — 나중에 중복을 제거합니다). ' +
    `각 기사는 반드시 실제 발행일(asOf, YYYY-MM-DD)을 포함하고, 오늘(${today}) 기준 최근 ${MAX_AGE_DAYS}일 이내여야 합니다. ` +
    `${MAX_AGE_DAYS}일보다 오래된 기사는 절대 넣지 마세요. 기간을 넓히지 마세요. ` +
    '제주도청·제주도의회·정당·선거·정치인 관련 소식(정치·도정)과 ' +
    '기업·관광경기·1차산업(농업·수산업·감귤 등)·부동산·개발(경제·산업) 소식을 ' +
    '제주 지역 언론(제주일보, 제주의소리, 한라일보, 제주도민일보, KBS제주, JIBS)에서 특히 꼼꼼히 찾아주세요 — ' +
    '지역 언론은 전국 언론이 다루지 않는 소규모 일간 기사를 많이 냅니다. ' +
    `${NEUTRALITY_RULES} ` +
    '한국어로만 답하세요. 인용 번호([1][3] 등)와 한자·중문·일문 문장부호(。「」 등)를 쓰지 마세요. ' +
    '반드시 아래 JSON 형식만 출력하세요(설명·마크다운·코드펜스 금지):\n' +
    `{"briefing":[{"category":"${HIGH_VOLUME_SCHEMA}","headline":"제목","summary":"2~3문장",` +
    '"why":"도민에게 중요한 이유 한 줄(사실적으로만)","source":"언론사명","asOf":"YYYY-MM-DD"}]}\n' +
    '실제로 있는 기사만 담으세요. 없으면 빈 배열을 반환하세요. 지어내거나 패딩하지 마세요.'
  )
}

function buildFollowUpPrompt(today: string): string {
  return (
    `제주 "${HIGH_VOLUME_SCHEMA}" 소식을 ${today} 기준 최근 ${MAX_AGE_DAYS}일 안에서 제주 지역 언론 위주로 최대한 더 찾아주세요. ` +
    '정치는 중립 사실만(평가·옹호 금지). 실제 기사만 JSON으로 답하고, 없으면 빈 배열.'
  )
}

/** Normalize a headline for dedupe matching across the two calls. */
function normalizeHeadline(headline: string): string {
  return headline.replace(/[\s.,!?"'…·\-()[\]「」『』]/g, '').toLowerCase()
}

/** Merge two item lists, deduping by normalized headline (first occurrence wins). */
function mergeDedupe(a: NewsItem[], b: NewsItem[]): NewsItem[] {
  const seen = new Set<string>()
  const out: NewsItem[] = []
  for (const it of [...a, ...b]) {
    const key = normalizeHeadline(it.headline)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(it)
  }
  return out
}

// ── Perplexity calls (up to TWO per day when cache misses — sweep + follow-up) ─

/** One Perplexity call + JSON parse; never throws, pushes to `errors` and returns [] on any failure. */
async function callAndParse(
  label: string,
  prompt: string,
  systemPrompt: string,
  errors: string[]
): Promise<NewsItem[]> {
  try {
    const r = await runSingleAiProvider({
      supabase: noDbSupabase(),
      sessionId: null,
      userId: null,
      provider: PERPLEXITY_PROVIDER,
      prompt,
      systemPrompt,
      maxCompletionTokens: MAX_TOKENS,
      timeoutMs: TIMEOUT_MS,
      temperature: 0.2,
      skipLanguageInjection: true,
    })

    if (r.error || !r.text || !r.text.trim()) {
      errors.push(`news(${label}): ${r.error || 'empty'}`)
      return []
    }

    const cleaned = cleanPerplexityText(r.text)
    try {
      return parseBriefing(JSON.parse(extractJsonObject(cleaned)) as unknown)
    } catch {
      try {
        return parseBriefing(JSON.parse(extractJsonObject(r.text)) as unknown)
      } catch {
        errors.push(`news(${label}): JSON parse failed`)
        return []
      }
    }
  } catch (e: unknown) {
    errors.push(`news(${label}): ${e instanceof Error ? e.message : String(e)}`)
    return []
  }
}

async function fetchBriefing(errors: string[]): Promise<{
  items: NewsItem[]
  meta: ContextMeta
}> {
  const today = kstTodayIso()
  const retrievedAt = kstNowIso()

  // Two calls in parallel — one Perplexity bill/day either way (cached by cache_date).
  const [sweepItems, followUpItems] = await Promise.all([
    callAndParse('sweep', buildSweepPrompt(today), buildSweepSystemPrompt(today), errors),
    callAndParse('followup', buildFollowUpPrompt(today), buildFollowUpSystemPrompt(today), errors),
  ])

  const merged = mergeDedupe(sweepItems, followUpItems)
  const items = filterAndSort(merged, today, errors)

  if (items.length === 0) {
    errors.push('news: empty briefing after recency filter')
  }

  return {
    items,
    meta: {
      source: '검색',
      retrievedAt,
      asOf: envelopeAsOf(items),
    },
  }
}

async function buildFreshPayload(): Promise<NewsPayload> {
  const errors: string[] = []
  console.log('[news] perplexity fetch')
  const { items, meta } = await fetchBriefing(errors)
  return {
    ok: true,
    briefing: items,
    contextMeta: meta,
    freshnessNote: FRESHNESS_NOTE,
    updatedAt: new Date().toISOString(),
    errors,
    fromCache: false,
  }
}

// ── Public entry ──────────────────────────────────────────────────────────────

/**
 * Fetch a Jeju resident-life news briefing.
 * First request of a KST day → up to two Perplexity calls (sweep + targeted
 * follow-up, merged + deduped) → store in jeju_news_cache.
 * Later requests same day → cache hit (no Perplexity).
 * Never throws; returns empty briefing + errors[] on failure.
 */
export async function getNews(opts: GetNewsOptions = {}): Promise<NewsResult> {
  const cacheDate = kstTodayIso()
  const force = Boolean(opts.force)

  if (!force) {
    const cached = await readCache(cacheDate)
    if (cached) {
      console.log('[news] cache hit', cacheDate)
      return cached
    }
  } else {
    console.log('[news] force bypass cache', cacheDate)
  }

  // In-process race: coalesce concurrent first-hits onto one Perplexity call.
  const existing = inflight.get(cacheDate)
  if (existing && !force) {
    console.log('[news] awaiting in-flight fetch', cacheDate)
    return existing
  }

  const work = (async (): Promise<NewsPayload> => {
    const fresh = await buildFreshPayload()
    if (force) return { ...fresh, fromCache: false }
    return writeCache(cacheDate, fresh)
  })()

  if (!force) inflight.set(cacheDate, work)
  try {
    return await work
  } finally {
    if (!force) inflight.delete(cacheDate)
  }
}
