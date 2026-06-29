import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { runSingleAiProvider, type ExtendedAiProviderName } from '@/lib/ai/router'

/**
 * Jeju TOURIST mode — CURRENT SEASONAL SIGHTS via real-time web search.
 *
 * DESIGN CONSTRAINTS (same isolation discipline as lib/jeju/tourist-local.ts):
 *   - 'server-only'. One runSingleAiProvider call with sessionId:null + userId:null
 *     (NO credit/DB logging, no BYOK reads — noDbSupabase() is never dereferenced).
 *   - MUST NOT import app/api/synod/* or any AIMANI compare/credit session runner.
 *
 * "What's beautiful in Jeju RIGHT NOW" is inherently real-time seasonal info.
 * Rather than querying a static DB, sonar searches the current date and season
 * (proven effective for date-aware queries in tourist-festivals.ts). Covers all
 * types: flowers (수국/유채/벚꽃/동백), autumn foliage (억새/단풍), winter snow
 * scenes (눈꽃/한라산 설경), seasonal natural phenomena, free/paid attractions,
 * and related festivals. Never throws — all failures resolve to { ok:false }.
 */

/** Perplexity sonar — real-time web retrieval. Default model (sonar), no override. */
const SEASONAL_PROVIDER: ExtendedAiProviderName = 'perplexity'

/** Room for 4–8 sights with season hints + cautions in token-dense Korean. */
const SEASONAL_MAX_TOKENS = 1200

const GENERIC_FAIL = '제주 풍경 정보를 불러오지 못했어요. 다시 시도해 주세요.'

/**
 * A seasonal sight found via real-time web search. `source` is always 'web'
 * (set in code, never requested from the model). `season_hint` is a short
 * description of why it's relevant right now (e.g. "6월 수국 만개", "지금 한창").
 */
export interface SeasonalItem {
  name: string
  area: string | null
  season_hint: string | null
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
  return createClient('http://localhost', 'tourist-seasonal-no-db') as unknown as SupabaseClient
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
    '당신은 제주 자연·계절 볼거리에 밝은 로컬 안내자입니다.',
    `오늘은 ${today} 입니다. 반드시 ${today} 기준 최신 정보를 우선해서 웹에서 찾아주세요.`,
    '',
    '핵심 기준(가장 중요): 지금 이 시기에 "가야만" 볼 수 있거나, 지금이 절정이라 유독 더 아름다운 것만 추천하세요.',
    '- 포함 예: 지금 만개한 꽃(수국·메밀꽃·동백 등), 지금만 보이는 자연현상(반딧불이·가을 억새·단풍·겨울 한라산 눈꽃·상고대), 지금이 절정인 경관.',
    '- 제외: 사철 비슷하게 좋은 곳은 넣지 마세요. 해수욕장·상시 관광지·일반 명소는 "여름이라 좋다" 정도의 이유로는 포함하지 마세요. 지금 시기의 "절정/한정" 매력이 뚜렷한 것만.',
    '- 다양성(필수): 한 종류(예: 수국)에만 치우치지 말고, 지금 시기에 절정인 여러 종류를 다양하게 섞으세요. 예시(6월 말 기준): 수국, 메밀꽃, 반딧불이, 능소화 등 — 지금 절정인 것들을 종류별로 골고루. 같은 꽃만 여러 개 나열하지 마세요.',
    '- 종류별 상한(엄수): 한 종류는 최대 2~3개까지만. 수국이 제철이어도 수국만 6개 나열하지 마세요. 반드시 다른 종류를 섞으세요: 수국 2~3개 + 메밀꽃 + 반딧불이(6월 한정 야간) + 그 외 지금 볼 수 있는 자연현상/꽃 등으로 4종류 이상이 되게 구성하세요.',
    `- 수국 외에도 지금(${today}) 제주에서 볼 수 있는 것을 적극적으로 찾아 포함하세요. 종류 다양성이 중요합니다.`,
    '- season_hint에는 반드시 "지금이 왜 특별한지"(만개 시기·절정·한정 기간)를 담으세요. 예: "6월 수국 만개 중", "반딧불이 관찰 시즌", "억새 절정", "한라산 설경·상고대 시즌".',
    '',
    '위치 규칙(절대 엄수):',
    '- 모든 장소는 반드시 제주특별자치도(제주도) 안에 있어야 합니다. 제주 밖 지역(예: 고흥, 전라남도, 육지)은 절대 포함하지 마세요.',
    '- area(지역)는 제주도 내 시·읍·면 단위로만 표기하세요 (예: "제주시 구좌읍", "서귀포시 성산읍").',
    '- 위치가 불확실하면 area를 null로 두고 caution에 "위치 확인 필요"라고 적으세요. 틀린 위치를 추측해서 적지 마세요.',
    '',
    '엄수 규칙:',
    `- 반드시 ${today} 기준 지금 이 시기에 실제로 볼 수 있는 것만 추천하세요.`,
    '- 시기·상태가 불확실하면 caution에 솔직히 명시하세요 (예: "정확한 개화 시기는 현장 확인 필요").',
    '- 존재하지 않는 장소를 지어내지 마세요. 이름·위치가 확실하지 않으면 포함하지 마세요.',
    '- 반드시 한국어로만 작성하세요. 중국어·영어 등 외국어를 섞지 마세요.',
    '',
    '출력 형식(엄수): 아래 형태의 JSON 객체 하나만 출력하세요. JSON 외의 설명·마크다운·인사말·각주는 절대 출력하지 마세요.',
    '{ "sights": [ { "name": "<장소명>", "area": "<지역, 모르면 null>", "season_hint": "<지금이 왜 특별한지 한 줄, 모르면 null>", "description": "<한 줄 한국어 소개>", "caution": "<주의사항, 없으면 null>" } ] }',
  ].join('\n')
}

