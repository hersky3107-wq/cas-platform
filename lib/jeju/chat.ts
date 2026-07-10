import 'server-only'

/**
 * Jeju-specialist chatbot — 도민(resident) mode.
 * Consumed by POST /api/domin/jeju-chat.
 *
 * Single model: Anthropic Sonnet (claude-sonnet-4-6) — routing judgment +
 * Perplexity-result analysis + conversational reply. Not Opus, not Haiku.
 *
 * Search routing (3 paths):
 *   1. INTERNAL — known Jeju facts → answer directly (no Perplexity)
 *   2. FAQ CACHE — reuse today's 날씨/뉴스/물가/행사 chip caches
 *   3. SEARCH — Perplexity (deep = visible searchRaw + analysis; light = woven)
 * Cap: ≤2 Perplexity calls per user turn.
 *
 * ISOLATION: 'server-only'; sessionId/userId null. MUST NOT import
 * governance/synod/DEEP/Arena. Never throws.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { runSingleAiProvider, type ExtendedAiProviderName } from '@/lib/ai/router'
import {
  cleanPerplexityText,
  kstTodayIso,
  type ContextMeta,
} from '@/lib/jeju/fishery'
import { getNews } from '@/lib/jeju/news'
import { getWeatherAlert } from '@/lib/jeju/weather-alert'
import { getPrices } from '@/lib/jeju/prices'
import { getEvents } from '@/lib/jeju/events'
import { askPerplexity } from '@/lib/jeju/resident-search'

// ── Constants ─────────────────────────────────────────────────────────────────

const SONNET_MODEL = 'claude-sonnet-4-6'
const SONNET_PROVIDER: ExtendedAiProviderName = 'anthropic'
const PERPLEXITY_PROVIDER: ExtendedAiProviderName = 'perplexity'

// NOTE on retries: callSonnet()/runSingleAiProvider() already retry once (short
// backoff) on timeout/network-abort via lib/ai/router.ts's fetchWithRetry — no
// extra retry needed here. ROUTE_TIMEOUT_MS bumped 12s→15s (was the tightest of
// the three) for consistency with the other resident-general upstream timeouts.
const ROUTE_TIMEOUT_MS = 15_000
const REPLY_TIMEOUT_MS = 25_000
const SEARCH_TIMEOUT_MS = 18_000
const MAX_HISTORY = 12
const MAX_PPLX_PER_TURN = 2

export type ChatRoute = 'internal' | 'cache' | 'search-deep' | 'search-light'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatPayload {
  ok: true
  reply: string
  usedSearch: boolean
  searchRaw: string | null
  contextMeta: ContextMeta | null
  routedVia: ChatRoute
  errors: string[]
}

export type ChatResult = ChatPayload | { ok: false; error: string }

export interface ChatOptions {
  messages: ChatMessage[]
}

type CacheIntent = 'weather' | 'news' | 'prices' | 'events'

type RouteDecision = {
  route: ChatRoute | 'decline'
  searchQuery: string | null
  /** When route=internal or decline, Sonnet may already draft the reply. */
  draftReply: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function noDbSupabase(): SupabaseClient {
  return createClient('http://localhost', 'jeju-chat-no-db') as unknown as SupabaseClient
}

