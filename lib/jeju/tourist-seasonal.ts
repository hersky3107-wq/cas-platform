import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { runSingleAiProvider, type ExtendedAiProviderName } from '@/lib/ai/router'
import {
  languageDirective,
  languageReminder,
  sonarLanguageDirective,
  warnIfWrongLanguage,
  type AiLocale,
} from '@/lib/jeju/ai-locale'
import { translateCardFields } from '@/lib/jeju/translate-cards'

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

function buildSystemPrompt(today: string, locale: AiLocale): string {
  const isKo = locale === 'ko'
  // These lines carry QUOTED example field VALUES; for non-ko we neutralize the
  // quoted Korean so sonar doesn't mirror them into Korean output. The output
  // language itself is governed by languageDirective. ko stays byte-identical.
  const seasonHintLine = isKo
    ? '- season_hint에는 반드시 "지금이 왜 특별한지"(만개 시기·절정·한정 기간)를 담으세요. 예: "6월 수국 만개 중", "반딧불이 관찰 시즌", "억새 절정", "한라산 설경·상고대 시즌".'
    : '- season_hint에는 "지금이 왜 특별한지"(만개 시기·절정·한정 기간)를 반드시 출력 언어로 담으세요 (e.g. "now in peak bloom", "limited-time firefly season", "silver grass at its peak"). 한국어 예시를 그대로 베끼지 말고 출력 언어로 작성하세요.'
  const areaNullLine = isKo
    ? '- 위치가 불확실하면 area를 null로 두고 caution에 "위치 확인 필요"라고 적으세요. 틀린 위치를 추측해서 적지 마세요.'
    : '- 위치가 불확실하면 area를 null로 두고 caution에 출력 언어로 위치 확인이 필요하다는 메모를 적으세요 (e.g. "location needs verification"). 틀린 위치를 추측해서 적지 마세요.'
  const cautionUncertainLine = isKo
    ? '- 시기·상태가 불확실하면 caution에 솔직히 명시하세요 (예: "정확한 개화 시기는 현장 확인 필요").'
    : '- 시기·상태가 불확실하면 caution에 출력 언어로 솔직히 명시하세요 (e.g. "exact bloom timing may vary — check locally").'
  return [
    // Forceful language rule FIRST (sandwiched with a reminder at the end).
    languageDirective(locale),
    sonarLanguageDirective(locale),
    '',
    '당신은 제주 자연·계절 볼거리에 밝은 로컬 안내자입니다.',
    `오늘은 ${today} 입니다. 반드시 ${today} 기준 최신 정보를 우선해서 웹에서 찾아주세요.`,
    '',
    '핵심 기준(가장 중요): 지금 이 시기에 "가야만" 볼 수 있거나, 지금이 절정이라 유독 더 아름다운 것만 추천하세요.',
    '- 포함 예: 지금 만개한 꽃(수국·메밀꽃·동백 등), 지금만 보이는 자연현상(반딧불이·가을 억새·단풍·겨울 한라산 눈꽃·상고대), 지금이 절정인 경관.',
    '- 제외: 사철 비슷하게 좋은 곳은 넣지 마세요. 해수욕장·상시 관광지·일반 명소는 "여름이라 좋다" 정도의 이유로는 포함하지 마세요. 지금 시기의 "절정/한정" 매력이 뚜렷한 것만.',
    '- 다양성(필수): 한 종류(예: 수국)에만 치우치지 말고, 지금 시기에 절정인 여러 종류를 다양하게 섞으세요. 예시(6월 말 기준): 수국, 메밀꽃, 반딧불이, 능소화 등 — 지금 절정인 것들을 종류별로 골고루. 같은 꽃만 여러 개 나열하지 마세요.',
    '- 종류별 상한(엄수): 한 종류는 최대 2~3개까지만. 수국이 제철이어도 수국만 6개 나열하지 마세요. 반드시 다른 종류를 섞으세요: 수국 2~3개 + 메밀꽃 + 반딧불이(6월 한정 야간) + 그 외 지금 볼 수 있는 자연현상/꽃 등으로 4종류 이상이 되게 구성하세요.',
    `- 수국 외에도 지금(${today}) 제주에서 볼 수 있는 것을 적극적으로 찾아 포함하세요. 종류 다양성이 중요합니다.`,
    seasonHintLine,
    '',
    '위치 규칙(절대 엄수):',
    '- 모든 장소는 반드시 제주특별자치도(제주도) 안에 있어야 합니다. 제주 밖 지역(예: 고흥, 전라남도, 육지)은 절대 포함하지 마세요.',
    '- area(지역)는 제주도 내 시·읍·면 단위로만 표기하세요 (예: "제주시 구좌읍", "서귀포시 성산읍").',
    areaNullLine,
    '',
    '엄수 규칙:',
    `- 반드시 ${today} 기준 지금 이 시기에 실제로 볼 수 있는 것만 추천하세요.`,
    cautionUncertainLine,
    '- 존재하지 않는 장소를 지어내지 마세요. 이름·위치가 확실하지 않으면 포함하지 마세요.',
    '',
    '출력 형식(엄수): 아래 형태의 JSON 객체 하나만 출력하세요. JSON 외의 설명·마크다운·인사말·각주는 절대 출력하지 마세요.',
    'name 필드는 고유명사이므로 위 언어 규칙대로 한국어 원문을 유지하고, area·season_hint·description·caution 등 나머지 모든 텍스트는 반드시 출력 언어로 작성하세요.',
    '{ "sights": [ { "name": "<place name>", "area": "<area or null>", "season_hint": "<one line on why it is special now, in the output language, or null>", "description": "<one-line intro in the output language>", "caution": "<caution in the output language, or null>" } ] }',
    languageReminder(locale),
  ]
    .filter((s) => s !== '')
    .join('\n')
}

