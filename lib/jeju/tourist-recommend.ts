import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { runSingleAiProvider, type ExtendedAiProviderName } from '@/lib/ai/router'
import {
  getVisitJejuPool,
  fetchVisitJejuPlaces,
  filterPlacesByQuery,
  type VisitJejuPlace,
} from '@/lib/jeju/connectors'
import {
  languageDirective,
  languageReminder,
  warnIfWrongLanguage,
  type AiLocale,
} from '@/lib/jeju/ai-locale'

/**
 * Jeju TOURIST mode — free-text place recommendation engine.
 *
 * DESIGN CONSTRAINTS (same isolation discipline as lib/jeju/brief.ts):
 *   - 'server-only'. Both AI calls use runSingleAiProvider with sessionId:null +
 *     userId:null (NO credit/DB logging, no BYOK reads — noDbSupabase() is never
 *     dereferenced for I/O).
 *   - MUST NOT import app/api/synod/* or any AIMANI compare/credit session runner.
 *
 * TWO-CALL FLOW (VisitJeju has NO keyword-search API):
 *   1. KEYWORD EXTRACTION (google / gemini-3.5-flash, cheap+fast): turn the user
 *      query into 5–10 Korean keywords used ONLY to shrink the ~1,429-place pool.
 *   2. POOL REDUCTION: filterPlacesByQuery is a crude substring filter that
 *      OVER-matches (e.g. '체험' pulls in scuba). That's fine — it's just to cut
 *      1429 → a few hundred candidates. Precision is the AI's job, not the filter.
 *   3. FINAL SELECTION (anthropic / claude-sonnet-4-6): the concierge picks the
 *      genuinely-fitting 3–6 places by INDEX into the candidate list. Anti-
 *      hallucination: only valid indices are honored; invalid ones are dropped.
 *
 * Never throws — every failure path returns { ok: false, error }.
 */

/** Sonnet tier: Korean recommendation quality matters; default model, no override. */
const SELECTION_PROVIDER: ExtendedAiProviderName = 'anthropic'
/** Flash tier: cheap/fast keyword extraction; default model (gemini-3.5-flash). */
const KEYWORD_PROVIDER: ExtendedAiProviderName = 'google'

/** Selection: JSON with one sentence + up to 10 indices, ordered by relevance. */
const SELECTION_MAX_TOKENS = 1400
/** Keyword extraction: a short JSON array of 5–10 words. */
const KEYWORD_MAX_TOKENS = 200

/** Min/max picks the concierge may return. */
const MIN_PICKS = 3
const MAX_PICKS = 10

/** Cap candidate list size so the selection prompt stays sane. */
const MAX_CANDIDATES = 140
/** Size of the category-balanced fallback sample when the filter finds nothing. */
const FALLBACK_SAMPLE_SIZE = 60

const GENERIC_FAIL = '추천을 불러오지 못했어요. 다시 시도해 주세요.'

/**
 * Throwaway Supabase client to satisfy runSingleAiProvider's required param.
 * With sessionId:null + userId:null the router does NO DB inserts and NO BYOK
 * reads, so this client is never dereferenced for I/O. Mirrors brief.ts.
 */
function noDbSupabase(): SupabaseClient {
  return createClient('http://localhost', 'tourist-recommend-no-db') as unknown as SupabaseClient
}

/** Strips ``` / ```json fences and returns the inner JSON-ish text. */
function stripFences(raw: string): string {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i)
  if (fence && fence[1]) text = fence[1].trim()
  return text
}

/** Extracts the first {...} object substring (for object-shaped JSON). */
function extractJsonObject(raw: string): string {
  const text = stripFences(raw)
  if (text.startsWith('{')) return text
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  return start !== -1 && end > start ? text.slice(start, end + 1) : text
}

/** Extracts the first [...] array substring (for array-shaped JSON). */
function extractJsonArray(raw: string): string {
  const text = stripFences(raw)
  if (text.startsWith('[')) return text
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  return start !== -1 && end > start ? text.slice(start, end + 1) : text
}

// ── Step 1: keyword extraction (flash) ────────────────────────────────────────

function buildKeywordSystemPrompt(): string {
  return [
    '당신은 제주 여행 검색을 돕는 도우미입니다.',
    '사용자 질문에서 제주 장소를 찾기 위한 핵심 키워드 5~10개를 한국어로 추출하세요.',
    "예: 사용자가 '비 오는 날 실내'면 ['실내','박물관','미술관','전시','카페','체험관','아쿠아리움'].",
    'JSON 배열만 출력하세요. 다른 설명·마크다운은 절대 출력하지 마세요.',
  ].join('\n')
}

/** Splits a query into space-delimited fallback keywords (drops trivially short tokens). */
function fallbackKeywords(query: string): string[] {
  return query
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2)
}