function kstNowIso(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())}` +
    `T${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}:${pad(kst.getUTCSeconds())}+09:00`
  )
}

function extractAsOf(text: string): string | null {
  const full = text.match(/(\d{4})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})/)
  if (full) {
    return `${full[1]}-${full[2].padStart(2, '0')}-${full[3].padStart(2, '0')}`
  }
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const ym = text.match(/(\d{4})년\s*(\d{1,2})월/)
  if (ym) return `${ym[1]}-${ym[2].padStart(2, '0')}`
  return null
}

function extractJsonObject(raw: string): string {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i)
  if (fence?.[1]) text = fence[1].trim()
  if (text.startsWith('{')) return text
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  return start !== -1 && end > start ? text.slice(start, end + 1) : text
}

function lastUserText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user' && messages[i]!.content.trim()) {
      return messages[i]!.content.trim()
    }
  }
  return ''
}

function normalizeHistory(messages: ChatMessage[]): ChatMessage[] {
  const cleaned: ChatMessage[] = []
  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue
    const content = typeof m.content === 'string' ? m.content.trim() : ''
    if (!content) continue
    cleaned.push({ role: m.role, content })
  }
  return cleaned.slice(-MAX_HISTORY)
}

const DECLINE_REPLY =
  '저는 제주 전문 AI라 제주와 관련된 질문에 답해드려요. 제주 생활·여행·행정·날씨·문화 쪽으로 다시 물어보시면 도와드릴게요.'

// ── Strong Jeju system prompt (stable → Anthropic prompt caching) ─────────────

function buildSystemPrompt(today: string): string {
  return [
    `오늘은 ${today}입니다. 가장 최신 정보 위주로 답하세요.`,
    '',
    '당신은 "제주 전문 AI"입니다. 제주특별자치도에 대한 깊은 지역 전문성을 가진 도우미입니다.',
    '전문 영역: 지리(한라산·올레·오름·해안), 방언(제주어), 역사·문화, 행정(도청·시청·읍면동),',
    '생활(물가·배출·복지·의료), 관광, 1차산업(감귤·수산·축산), 날씨·재난, 교통(버스·항공·여객선),',
    '부동산·이주, 축제·행사, 환경 등 제주 전반.',
    '',
    '【범위 — Jeju-ONLY, 관대한 경계】',
    '- 제주와 연결할 수 있으면 제주 맥락으로 답하세요. 경계선 질문도 IN scope입니다.',
    '  예: "제주에서 김치찌개 맛집", "제주 이주 준비", "제주 전기차 보조금", "제주 방언".',
    '- 제주와 전혀 무관한 질문만 정중히 거절하세요.',
    '  거절 문구: "저는 제주 전문 AI라 제주와 관련된 질문에 답해드려요" + 제주 각도 제안.',
    '- 거절을 남용하지 마세요. 애매하면 제주 연결로 답하세요.',
    '',
    '【말투】',
    '- 한국어만. 성인 도민 대상 — 친절하되 유치하지 않게.',
    '- 인용 번호([1][3] 등)와 한자·중문·일문 문장부호(。「」 등)를 쓰지 마세요.',
    '- 확실하지 않으면 단정하지 말고, 확인이 필요하다고 말하세요.',
    '',
    '【검색 결과 활용】',
    '- 검색 자료가 주어지면 그 내용을 근거로 답하고, 검색에 없는 사실을 지어내지 마세요.',
    '- 검색 기반 답변에는 자연스럽게 최신성(날짜)을 반영하세요.',
  ].join('\n')
}

// ── FAQ cache intent (path 2) ─────────────────────────────────────────────────

/**
 * Recognize questions that map to already-cached resident chips.
 * Prefer cache over a fresh Perplexity call for today's 날씨/뉴스/물가/행사.
 */
export function detectCacheIntent(question: string): CacheIntent | null {
  const q = question.replace(/\s+/g, ' ').trim()
  if (!q) return null

  // Must be Jeju-ish or "오늘" local-life (resident chips are Jeju-scoped).
  const jejuish = /제주|제주시|서귀포|한라|올레|도민/.test(q) || /오늘|내일|이번\s*주|요즘/.test(q)

  // Policy / subsidy / "최신 소식" about a specific topic → NOT cache (needs search).
  // Prevents "전기차 보조금 최신 소식" from matching the news chip via "소식".
  if (/보조금|지원금|공고|모집|신청|정책|법령|고시|전기차|수소차|세금|요금\s*인상/.test(q)) {
    return null
  }
  if (/최신\s*(소식|뉴스|정보)|이번\s*주.+(소식|뉴스|공고)/.test(q) && !/날씨|기상|물가|축제|행사/.test(q)) {
    return null
  }

  if (/날씨|기상|특보|미세먼지|비\s*올|기온|강수|태풍|호우|바람/.test(q) && jejuish) {
    // Prefer weather over environment for "오늘 제주 날씨"
    if (!/배출|쓰레기|클린하우스|분리/.test(q)) return 'weather'
  }
  // News cache: only broad "오늘 뉴스/브리핑" — not topic-specific "소식"
  if (/^(오늘\s*)?(제주\s*)?(뉴스|브리핑|언론\s*소식|오늘의\s*소식)/.test(q) || /오늘.+(뉴스|브리핑)/.test(q)) {
    return 'news'
  }
  if (/물가|시세|장바구니|가격|감귤\s*값|계란\s*값|고등어\s*값/.test(q) && jejuish) return 'prices'
  if (/축제|행사|공연|전시|체험\s*강좌|도정|시정\s*행사|뭐\s*열려|일정/.test(q) && jejuish) {
    return 'events'
  }
  return null
}

async function pullCacheContext(intent: CacheIntent, errors: string[]): Promise<string> {
  try {
    if (intent === 'weather') {
      const r = await getWeatherAlert('제주시')
      if (!r.ok) {
        errors.push(`cache weather: ${r.error}`)
        return ''
      }
      const t = r.today
      const lines = [
        '[오늘 제주 날씨 캐시]',
        t
          ? `오늘: ${t.skyText ?? '—'}, 기온 ${t.tempC ?? '—'}℃, 강수확률 ${t.rainProb ?? '—'}%, 바람 ${t.windMs ?? '—'}m/s`
          : '오늘 예보: 정보 없음',
        r.tomorrow
          ? `내일: ${r.tomorrow.skyText ?? '—'}, ${r.tomorrow.tempMinC ?? '—'}~${r.tomorrow.tempMaxC ?? '—'}℃, 강수 ${r.tomorrow.rainProb ?? '—'}%`
          : '',
        r.warnings?.length
          ? `특보: ${r.warnings.map((w) => `${w.type}${w.level}(${w.area})`).join(', ')}`
          : '특보 없음',
        r.context ? `생활 기상 요약: ${r.context}` : '',
        r.freshnessNote,
      ]
      return lines.filter(Boolean).join('\n')
    }

    if (intent === 'news') {
      const r = await getNews()
      if (!r.ok) {
        errors.push(`cache news: ${r.error}`)
        return ''
      }
      const items = r.briefing.slice(0, 8)
      const lines = [
        `[오늘 제주 뉴스 캐시${r.fromCache ? ' (캐시 히트)' : ''}]`,
        ...items.map(
          (it, i) =>
            `${i + 1}. [${it.category}] ${it.headline} (${it.asOf ?? '?'}) — ${it.summary.slice(0, 120)}`,
        ),
        r.freshnessNote,
      ]
      return lines.join('\n')
    }

    if (intent === 'prices') {
      const r = await getPrices()
      if (!r.ok) {
        errors.push(`cache prices: ${r.error}`)
        return ''
      }
      const lines = ['[제주 물가 캐시]', `기준일: ${r.updated}`]
      for (const [g, items] of Object.entries(r.groups)) {
        if (!items?.length) continue
        lines.push(`· ${g}:`)
        for (const it of items.slice(0, 5)) {
          const dir = it.direction === 1 ? '↑' : it.direction === 0 ? '↓' : '─'
          lines.push(
            `  - ${it.itemName} ${it.retailPrice != null ? it.retailPrice.toLocaleString('ko-KR') + '원' : '—'} ${dir}${it.changePct != null ? it.changePct + '%' : ''}`,
          )
        }
      }
      if (r.context) lines.push(`생활물가 요약: ${r.context}`)
      lines.push(r.freshnessNote)
      return lines.join('\n')
    }

    // events
    const r = await getEvents()
    if (!r.ok) {
      errors.push(`cache events: ${r.error}`)
      return ''
    }
    const lines = [
      `[제주 축제·행사 캐시${r.fromCache ? ' (캐시 히트)' : ''}]`,
      `기간: ${r.today} ~ +${r.windowDays}일`,
    ]
    for (const [g, items] of Object.entries(r.groups)) {
      if (!items?.length) continue
      lines.push(`· ${g} (${items.length}):`)
      for (const ev of items.slice(0, 4)) {
        lines.push(
          `  - [${ev.status}] ${ev.title} ${ev.startDate ?? '?'}~${ev.endDate ?? '?'} @ ${ev.place ?? '—'}`,
        )
      }
    }
    lines.push(r.freshnessNote)
    return lines.join('\n')
  } catch (e: unknown) {
    errors.push(`cache ${intent}: ${e instanceof Error ? e.message : String(e)}`)
    return ''
  }
}

// ── Anthropic Sonnet (prompt-cached system) ───────────────────────────────────

/**
 * Direct Anthropic Messages call with ephemeral cache_control on the system
 * prompt so the long Jeju identity block is reused across turns (cost cut).
 * Falls back to runSingleAiProvider if the direct call fails.
 */
async function callSonnet(params: {
  system: string
  messages: ChatMessage[]
  maxTokens: number
  timeoutMs: number
  temperature?: number
}): Promise<{ text: string; error?: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    // Fallback via shared router (no prompt-cache header, but same model).
    try {
      const last = params.messages[params.messages.length - 1]
      const prior = params.messages.slice(0, -1)
      const r = await runSingleAiProvider({
        supabase: noDbSupabase(),
        sessionId: null,
        userId: null,
        provider: SONNET_PROVIDER,
        prompt: last?.content ?? '',
        systemPrompt: params.system,
        chatMessages: prior.length
          ? [...prior, { role: 'user' as const, content: last?.content ?? '' }]
          : undefined,
        modelOverride: SONNET_MODEL,
        maxCompletionTokens: params.maxTokens,
        timeoutMs: params.timeoutMs,
        temperature: params.temperature ?? 0.3,
        skipLanguageInjection: true,
      })
      if (r.error || !r.text?.trim()) return { text: '', error: r.error || 'empty' }
      return { text: r.text }
    } catch (e: unknown) {
      return { text: '', error: e instanceof Error ? e.message : String(e) }
    }
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: SONNET_MODEL,
        max_tokens: params.maxTokens,
        temperature: params.temperature ?? 0.3,
        system: [
          {
            type: 'text',
            text: params.system,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: params.messages.map((m) => ({ role: m.role, content: m.content })),
      }),
      signal: AbortSignal.timeout(params.timeoutMs),
    })
    const json = (await res.json()) as {
      content?: Array<{ type?: string; text?: string }>
      error?: { message?: string }
    }
    if (!res.ok) {
      return { text: '', error: json.error?.message || `HTTP ${res.status}` }
    }
    const text = Array.isArray(json.content)
      ? json.content.map((b) => b?.text).filter(Boolean).join('\n')
      : ''
    return { text: text || '', error: text ? undefined : 'empty' }
  } catch (e: unknown) {
    return { text: '', error: e instanceof Error ? e.message : String(e) }
  }
}

// ── Route decision (Sonnet) ───────────────────────────────────────────────────

async function decideRoute(
  messages: ChatMessage[],
  today: string,
  errors: string[],
): Promise<RouteDecision> {
  const system =
    buildSystemPrompt(today) +
    '\n\n【이번 턴 역할: 라우터】\n' +
    '사용자 최신 질문을 보고 아래 JSON만 출력하세요(설명·마크다운 금지):\n' +
    '{"route":"internal"|"search-deep"|"search-light"|"decline",' +
    '"searchQuery":"검색어 또는 null",' +
    '"draftReply":"internal/decline일 때 완성 답변, 아니면 null"}\n' +
    '- internal: 방언·지리·문화·역사 등 모델이 아는 제주 지식으로 충분. draftReply에 완성 답변.\n' +
    '- search-deep: 최신·정책·보조금·시사 등 근거가 필요. 사용자에게 검색 원문도 보여줄 것. searchQuery 필수.\n' +
    '- search-light: 가벼운 사실 확인. searchQuery 필수.\n' +
    '- decline: 제주와 전혀 무관. draftReply에 거절+제주 각도 제안.\n' +
    '애매하면 decline하지 말고 search-light 또는 internal.'

  const r = await callSonnet({
    system,
    messages,
    maxTokens: 700,
    timeoutMs: ROUTE_TIMEOUT_MS,
    temperature: 0.1,
  })
  if (r.error || !r.text.trim()) {
    errors.push(`route: ${r.error || 'empty'}`)
    // Safe default: try light search with the user question
    return { route: 'search-light', searchQuery: lastUserText(messages), draftReply: null }
  }

  try {
    const parsed = JSON.parse(extractJsonObject(r.text)) as Record<string, unknown>
    const routeRaw = typeof parsed.route === 'string' ? parsed.route : ''
    const route: RouteDecision['route'] =
      routeRaw === 'internal' ||
      routeRaw === 'search-deep' ||
      routeRaw === 'search-light' ||
      routeRaw === 'decline'
        ? routeRaw
        : 'search-light'
    const searchQuery =
      typeof parsed.searchQuery === 'string' && parsed.searchQuery.trim()
        ? parsed.searchQuery.trim()
        : null
    const draftReply =
      typeof parsed.draftReply === 'string' && parsed.draftReply.trim()
        ? cleanPerplexityText(parsed.draftReply)
        : null
    return { route, searchQuery, draftReply }
  } catch {
    errors.push('route: JSON parse failed')
    return { route: 'search-light', searchQuery: lastUserText(messages), draftReply: null }
  }
}

// ── Perplexity search (path 3) ────────────────────────────────────────────────

async function runSearch(
  query: string,
  today: string,
  deep: boolean,
  errors: string[],
): Promise<{ raw: string; meta: ContextMeta }> {
  const retrievedAt = kstNowIso()
  const systemPrompt =
    `오늘은 ${today}입니다. 가장 최신 제주 관련 정보 위주로 답하라. ` +
    '한국어로만. 인용 번호([1][3] 등)와 한자·중문·일문 문장부호(。「」 등)를 쓰지 마세요. ' +
    (deep
      ? '핵심 사실·날짜·출처(기관/언론)를 포함해 상세히 정리하세요.'
      : '핵심만 2~4문장으로 짧게 정리하세요.')

  // Prefer dedicated resident-search helper (returns raw text); fall back to router.
  let text = ''
  try {
    const a = await askPerplexity(
      `제주 관련: ${query}`,
      { systemPrompt, maxTokens: deep ? 1200 : 500, timeoutMs: SEARCH_TIMEOUT_MS },
    )
    text = a.text
  } catch (e: unknown) {
    errors.push(`search askPerplexity: ${e instanceof Error ? e.message : String(e)}`)
  }

  if (!text.trim()) {
    try {
      const r = await runSingleAiProvider({
        supabase: noDbSupabase(),
        sessionId: null,
        userId: null,
        provider: PERPLEXITY_PROVIDER,
        prompt: `제주 관련: ${query}`,
        systemPrompt,
        maxCompletionTokens: deep ? 1200 : 500,
        timeoutMs: SEARCH_TIMEOUT_MS,
        skipLanguageInjection: true,
      })
      if (r.error || !r.text?.trim()) {
        errors.push(`search: ${r.error || 'empty'}`)
      } else {
        text = r.text
      }
    } catch (e: unknown) {
      errors.push(`search router: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const cleaned = text ? cleanPerplexityText(text) : ''
  return {
    raw: cleaned,
    meta: { source: '검색', retrievedAt, asOf: extractAsOf(cleaned) ?? today },
  }
}