/**
 * The USER turn — sonar weights its language heavily, so for non-Korean locales we
 * write the request IN THE TARGET LANGUAGE (the strongest lever for compliance).
 * ko stays byte-identical to the original.
 */
function buildUserPrompt(today: string, locale: AiLocale): string {
  switch (locale) {
    case 'en':
      return [
        `As of ${today}, find 4-8 Jeju natural sights / seasonal highlights that can ONLY be seen right now or are at their peak right now. Respond in JSON only.`,
        'Exclude places that look similar year-round; pick only those with a clear "peak / limited-time" appeal right now. Write everything in English (keep Korean proper nouns with romanization).',
      ].join('\n')
    case 'ja':
      return [
        `${today}時点で、今だけ見られる、または今が見頃の済州の自然の景色・季節の見どころを4〜8か所探して、JSONのみで回答してください。`,
        '一年中似たように良い場所は除外し、今の時期ならではの「見頃・期間限定」の魅力がはっきりしたものだけを選んでください。すべて日本語で書いてください（韓国語の固有名詞は読み仮名付きで残す）。',
      ].join('\n')
    case 'zh-TW':
      return [
        `請找出截至${today}、只有現在才能看到或正值高峰的濟州自然景色與季節亮點 4〜8 處，僅以 JSON 回覆。`,
        '請排除整年都差不多的地方，只選擇現在這個時期「正值高峰／限時」魅力明顯的景點。全部以繁體中文書寫（韓文專有名詞保留並附拼音）。',
      ].join('\n')
    case 'zh-CN':
      return [
        `请找出截至${today}、只有现在才能看到或正值高峰的济州自然景色与季节亮点 4〜8 处，仅以 JSON 回复。`,
        '请排除整年都差不多的地方，只选择现在这个时期"正值高峰／限时"魅力明显的景点。全部以简体中文书写（韩文专有名词保留并附拼音）。',
      ].join('\n')
    case 'ko':
    default:
      return [
        `오늘(${today}) 기준으로, 지금 이 시기에만 볼 수 있거나 지금이 절정인 제주 자연 풍경·계절 볼거리 4~8곳을 찾아 JSON으로만 답하세요.`,
        '사철 비슷하게 좋은 곳은 제외하고, 지금 시기의 "절정/한정" 매력이 뚜렷한 것만 골라 주세요.',
      ].join('\n')
  }
}

/**
 * Returns currently-visible seasonal sights in Jeju via real-time web search.
 * Never throws — all failures resolve to { ok:false }.
 */
export async function getSeasonalSights({
  today,
  locale = 'ko',
}: {
  today: string
  locale?: AiLocale
}): Promise<{ ok: true; sights: SeasonalItem[] } | { ok: false; error: string }> {
  try {
    const r = await runSingleAiProvider({
      supabase: noDbSupabase(),
      sessionId: null,
      userId: null,
      provider: SEASONAL_PROVIDER,
      prompt: buildUserPrompt(today, locale),
      systemPrompt: buildSystemPrompt(today, locale),
      maxCompletionTokens: SEASONAL_MAX_TOKENS,
      timeoutMs: 30_000,
    })

    if (r.error || !r.text || !r.text.trim()) {
      return { ok: false, error: GENERIC_FAIL }
    }

    warnIfWrongLanguage(r.text, locale, 'tourist-seasonal')

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

    // Single translation gate for all free-text card fields (non-ko only). The
    // proper-noun `name` is excluded. Per-item original fallback on any miss.
    const localizedSights = await translateCardFields(sights, locale, [
      'description',
      'season_hint',
      'caution',
    ])

    return { ok: true, sights: localizedSights }
  } catch {
    return { ok: false, error: GENERIC_FAIL }
  }
}
