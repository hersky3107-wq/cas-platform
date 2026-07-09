import 'server-only'

/**
 * SHARED Jeju local-news briefing — 도민(resident) mode.
 * Consumed by GET /api/domin/news.
 *
 * LIGHTWEIGHT: ONE Perplexity search call per KST calendar day (cached in
 * jeju_news_cache). Do NOT reuse the governance 4-beat DEEP news engine.
 * Reuses fishery helpers: cleanPerplexityText, kstTodayIso, ContextMeta.
 *
 * Lens: ordinary Jeju residents' daily life — NOT policy analysis, NOT
 * national politics. Jeju-only stories from major + local press.
 *
 * Recency: only articles from the last 3 KST days (prefer today/yesterday).
 * Volume: as many real recent Jeju items as exist, hard-capped at 25.
 * NEVER pad / invent / include older articles to hit a count.
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

/** Perplexity call budget — larger briefing (up to 25 items) needs headroom. */
const TIMEOUT_MS = 25_000
const MAX_TOKENS = 4500
const PERPLEXITY_PROVIDER: ExtendedAiProviderName = 'perplexity'
const FRESHNESS_NOTE = '최근 제주 뉴스 검색 기반 (최근 3일)'
/** Hard cap — never invent to fill; real recent Jeju news only. */
const HARD_CAP = 25
/** Keep articles whose publish date is within this many days of today (KST). */
const MAX_AGE_DAYS = 3

/** Resident-life categories — NOT governance categories. */
export const NEWS_CATEGORIES = [
  '생활·물가',
  '교통·공항',
  '날씨·재난·안전',
  '행사·축제',
  '복지·행정',
  '부동산·개발',
] as const

export type NewsCategory = (typeof NEWS_CATEGORIES)[number]

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

// ── Perplexity call (ONE per day when cache misses) ───────────────────────────

async function fetchBriefing(errors: string[]): Promise<{
  items: NewsItem[]
  meta: ContextMeta
}> {
  const today = kstTodayIso()
  const retrievedAt = kstNowIso()

  const systemPrompt =
    `오늘은 ${today}입니다. ` +
    `각 기사는 반드시 실제 발행일(asOf, YYYY-MM-DD)을 포함하세요. ` +
    `오늘(${today}) 기준 최근 ${MAX_AGE_DAYS}일 이내 기사만 포함하세요. 오늘·어제 기사를 최우선으로 하세요. ` +
    `${MAX_AGE_DAYS}일보다 오래된 기사, 날짜를 알 수 없는 기사, 저번 주 기사는 절대 넣지 마세요. ` +
    '당신은 제주 도민을 위한 생활 뉴스 브리핑 편집자입니다. ' +
    '대상은 평범한 제주 거주 성인입니다. 정책 분석가 톤도, 어르신용 쉬운말 톤도 쓰지 마세요. ' +
    '제주 도민의 생활에 실제로 영향을 주는 소식만 고르세요. ' +
    '전국·정치·외교 뉴스는 제주와 직접 연결될 때만 포함하세요. ' +
    '제주일보, 제주의소리, 제주도민일보, 한라일보 등 제주 지역 언론과 ' +
    '주요 전국 언론의 제주 관련 보도를 모두 활용하세요(제주 이야기면 전국지 보도도 포함). ' +
    '한국어로만 답하세요. 인용 번호([1][3] 등)와 한자·중문·일문 문장부호(。「」 등)를 쓰지 마세요. ' +
    '반드시 아래 JSON 형식만 출력하세요(설명·마크다운·코드펜스 금지):\n' +
    '{"briefing":[{"category":"생활·물가|교통·공항|날씨·재난·안전|행사·축제|복지·행정|부동산·개발",' +
    '"headline":"제목","summary":"2~3문장","why":"도민에게 중요한 이유 한 줄",' +
    '"source":"언론사명","asOf":"YYYY-MM-DD"}]}\n' +
    `최근 ${MAX_AGE_DAYS}일 안에 실제로 있는 제주 관련 기사만 모으세요. ` +
    `개수는 실제 기사 수에 따르며, 상한은 ${HARD_CAP}개입니다. ` +
    '기사가 적으면 적게 반환하세요. 개수를 맞추려고 지어내거나, 오래된 기사·날짜 없는 기사를 넣거나, 패딩하지 마세요. ' +
    '뉴스가 있는 카테고리만 넣고 빈 카테고리는 건너뛰세요. 카테고리별로 골고루 분산하세요. ' +
    'summary는 성인 읽기 수준으로 2~3문장, 명확하게.'

  const prompt =
    `제주 도민 생활 뉴스 브리핑을 ${today} 기준으로 작성해 주세요. ` +
    `최근 ${MAX_AGE_DAYS}일(${today} 포함) 제주 관련 실기사만 — 생활·물가, 교통·공항, 날씨·재난·안전, 행사·축제, 복지·행정, 부동산·개발. ` +
    `있는 만큼(최대 ${HARD_CAP}개) JSON으로 답하고, 없으면 적게 답하세요. 패딩 금지.`

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
      errors.push(`news: ${r.error || 'empty'}`)
      return { items: [], meta: { source: '검색', retrievedAt, asOf: null } }
    }

    const cleaned = cleanPerplexityText(r.text)
    let items: NewsItem[] = []
    try {
      const parsed = JSON.parse(extractJsonObject(cleaned)) as unknown
      items = parseBriefing(parsed)
    } catch {
      try {
        const parsed = JSON.parse(extractJsonObject(r.text)) as unknown
        items = parseBriefing(parsed)
      } catch {
        errors.push('news: JSON parse failed')
        return { items: [], meta: { source: '검색', retrievedAt, asOf: null } }
      }
    }

    items = filterAndSort(items, today, errors)

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
  } catch (e: unknown) {
    errors.push(`news: ${e instanceof Error ? e.message : String(e)}`)
    return { items: [], meta: { source: '검색', retrievedAt, asOf: null } }
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
 * First request of a KST day → one Perplexity call → store in jeju_news_cache.
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
