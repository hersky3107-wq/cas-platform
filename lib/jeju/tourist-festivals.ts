import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { runSingleAiProvider, type ExtendedAiProviderName } from '@/lib/ai/router'

/**
 * Jeju TOURIST mode — CURRENT/UPCOMING festivals via real-time web search.
 *
 * DESIGN CONSTRAINTS (same isolation discipline as lib/jeju/tourist-local.ts):
 *   - 'server-only'. One runSingleAiProvider call with sessionId:null + userId:null
 *     (NO credit/DB logging, no BYOK reads — noDbSupabase() is never dereferenced).
 *   - MUST NOT import app/api/synod/* or any AIMANI compare/credit session runner.
 *
 * WHY WEB SEARCH (not VisitJeju c5): the official c5 listings carry NO structured
 * dates — schedules are buried in natural-language intro text, often without a
 * year — so a static DB + cheap model can't reliably tell "happening this week"
 * from "ended last November". "What's on right now" is inherently real-time info,
 * which Perplexity (sonar) handles well (proven in tourist-local.ts). So we ask
 * sonar directly for currently-running/upcoming Jeju festivals as of `today`.
 * Every result is source:'web'. Never throws.
 */

/** Perplexity sonar — real-time web retrieval. Default model (sonar), no override. */
const FESTIVAL_PROVIDER: ExtendedAiProviderName = 'perplexity'

/** Room for 4–8 festivals with periods + cautions in token-dense Korean. */
const FESTIVAL_MAX_TOKENS = 1200

const GENERIC_FAIL = '축제 정보를 불러오지 못했어요. 다시 시도해 주세요.'

/**
 * A festival/event found via real-time web search. `source` is always 'web'
 * (set in code, never requested from the model). `period` is free-text since
 * sonar reports dates in varied natural-language forms.
 */
export interface FestivalItem {
  name: string
  area: string | null
  period: string | null
  description: string
  caution: string | null
  source: 'web'
}

/**
 * Throwaway Supabase client to satisfy runSingleAiProvider's required param.
 * With sessionId:null + userId:null the router does NO DB inserts and NO BYOK
 * reads, so this client is never dereferenced for I/O. Mirrors tourist-local.ts.
 */
function noDbSupabase(): SupabaseClient {
  return createClient('http://localhost', 'tourist-festivals-no-db') as unknown as SupabaseClient
}

/** Strips ``` / ```json fences, then extracts the first {...} object substring. */
function extractJsonObject(raw: string): string {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i)
  if (fence && fence[1]) text = fence[1].trim()
  if (text.startsWith('{')) return text
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  return start !== -1 && end > start ? text.slice(start, end + 1) : text
}

/** Coerces an unknown into a trimmed string, or null when empty/absent/"null". */
function toStrOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s !== '' && s.toLowerCase() !== 'null' ? s : null
}

function buildSystemPrompt(today: string): string {
  return [
    '당신은 제주 축제·행사 일정에 밝은 로컬 안내자입니다.',
    `오늘은 ${today} 입니다. 반드시 ${today} 기준 최신 정보를 우선해서 웹에서 찾아주세요.`,
    `제주에서 지금(이번 주~이번 달) 실제로 열리고 있거나 곧 열리는 축제·행사·공연·전시를 찾아주세요.`,
    '',
    '엄수 규칙(매우 중요):',
    `- 반드시 ${today} 기준으로 현재 진행 중이거나 앞으로 예정인 것만 추천하세요. 이미 끝난 행사는 절대 제외하세요.`,
    '- 실제로 존재하고 일정이 확인되는 행사만 포함하세요. 정보가 불확실하면 caution에 솔직히 명시하세요.',
    '- 존재하지 않는 행사를 지어내지 마세요. 날짜·장소가 확실하지 않으면 포함하지 마세요.',
    '- 일정이 변동될 수 있으면 caution에 명시하세요.',
    '',
    '출력 형식(엄수): 아래 형태의 JSON 객체 하나만 출력하세요. JSON 외의 설명·마크다운·인사말·각주는 절대 출력하지 마세요.',
    '{ "festivals": [ { "name": "<행사명>", "area": "<지역(예: 제주시, 서귀포 성산), 모르면 null>", "period": "<행사 기간/날짜 텍스트, 모르면 null>", "description": "<한 줄 한국어 소개>", "caution": "<일정 불확실·변동 가능 등 주의사항, 없으면 null>" } ] }',
  ].join('\n')
}

function buildUserPrompt(today: string): string {
  return [
    `오늘(${today}) 기준으로, 제주에서 지금 열리고 있거나 곧 열리는 축제·행사·공연·전시 4~8개를 찾아 JSON으로만 답하세요.`,
    '이미 끝난 행사는 제외하고, 일정이 확인되는 실재 행사만 골라 주세요.',
  ].join('\n')
}

/**
 * Returns currently-happening / upcoming Jeju festivals via real-time web search.
 * Never throws — all failures resolve to { ok:false }.
 */
export async function getCurrentFestivals({
  today,
}: {
  today: string
}): Promise<{ ok: true; festivals: FestivalItem[] } | { ok: false; error: string }> {
  try {
    const r = await runSingleAiProvider({
      supabase: noDbSupabase(),
      sessionId: null,
      userId: null,
      provider: FESTIVAL_PROVIDER,
      prompt: buildUserPrompt(today),
      systemPrompt: buildSystemPrompt(today),
      maxCompletionTokens: FESTIVAL_MAX_TOKENS,
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

    const rawFestivals = (parsed as Record<string, unknown>).festivals
    if (!Array.isArray(rawFestivals)) {
      return { ok: false, error: GENERIC_FAIL }
    }

    const festivals: FestivalItem[] = []
    for (const item of rawFestivals) {
      if (!item || typeof item !== 'object') continue
      const o = item as Record<string, unknown>
      const name = typeof o.name === 'string' ? o.name.trim() : ''
      if (!name) continue // a festival with no name is unusable
      festivals.push({
        name,
        area: toStrOrNull(o.area),
        period: toStrOrNull(o.period),
        description: typeof o.description === 'string' ? o.description.trim() : '',
        caution: toStrOrNull(o.caution),
        // source is set in CODE for every item — never requested from the model.
        source: 'web',
      })
    }

    if (festivals.length === 0) {
      return { ok: false, error: GENERIC_FAIL }
    }

    return { ok: true, festivals }
  } catch {
    return { ok: false, error: GENERIC_FAIL }
  }
}
