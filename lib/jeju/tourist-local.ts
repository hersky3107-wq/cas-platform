import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { runSingleAiProvider, type ExtendedAiProviderName } from '@/lib/ai/router'
import { getVisitJejuPool } from '@/lib/jeju/connectors'

/**
 * Jeju TOURIST mode — Perplexity (sonar) LOCAL-GEMS supplement.
 *
 * DESIGN CONSTRAINTS (same isolation discipline as lib/jeju/mediawatch.ts):
 *   - 'server-only'. One runSingleAiProvider call with sessionId:null + userId:null
 *     (NO credit/DB logging, no BYOK reads — noDbSupabase() is never dereferenced).
 *   - MUST NOT import app/api/synod/* or any AIMANI compare/credit session runner.
 *
 * Returns good Jeju spots that locals value but tourists often skip — from a
 * real-time web search, broadened beyond food (카페·자연·명소·체험). Targets the
 * "well-documented but off the typical tourist route" zone (e.g. 엉또폭포, 원앙폭포)
 * rather than truly-obscure places, which have little web data and make sonar
 * hallucinate. Every gem is source:'web'; each is ALSO cross-checked against the
 * official VisitJeju pool to set a `verified` trust flag. Never throws.
 */

/** Perplexity sonar — real-time web retrieval. Default model (sonar), no override. */
const LOCAL_PROVIDER: ExtendedAiProviderName = 'perplexity'

/** Room for 4–8 gems with descriptions + cautions in token-dense Korean. */
const LOCAL_MAX_TOKENS = 1300

const GENERIC_FAIL = '주변 정보를 불러오지 못했어요. 다시 시도해 주세요.'

/**
 * A local spot found via web search, shaped to merge with place cards.
 *   - `source` is always 'web' (every gem came from sonar).
 *   - `verified` is the trust signal: true when the gem's name matches a place
 *     in the official VisitJeju pool, false when it's web-only/unconfirmed.
 */
export interface LocalGem {
  name: string
  area: string | null
  description: string
  tags: string[]
  caution: string | null
  source: 'web'
  verified: boolean
}

/**
 * Throwaway Supabase client to satisfy runSingleAiProvider's required param.
 * With sessionId:null + userId:null the router does NO DB inserts and NO BYOK
 * reads, so this client is never dereferenced for I/O. Mirrors mediawatch.ts.
 */
function noDbSupabase(): SupabaseClient {
  return createClient('http://localhost', 'tourist-local-no-db') as unknown as SupabaseClient
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

function buildSystemPrompt(today: string): string {
  return [
    '당신은 제주 현지 사정에 밝은 로컬 여행 안내자입니다.',
    `오늘은 ${today} 입니다. 반드시 최신(가능하면 최근 1년 이내) 정보를 우선해서 찾아주세요.`,
    '현지인이 아끼지만 관광객은 잘 모르거나 일반 관광 코스에서 빠지는 제주의 좋은 장소 4~8곳을 추천하세요.',
    '맛집뿐 아니라 카페, 자연(폭포·오름·해변·숲), 명소, 체험 등 다양하게 골라 주세요.',
    '질문에 특정 종류(맛집/카페/전시 등)가 명시되면 그 종류 위주로, 명시가 없으면 맛집·카페·자연·명소·문화공간을 골고루 섞어주세요. 자연 명소만 편중되지 않게.',
    '여러 종류를 섞어달라는 요청이면, 한 종류에 치우치지 말고 맛집·카페·자연 명소·전시/박물관/문화공간을 가능한 한 고르게 섞어서 8곳 정도를 추천하세요. 예: 맛집 2~3, 카페 1~2, 자연 2~3, 문화공간 1~2.',
    '알려져 있지만 관광객이 잘 들르지 않는 곳도 좋습니다 — 예: 엉또폭포(비 온 뒤에만 물이 흐름), 원앙폭포.',
    '',
    '엄수 규칙(매우 중요):',
    '- 정보가 거의 없는 무명 장소를 억지로 만들어내지 마세요. 웹에 실제 정보가 있는, 검증 가능한 실재 장소만 추천하세요.',
    '- 이름·위치가 확실하지 않으면 포함하지 마세요.',
    `- ${today} 기준으로 최신 정보를 우선하세요. 오래된(1년 이상 전) 정보로 의심되면 caution에 "정보가 오래됐을 수 있음"을 명시하세요.`,
    '- 폐업·이전 가능성이 있으면 caution에 명시하세요.',
    '- 위치가 불확실하면 caution에 솔직히 적으세요.',
    '- 블로그 광고·협찬으로 과장된 곳은 가급적 제외하세요.',
    '',
    '출력 형식(엄수): 아래 형태의 JSON 객체 하나만 출력하세요. JSON 외의 설명·마크다운·인사말·각주는 절대 출력하지 마세요.',
    '{ "gems": [ { "name": "<장소명>", "area": "<지역(예: 제주시 한림, 서귀포 성산), 모르면 null>", "description": "<한 줄 한국어 소개>", "tags": ["<짧은 키워드>", "..."], "caution": "<솔직한 주의사항 또는 null>" } ] }',
  ].join('\n')
}

function buildUserPrompt(query: string, today: string): string {
  return [
    '[사용자 요청]',
    query,
    '',
    `오늘(${today}) 기준 최신 정보로, 위 요청에 맞는 제주의 좋은 장소(맛집·카페·자연·명소·체험 등) 4~8곳을 찾아 JSON으로만 답하세요. 관광객이 잘 모르거나 코스에서 빠지지만 검증 가능한 실재 장소 위주로 골라 주세요.`,
  ].join('\n')
}

/** Normalizes a place name for matching: lowercased, all whitespace stripped. */
function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '')
}