function buildUserPrompt(today: string): string {
  return [
    `오늘(${today}) 기준으로, 지금 이 시기에만 볼 수 있거나 지금이 절정인 제주 자연 풍경·계절 볼거리 4~8곳을 찾아 JSON으로만 답하세요.`,
    '사철 비슷하게 좋은 곳은 제외하고, 지금 시기의 "절정/한정" 매력이 뚜렷한 것만 골라 주세요.',
  ].join('\n')
}

/**
 * Returns currently-visible seasonal sights in Jeju via real-time web search.
 * Never throws — all failures resolve to { ok:false }.
 */
export async function getSeasonalSights({
  today,
}: {
  today: string
}): Promise<{ ok: true; sights: SeasonalItem[] } | { ok: false; error: string }> {
  try {
    const r = await runSingleAiProvider({
      supabase: noDbSupabase(),
      sessionId: null,
      userId: null,
      provider: SEASONAL_PROVIDER,
      prompt: buildUserPrompt(today),
      systemPrompt: buildSystemPrompt(today),
      maxCompletionTokens: SEASONAL_MAX_TOKENS,
      timeoutMs: 30_000,
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

    const rawSights = (parsed as Record<string, unknown>).sights
    if (!Array.isArray(rawSights)) {
      return { ok: false, error: GENERIC_FAIL }
    }

    const sights: SeasonalItem[] = []
    for (const item of rawSights) {
      if (!item || typeof item !== 'object') continue
      const o = item as Record<string, unknown>
      const name = typeof o.name === 'string' ? o.name.trim() : ''
      if (!name) continue
      sights.push({
        name,
        area: toStrOrNull(o.area),
        season_hint: toStrOrNull(o.season_hint),
        description: typeof o.description === 'string' ? o.description.trim() : '',
        caution: toStrOrNull(o.caution),
        source: 'web',
      })
    }

    if (sights.length === 0) {
      return { ok: false, error: GENERIC_FAIL }
    }

    return { ok: true, sights }
  } catch {
    return { ok: false, error: GENERIC_FAIL }
  }
}