/**
 * Asks a cheap model for pool-reduction keywords. Sends ONLY the query text to
 * the model API (Korean in a model prompt is fine — that's not the VisitJeju
 * firewall). Falls back to splitting the query on failure. Never throws.
 */
async function extractKeywords(query: string): Promise<string[]> {
  try {
    const r = await runSingleAiProvider({
      supabase: noDbSupabase(),
      sessionId: null,
      userId: null,
      provider: KEYWORD_PROVIDER,
      prompt: `[사용자 질문]\n${query}\n\n위 질문에서 장소 검색용 핵심 키워드 5~10개를 JSON 배열로만 출력하세요.`,
      systemPrompt: buildKeywordSystemPrompt(),
      maxCompletionTokens: KEYWORD_MAX_TOKENS,
    })

    if (r.error || !r.text || !r.text.trim()) return fallbackKeywords(query)

    let parsed: unknown
    try {
      parsed = JSON.parse(extractJsonArray(r.text))
    } catch {
      return fallbackKeywords(query)
    }

    if (!Array.isArray(parsed)) return fallbackKeywords(query)
    const keywords = parsed
      .filter((k): k is string => typeof k === 'string')
      .map((k) => k.trim())
      .filter((k) => k !== '')
    return keywords.length > 0 ? keywords : fallbackKeywords(query)
  } catch {
    return fallbackKeywords(query)
  }
}

// ── Step 3 helpers: candidate sampling + selection prompt ─────────────────────

/**
 * Category-balanced sample used when the keyword filter matches nothing — so the
 * concierge always has a diverse set to choose from. Round-robins by categoryCode.
 */
function balancedSample(pool: VisitJejuPlace[], size: number): VisitJejuPlace[] {
  const buckets = new Map<string, VisitJejuPlace[]>()
  for (const p of pool) {
    const key = p.categoryCode || 'etc'
    const arr = buckets.get(key) ?? []
    arr.push(p)
    buckets.set(key, arr)
  }
  const lists = Array.from(buckets.values())
  const out: VisitJejuPlace[] = []
  for (let i = 0; out.length < size && lists.some((l) => i < l.length); i++) {
    for (const list of lists) {
      if (i < list.length) {
        out.push(list[i]!)
        if (out.length >= size) break
      }
    }
  }
  return out
}

/** One compact line per candidate: index + title + category + region + tags + intro. */
function buildCandidateList(places: VisitJejuPlace[]): string {
  return places
    .map((p, i) => {
      const tags = p.tags.slice(0, 4).join(', ')
      const intro = p.introduction ? p.introduction.slice(0, 50) : ''
      return [
        `${i}. ${p.title}`,
        `[${p.categoryLabel}]`,
        p.region ? `(${p.region})` : '',
        tags ? `태그: ${tags}` : '',
        intro ? `소개: ${intro}` : '',
      ]
        .filter((s) => s !== '')
        .join(' ')
    })
    .join('\n')
}

function buildSelectionSystemPrompt(locale: AiLocale): string {
  return [
    // Forceful language rule FIRST (sandwiched with a reminder at the end).
    languageDirective(locale),
    '',
    '당신은 제주 여행을 안내하는 친근한 컨시어지입니다.',
    '사용자의 요청을 듣고, 아래에 제공되는 후보 장소 목록 중에서 요청의 의도에 정말로 잘 맞는 곳을 골라 추천합니다.',
    '',
    '엄수 규칙:',
    '- 반드시 제공된 후보 목록에 있는 장소만 고르세요. 목록에 없는 장소를 절대 지어내지 마세요.',
    '- 추천은 후보 목록의 인덱스(번호)로만 지정하세요. 목록에 존재하지 않는 번호는 절대 사용하지 마세요.',
    '- 요청의 진짜 의도에 맞는 곳만 고르세요. 예를 들어 "비 오는 날"이면 실제로 실내에서 즐길 수 있는 곳을 고르고, 단어만 "체험"이 들어간 야외 활동(예: 스쿠버다이빙)은 제외하세요.',
    `- ${MIN_PICKS}~${MAX_PICKS}곳을 고르세요. 단, 정말로 맞는 곳이 적으면 무리하게 채우지 말고 더 적게 골라도 됩니다(빈약한 매칭으로 개수를 채우지 마세요).`,
    '- picks 배열은 반드시 관련도 순(가장 잘 맞는 곳이 첫 번째)으로 정렬하세요. 확실히 잘 맞는 곳을 앞에, "보너스로 가볼 만한 곳"은 뒤에 배치합니다.',
    '- 도움이 된다면 솔직한 주의사항(예: 성수기 웨이팅, 유료 입장)을 intro에 짧게 덧붙여도 좋습니다. 단, 없는 단점을 지어내지 마세요.',
    '',
    '출력 형식(엄수): 아래 형태의 JSON 객체 하나만 출력하세요. JSON 외의 설명·마크다운·인사말은 절대 출력하지 마세요.',
    'intro는 반드시 출력 언어로 작성하세요. 장소 고유명사가 들어가면 위 언어 규칙대로 한국어 원문을 유지하세요.',
    '{ "intro": "<one warm sentence summarizing the picks, in the output language>", "picks": [<integer indices from the candidate list>] }',
    languageReminder(locale),
  ]
    .filter((s) => s !== '')
    .join('\n')
}

