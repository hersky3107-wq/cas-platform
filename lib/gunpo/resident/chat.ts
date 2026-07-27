import 'server-only'

/**
 * Gunpo-specialist chatbot — 시민(resident) mode. Cloned from lib/jeju/chat.ts.
 * Consumed by POST /api/gunpo/resident/chat.
 *
 * Single model: Anthropic Sonnet (claude-sonnet-4-6) — routing judgment +
 * Perplexity-result analysis + conversational reply.
 *
 * Search routing (3 paths):
 *   1. INTERNAL — known Gunpo facts → answer directly (no Perplexity)
 *   2. FAQ CACHE — reuse today's 날씨/뉴스/행사 chip caches (물가 chip was not
 *      ported for Gunpo — see STEP3 scope — so 'prices' intent is dropped)
 *   3. SEARCH — Perplexity (deep = visible searchRaw + analysis; light = woven)
 * Cap: ≤2 Perplexity calls per user turn.
 *
 * ISOLATION: 'server-only'; sessionId/userId null. MUST NOT import lib/jeju or
 * lib/motie. Never throws.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { runSingleAiProvider, type ExtendedAiProviderName } from '@/lib/ai/router'
import { getEvents } from './events'
import { getNews } from './news'
import { askPerplexity, cleanPerplexityText, extractAsOf, extractJsonObject, kstNowIso, kstTodayIso, type ContextMeta } from './shared'
import { getGunpoWeatherAlert } from './weather'

// ── Constants ─────────────────────────────────────────────────────────────────

const SONNET_MODEL = 'claude-sonnet-4-6'
const SONNET_PROVIDER: ExtendedAiProviderName = 'anthropic'
const PERPLEXITY_PROVIDER: ExtendedAiProviderName = 'perplexity'

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

type CacheIntent = 'weather' | 'news' | 'events'

type RouteDecision = {
  route: ChatRoute | 'decline'
  searchQuery: string | null
  draftReply: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function noDbSupabase(): SupabaseClient {
  return createClient('http://localhost', 'gunpo-chat-no-db') as unknown as SupabaseClient
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
  '저는 군포 전문 AI라 경기도 군포시와 관련된 질문에 답해드려요. 군포 생활·행정·날씨·문화 쪽으로 다시 물어보시면 도와드릴게요.'

// ── Strong Gunpo system prompt (stable → Anthropic prompt caching) ────────────

function buildSystemPrompt(today: string): string {
  return [
    `오늘은 ${today}입니다. 가장 최신 정보 위주로 답하세요.`,
    '',
    '당신은 "군포 전문 AI"입니다. 경기도 군포시에 대한 깊은 지역 전문성을 가진 도우미입니다.',
    '전문 영역: 지리(수리산·철쭉동산·산본천), 행정(군포시청·산본1동/산본2동/금정동 행정복지센터),',
    '생활(복지·행정 민원), 교통, 부동산, 축제·행사, 환경, 날씨·재난 등 군포 전반.',
    '',
    '【범위 — Gunpo-ONLY, 관대한 경계】',
    '- 군포와 연결할 수 있으면 군포 맥락으로 답하세요. 경계선 질문도 IN scope입니다.',
    '  예: "군포에서 맛집", "군포 이주 준비", "군포 전기차 충전소", "산본 학군".',
    '- 군포와 전혀 무관한 질문만 정중히 거절하세요.',
    '  거절 문구: "저는 군포 전문 AI라 군포와 관련된 질문에 답해드려요" + 군포 각도 제안.',
    '- 거절을 남용하지 마세요. 애매하면 군포 연결로 답하세요.',
    '',
    '【말투】',
    '- 한국어만. 성인 시민 대상 — 친절하되 유치하지 않게.',
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
 * Prefer cache over a fresh Perplexity call for today's 날씨/뉴스/행사.
 * NOTE: 물가(prices) chip was not ported for Gunpo — see STEP3 scope — so
 * there is no 'prices' intent here (unlike lib/jeju/chat.ts).
 */
export function detectCacheIntent(question: string): CacheIntent | null {
  const q = question.replace(/\s+/g, ' ').trim()
  if (!q) return null

  const gunpoish = /군포|산본|금정/.test(q) || /오늘|내일|이번\s*주|요즘/.test(q)

  if (/보조금|지원금|공고|모집|신청|정책|법령|고시|전기차|수소차|세금|요금\s*인상/.test(q)) {
    return null
  }
  if (/최신\s*(소식|뉴스|정보)|이번\s*주.+(소식|뉴스|공고)/.test(q) && !/날씨|기상|축제|행사/.test(q)) {
    return null
  }

  if (/날씨|기상|특보|미세먼지|비\s*올|기온|강수|태풍|호우|바람/.test(q) && gunpoish) {
    if (!/배출|쓰레기|클린하우스|분리/.test(q)) return 'weather'
  }
  if (/^(오늘\s*)?(군포\s*)?(뉴스|브리핑|언론\s*소식|오늘의\s*소식)/.test(q) || /오늘.+(뉴스|브리핑)/.test(q)) {
    return 'news'
  }
  if (/축제|행사|공연|전시|체험\s*강좌|시정\s*행사|뭐\s*열려|일정/.test(q) && gunpoish) {
    return 'events'
  }
  return null
}

