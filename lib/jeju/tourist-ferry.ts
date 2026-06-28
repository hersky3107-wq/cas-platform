import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { runSingleAiProvider, type ExtendedAiProviderName } from '@/lib/ai/router'

/**
 * Jeju TOURIST mode — FERRY-ACCESSIBLE ISLANDS overview via real-time web search.
 *
 * DESIGN CONSTRAINTS (same isolation discipline as lib/jeju/tourist-local.ts):
 *   - 'server-only'. One runSingleAiProvider call with sessionId:null + userId:null
 *     (NO credit/DB logging, no BYOK reads — noDbSupabase() is never dereferenced).
 *   - MUST NOT import app/api/synod/* or any AIMANI compare/credit session runner.
 *
 * Covers all Jeju ferry-accessible islands: 우도, 가파도, 마라도, 추자도, 비양도.
 * Schedules and fares change frequently, so we instruct the model to give rough
 * guidance and always recommend on-site / operator verification. Never throws.
 */

/** Perplexity sonar — real-time web retrieval. Default model (sonar), no override. */
const FERRY_PROVIDER: ExtendedAiProviderName = 'perplexity'

/** Room for 5 islands with charm + ferry info + cautions in Korean. */
const FERRY_MAX_TOKENS = 1300

const GENERIC_FAIL = '섬 여행 정보를 불러오지 못했어요. 다시 시도해 주세요.'

/**
 * Info about a single ferry-accessible Jeju island. `source` is always 'web'
 * (set in code). Ferry schedules/fares change often — caution always notes this.
 */
export interface IslandInfo {
  name: string
  charm: string
  departurePoint: string | null
  terminal: string | null
  phone: string | null
  duration: string | null
  fareNote: string | null
  caution: string | null
  source: 'web'
}

function noDbSupabase(): SupabaseClient {
  return createClient('http://localhost', 'tourist-ferry-no-db') as unknown as SupabaseClient
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

function toStrOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s !== '' && s.toLowerCase() !== 'null' ? s : null
}

function buildSystemPrompt(today: string): string {
  return [
    '당신은 제주 부속섬 여행 전문 안내자입니다.',
    `오늘은 ${today} 입니다.`,
    '제주에서 배로 갈 수 있는 부속섬(우도·가파도·마라도·추자도·비양도)을 각각 안내해주세요.',
    '',
    '각 섬에 대해 알려줄 내용:',
    '- name: 섬 이름',
    '- charm: 그 섬의 핵심 매력 한 줄 (예: "땅콩아이스크림과 에메랄드 바다", "청보리밭 (봄 한정)", "대한민국 최남단 섬·마라도짜장면")',
    '- departurePoint: 출발 항구 (예: "성산항", "모슬포항", "한림항")',
    '- terminal: 출발 여객터미널 정식 명칭 (예: "성산포항 종합여객터미널"). 확실히 아는 경우에만, 불확실하면 null.',
    '- phone: 운항사 또는 터미널 대표 전화번호. 확실히 아는 경우에만, 불확실하면 null.',
    '- duration: 대략 편도 소요시간 (예: "약 15분")',
    '- fareNote: 대략 왕복 요금 (예: "약 12,000원 내외")',
    '- caution: 주의사항 — 반드시 "시간표·요금은 자주 바뀌니 출발 전 터미널·운항사 확인 필수"를 포함. 계절 한정 매력(예: 가파도 청보리는 봄 한정)이 있으면 함께 명시.',
    '',
    '엄수 규칙:',
    '- 시간표·요금을 단정하지 마세요. 반드시 "대략", "약", "~내외" 표현 사용.',
    '- 터미널 이름·전화번호는 확실히 아는 경우에만 적고, 불확실하면 반드시 null로 두세요. 추측한 전화번호를 절대 지어내지 마세요. 잘못된 연락처는 없느니만 못합니다.',
    '- 모든 섬의 caution에 "방문 전 터미널·운항사 확인 필수"를 포함하세요.',
    '- 정보가 불확실한 항목은 null로 두세요. 추측해서 채우지 마세요.',
    '- 반드시 한국어로만 작성하세요.',
    '',
    '출력 형식(엄수): 아래 형태의 JSON 객체 하나만 출력하세요. JSON 외의 설명·마크다운·인사말은 절대 출력하지 마세요.',
    '{ "islands": [ { "name": "...", "charm": "...", "departurePoint": "...", "terminal": "... 또는 null", "phone": "... 또는 null", "duration": "...", "fareNote": "...", "caution": "..." } ] }',
  ].join('\n')
}

function buildUserPrompt(today: string): string {
  return `오늘(${today}) 기준으로, 제주에서 배로 갈 수 있는 부속섬 5곳(우도·가파도·마라도·추자도·비양도)의 매력과 페리 기본 정보를 JSON으로만 답하세요.`
}

/**
 * Returns an overview of all Jeju ferry-accessible islands via real-time web search.
 * Never throws — all failures resolve to { ok:false }.
 */
export async function getJejuIslandsInfo({
  today,
}: {
  today: string
}): Promise<{ ok: true; islands: IslandInfo[] } | { ok: false; error: string }> {
  try {
    const r = await runSingleAiProvider({
      supabase: noDbSupabase(),
      sessionId: null,
      userId: null,
      provider: FERRY_PROVIDER,
      prompt: buildUserPrompt(today),
      systemPrompt: buildSystemPrompt(today),
      maxCompletionTokens: FERRY_MAX_TOKENS,
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

    const rawIslands = (parsed as Record<string, unknown>).islands
    if (!Array.isArray(rawIslands)) {
      return { ok: false, error: GENERIC_FAIL }
    }

    const islands: IslandInfo[] = []
    for (const item of rawIslands) {
      if (!item || typeof item !== 'object') continue
      const o = item as Record<string, unknown>
      const name = typeof o.name === 'string' ? o.name.trim() : ''
      if (!name) continue

      islands.push({
        name,
        charm: typeof o.charm === 'string' ? o.charm.trim() : '',
        departurePoint: toStrOrNull(o.departurePoint),
        terminal: toStrOrNull(o.terminal),
        phone: toStrOrNull(o.phone),
        duration: toStrOrNull(o.duration),
        fareNote: toStrOrNull(o.fareNote),
        caution: toStrOrNull(o.caution),
        source: 'web',
      })
    }

    if (islands.length === 0) {
      return { ok: false, error: GENERIC_FAIL }
    }

    return { ok: true, islands }
  } catch {
    return { ok: false, error: GENERIC_FAIL }
  }
}