// ── Final reply synthesis ─────────────────────────────────────────────────────

async function synthesizeReply(params: {
  messages: ChatMessage[]
  today: string
  cacheContext?: string
  searchRaw?: string
  deep?: boolean
  errors: string[]
}): Promise<string> {
  const { messages, today, cacheContext, searchRaw, deep, errors } = params
  let system = buildSystemPrompt(today)

  if (cacheContext) {
    system +=
      '\n\n【내부 캐시 자료 — 오늘 도민 칩에서 가져온 것】\n' +
      cacheContext +
      '\n위 자료를 우선 근거로 사용자 질문에 답하세요. 자료에 없으면 모른다고 하세요.'
  }
  if (searchRaw) {
    system +=
      '\n\n【🔍 검색 결과】\n' +
      searchRaw +
      (deep
        ? '\n위 검색 결과를 분석·요약해 답하세요. 검색에 없는 사실은 추가하지 마세요.'
        : '\n위 검색 결과를 반영해 자연스럽게 답하세요. 검색 출처를 드러내되 원문을 길게 반복하지 마세요.')
  }

  const r = await callSonnet({
    system,
    messages,
    maxTokens: 900,
    timeoutMs: REPLY_TIMEOUT_MS,
    temperature: 0.4,
  })
  if (r.error || !r.text.trim()) {
    errors.push(`reply: ${r.error || 'empty'}`)
    if (searchRaw) return cleanPerplexityText(searchRaw.slice(0, 800))
    if (cacheContext) return '캐시된 제주 자료는 있으나 답변 생성에 실패했어요. 잠시 후 다시 시도해 주세요.'
    return '지금은 답변을 만들지 못했어요. 잠시 후 다시 물어봐 주세요.'
  }
  return cleanPerplexityText(r.text)
}