async function pullCacheContext(intent: CacheIntent, errors: string[]): Promise<string> {
  try {
    if (intent === 'weather') {
      const r = await getGunpoWeatherAlert()
      if (!r.ok) {
        errors.push(`cache weather: ${r.error}`)
        return ''
      }
      const lines = [
        '[오늘 군포 날씨 캐시]',
        r.current.text ? `초단기실황: ${r.current.text}` : '초단기실황: 정보 없음(TODO 파라미터 미설정)',
        r.midterm.text ? `중기예보: ${r.midterm.text}` : '',
        r.warning.text ? `기상특보: ${r.warning.text}` : '기상특보: 없음/정보 없음',
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
        `[오늘 군포 뉴스 캐시${r.fromCache ? ' (캐시 히트)' : ''}]`,
        ...items.map(
          (it, i) =>
            `${i + 1}. [${it.category}] ${it.headline} (${it.asOf ?? '?'}) — ${it.summary.slice(0, 120)}`,
        ),
        r.freshnessNote,
      ]
      return lines.join('\n')
    }

    // events
    const r = await getEvents()
    if (!r.ok) {
      errors.push(`cache events: ${r.error}`)
      return ''
    }
    const lines = [
      `[군포 축제·행사 캐시${r.fromCache ? ' (캐시 히트)' : ''}]`,
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

async function callSonnet(params: {
  system: string
  messages: ChatMessage[]
  maxTokens: number
  timeoutMs: number
  temperature?: number
}): Promise<{ text: string; error?: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
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
    '- internal: 지리·문화·행정 절차 등 모델이 아는 군포 지식으로 충분. draftReply에 완성 답변.\n' +
    '- search-deep: 최신·정책·보조금·시사 등 근거가 필요. 사용자에게 검색 원문도 보여줄 것. searchQuery 필수.\n' +
    '- search-light: 가벼운 사실 확인. searchQuery 필수.\n' +
    '- decline: 군포와 전혀 무관. draftReply에 거절+군포 각도 제안.\n' +
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
    `오늘은 ${today}입니다. 가장 최신 경기도 군포시 관련 정보 위주로 답하라. ` +
    '한국어로만. 인용 번호([1][3] 등)와 한자·중문·일문 문장부호(。「」 등)를 쓰지 마세요. ' +
    (deep
      ? '핵심 사실·날짜·출처(기관/언론)를 포함해 상세히 정리하세요.'
      : '핵심만 2~4문장으로 짧게 정리하세요.')

  let text = ''
  try {
    const a = await askPerplexity(`경기도 군포시 관련: ${query}`, {
      systemPrompt,
      maxTokens: deep ? 1200 : 500,
      timeoutMs: SEARCH_TIMEOUT_MS,
    })
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
        prompt: `경기도 군포시 관련: ${query}`,
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
      '\n\n【내부 캐시 자료 — 오늘 시민 칩에서 가져온 것】\n' +
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
    if (cacheContext) return '캐시된 군포 자료는 있으나 답변 생성에 실패했어요. 잠시 후 다시 시도해 주세요.'
    return '지금은 답변을 만들지 못했어요. 잠시 후 다시 물어봐 주세요.'
  }
  return cleanPerplexityText(r.text)
}

// ── Public entry ──────────────────────────────────────────────────────────────

/**
 * Answer one Gunpo-specialist chat turn.
 * Never throws; degrades to a polite error reply + errors[].
 */
export async function chatGunpo(opts: ChatOptions): Promise<ChatResult> {
  const errors: string[] = []
  const today = kstTodayIso()
  const messages = normalizeHistory(opts.messages ?? [])
  const question = lastUserText(messages)

  if (!question) {
    return { ok: false, error: '질문이 비어 있어요.' }
  }

  try {
    const cacheIntent = detectCacheIntent(question)
    if (cacheIntent) {
      console.log('[gunpo-chat] cache intent →', cacheIntent)
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
      errors.push(`cache ${cacheIntent}: empty — falling through`)
    }

    const decision = await decideRoute(messages, today, errors)
    console.log('[gunpo-chat] route →', decision.route, decision.searchQuery ?? '')

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
      const reply = decision.draftReply || (await synthesizeReply({ messages, today, errors }))
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

    const deep = decision.route === 'search-deep'
    const query = decision.searchQuery || question
    let pplxCalls = 0
    const { raw, meta } = await runSearch(query, today, deep, errors)
    pplxCalls++

    let searchRaw = raw
    let contextMeta = meta
    if (!searchRaw && pplxCalls < MAX_PPLX_PER_TURN) {
      const retry = await runSearch(`${query} 군포 ${today}`, today, deep, errors)
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