/** Locale-aware fallback for the concierge intro line (used when the model omits one). */
function fallbackIntro(locale: AiLocale): string {
  switch (locale) {
    case 'en':
      return "Here are some spots that suit the Jeju trip you're looking for."
    case 'ja':
      return 'ご希望の済州旅行にぴったりの場所を選んでみました。'
    case 'zh-TW':
      return '為您挑選了幾個適合這趟濟州行程的地方。'
    case 'zh-CN':
      return '为您挑选了几个适合这趟济州行程的地方。'
    case 'ko':
    default:
      return '요청하신 제주 여행에 어울리는 곳들을 골라봤어요.'
  }
}

function buildSelectionUserPrompt(query: string, candidateList: string): string {
  return [
    '[사용자 요청]',
    query,
    '',
    '[후보 장소 목록]',
    candidateList,
    '',
    `위 후보 중에서 사용자 요청의 의도에 정말로 잘 맞는 ${MIN_PICKS}~${MAX_PICKS}곳을 골라 JSON으로만 답하세요.`,
  ].join('\n')
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function recommendJejuPlaces({
  query,
  locale = 'ko',
}: {
  query: string
  locale?: AiLocale
}): Promise<
  | { ok: true; intro: string; recommendations: VisitJejuPlace[] }
  | { ok: false; error: string }
> {
  try {
    const trimmed = query?.trim()
    if (!trimmed) return { ok: false, error: GENERIC_FAIL }

    // 1. Pool — large cached pool, with the old 32-place set as a safety net.
    let pool = await getVisitJejuPool()
    if (pool.length === 0) {
      const fallback = await fetchVisitJejuPlaces()
      pool = fallback.ok ? fallback.places : []
    }
    if (pool.length === 0) return { ok: false, error: GENERIC_FAIL }

    // 2. Keyword extraction (flash) → crude pool reduction (substring filter).
    const keywords = await extractKeywords(trimmed)
    let candidates = filterPlacesByQuery(pool, keywords)

    // No substring hits → give the concierge a balanced sample instead of nothing.
    if (candidates.length === 0) {
      candidates = balancedSample(pool, FALLBACK_SAMPLE_SIZE)
    }
    // Keep the selection prompt a sane size.
    if (candidates.length > MAX_CANDIDATES) {
      candidates = candidates.slice(0, MAX_CANDIDATES)
    }
    if (candidates.length === 0) return { ok: false, error: GENERIC_FAIL }

    // 3. Final selection (sonnet) — precise, index-only, anti-hallucination.
    const r = await runSingleAiProvider({
      supabase: noDbSupabase(),
      sessionId: null,
      userId: null,
      provider: SELECTION_PROVIDER,
      prompt: buildSelectionUserPrompt(trimmed, buildCandidateList(candidates)),
      systemPrompt: buildSelectionSystemPrompt(locale),
      maxCompletionTokens: SELECTION_MAX_TOKENS,
    })

    if (r.error || !r.text || !r.text.trim()) {
      return { ok: false, error: GENERIC_FAIL }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(extractJsonObject(r.text))
    } catch {
      return { ok: false, error: GENERIC_FAIL }
    }
    if (!parsed || typeof parsed !== 'object') {
      return { ok: false, error: GENERIC_FAIL }
    }

    const obj = parsed as Record<string, unknown>
    const intro = typeof obj.intro === 'string' ? obj.intro.trim() : ''
    if (intro) warnIfWrongLanguage(intro, locale, 'tourist-recommend')
    const picksRaw = Array.isArray(obj.picks) ? obj.picks : []

    // Map indices back to real places; drop out-of-range/duplicate (defensive
    // against a hallucinated index — the AI can only surface real candidates).
    const seen = new Set<number>()
    const recommendations: VisitJejuPlace[] = []
    for (const idx of picksRaw) {
      const n = typeof idx === 'number' ? idx : Number(idx)
      if (!Number.isInteger(n) || n < 0 || n >= candidates.length || seen.has(n)) continue
      seen.add(n)
      recommendations.push(candidates[n]!)
      if (recommendations.length >= MAX_PICKS) break
    }

    if (recommendations.length === 0) {
      return { ok: false, error: GENERIC_FAIL }
    }

    return {
      ok: true,
      intro: intro || fallbackIntro(locale),
      recommendations,
    }
  } catch {
    return { ok: false, error: GENERIC_FAIL }
  }
}