// ── Public entry ──────────────────────────────────────────────────────────────

/**
 * Answer one Jeju-specialist chat turn.
 * Never throws; degrades to a polite error reply + errors[].
 */
export async function chatJeju(opts: ChatOptions): Promise<ChatResult> {
  const errors: string[] = []
  const today = kstTodayIso()
  const messages = normalizeHistory(opts.messages ?? [])
  const question = lastUserText(messages)

  if (!question) {
    return { ok: false, error: '질문이 비어 있어요.' }
  }

  try {
    // ── Path 2: FAQ cache reuse (before Sonnet route — saves a round-trip) ──
    const cacheIntent = detectCacheIntent(question)
    if (cacheIntent) {
      console.log('[jeju-chat] cache intent →', cacheIntent)
      const cacheContext = await pullCacheContext(cacheIntent, errors)
      if (cacheContext) {
        const reply = await synthesizeReply({ messages, today, cacheContext, errors })
        return {
          ok: true,
          reply,
          usedSearch: false,
          searchRaw: null,
          contextMeta: {
            source: '검색',
            retrievedAt: kstNowIso(),
            asOf: today,
          },
          routedVia: 'cache',
          errors,
        }
      }
      // Cache miss / empty → fall through to Sonnet routing
      errors.push(`cache ${cacheIntent}: empty — falling through`)
    }

    // ── Sonnet routing judgment ─────────────────────────────────────────────
    const decision = await decideRoute(messages, today, errors)
    console.log('[jeju-chat] route →', decision.route, decision.searchQuery ?? '')

    if (decision.route === 'decline') {
      return {
        ok: true,
        reply: decision.draftReply || DECLINE_REPLY,
        usedSearch: false,
        searchRaw: null,
        contextMeta: null,
        routedVia: 'internal',
        errors,
      }
    }

    if (decision.route === 'internal') {
      const reply =
        decision.draftReply ||
        (await synthesizeReply({ messages, today, errors }))
      return {
        ok: true,
        reply,
        usedSearch: false,
        searchRaw: null,
        contextMeta: null,
        routedVia: 'internal',
        errors,
      }
    }

    // ── Path 3: Perplexity search (deep or light), ≤2 calls ─────────────────
    const deep = decision.route === 'search-deep'
    const query = decision.searchQuery || question
    let pplxCalls = 0
    const { raw, meta } = await runSearch(query, today, deep, errors)
    pplxCalls++

    // Optional second call only if first empty and we still have budget
    let searchRaw = raw
    let contextMeta = meta
    if (!searchRaw && pplxCalls < MAX_PPLX_PER_TURN) {
      const retry = await runSearch(`${query} 제주 ${today}`, today, deep, errors)
      pplxCalls++
      if (retry.raw) {
        searchRaw = retry.raw
        contextMeta = retry.meta
      }
    }

    const reply = await synthesizeReply({
      messages,
      today,
      searchRaw: searchRaw || undefined,
      deep,
      errors,
    })

    // Provenance is surfaced by the frontend via contextMeta — do not embed in reply text.
    return {
      ok: true,
      reply,
      usedSearch: true,
      searchRaw: deep && searchRaw ? searchRaw : null,
      contextMeta,
      routedVia: deep ? 'search-deep' : 'search-light',
      errors,
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      ok: true,
      reply: '지금은 답변을 만들지 못했어요. 잠시 후 다시 물어봐 주세요.',
      usedSearch: false,
      searchRaw: null,
      contextMeta: null,
      routedVia: 'internal',
      errors: [...errors, msg],
    }
  }
}