/**
 * Cross-checks gem names against the official VisitJeju pool. A gem is verified
 * when its normalized name (len >= 2) is a substring of a pool title or vice
 * versa. Pool fetch failure is non-fatal — all gems stay verified:false.
 */
async function buildVerifier(): Promise<(name: string) => boolean> {
  let poolNames: string[] = []
  try {
    const pool = await getVisitJejuPool()
    poolNames = pool.map((p) => normalizeName(p.title)).filter((n) => n.length >= 2)
  } catch {
    poolNames = []
  }

  return (name: string): boolean => {
    const n = normalizeName(name)
    if (n.length < 2 || poolNames.length === 0) return false
    return poolNames.some((title) => title.includes(n) || n.includes(title))
  }
}

/** Coerces an unknown into a clean tags array (strings, trimmed, deduped-ish, capped). */
function toTags(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.trim().replace(/^#/, ''))
    .filter((t) => t !== '')
    .slice(0, 5)
}

/** Coerces an unknown into a trimmed string, or null when empty/absent. */
function toStrOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s !== '' && s.toLowerCase() !== 'null' ? s : null
}

export async function findLocalGems({
  query,
  today,
}: {
  query: string
  today: string
}): Promise<{ ok: true; gems: LocalGem[] } | { ok: false; error: string }> {
  try {
    const trimmed = query?.trim()
    if (!trimmed) return { ok: false, error: GENERIC_FAIL }

    const r = await runSingleAiProvider({
      supabase: noDbSupabase(),
      sessionId: null,
      userId: null,
      provider: LOCAL_PROVIDER,
      prompt: buildUserPrompt(trimmed, today),
      systemPrompt: buildSystemPrompt(today),
      maxCompletionTokens: LOCAL_MAX_TOKENS,
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

    const rawGems = (parsed as Record<string, unknown>).gems
    if (!Array.isArray(rawGems)) {
      return { ok: false, error: GENERIC_FAIL }
    }

    // Cross-check names against the official VisitJeju pool (fetched once).
    const isVerified = await buildVerifier()

    const gems: LocalGem[] = []
    for (const item of rawGems) {
      if (!item || typeof item !== 'object') continue
      const o = item as Record<string, unknown>
      const name = typeof o.name === 'string' ? o.name.trim() : ''
      if (!name) continue // a gem with no name is unusable
      gems.push({
        name,
        area: toStrOrNull(o.area),
        description: typeof o.description === 'string' ? o.description.trim() : '',
        tags: toTags(o.tags),
        caution: toStrOrNull(o.caution),
        // source is set in CODE for every gem — never requested from the model.
        source: 'web',
        // verified: true when this place exists in the official VisitJeju DB.
        verified: isVerified(name),
      })
    }

    if (gems.length === 0) {
      return { ok: false, error: GENERIC_FAIL }
    }

    return { ok: true, gems }
  } catch {
    return { ok: false, error: GENERIC_FAIL }
  }
}
