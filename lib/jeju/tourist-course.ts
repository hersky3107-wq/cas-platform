import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { runSingleAiProvider, type ExtendedAiProviderName } from '@/lib/ai/router'
import {
  getVisitJejuPool,
  fetchVisitJejuPlaces,
  filterPlacesByQuery,
  type VisitJejuPlace,
} from '@/lib/jeju/connectors'

/**
 * Jeju TOURIST mode — AI 여행 코스 추천 engine (Jeju's signature feature).
 *
 * Generates up to 4 DISTINCT themed day-courses, each a different "personality":
 *   A. 알찬 인기형 — popular must-see spots, efficient
 *   B. 힐링형      — nature, cafes, slow pace, 온천/스파·삼림욕
 *   C. 로컬·숨은형  — places tourists don't know (locals' spots)
 *   D. 액티브형     — 해양스포츠·다이나믹 체험·등산/오름/트래킹
 *
 * DESIGN CONSTRAINTS (same isolation discipline as lib/jeju/tourist-recommend.ts):
 *   - 'server-only'. All AI calls use runSingleAiProvider with sessionId:null +
 *     userId:null (NO credit/DB logging, no BYOK reads — noDbSupabase() is never
 *     dereferenced for I/O).
 *   - MUST NOT import app/api/synod/* or any AIMANI compare/credit session runner.
 *
 * DATA STRATEGY (mix sources for richness):
 *   1. VisitJeju pool (~1,429 places) — primary bank for A/B/C.
 *   2. Sonar (perplexity) — ONE bounded call for local-hidden + active/marine/
 *      trail places that VisitJeju is thin on (mainly for C and D).
 *   3. Sonnet (anthropic) — ONE call composes the 4 courses with proper flow
 *      (오전→점심→오후), timing, and a distinct concept each. Anti-hallucination:
 *      the AI builds courses ONLY from the provided indexed candidate list and
 *      returns indices + ordering + timing/concept — it never invents names.
 *
 * Never throws — every failure path returns { ok: false, error }.
 */

const COMPOSE_PROVIDER: ExtendedAiProviderName = 'anthropic'
const LOCAL_ACTIVE_PROVIDER: ExtendedAiProviderName = 'perplexity'

/** 4 structured courses need room. */
const COMPOSE_MAX_TOKENS = 2500
/** Local/active sonar supplement — a dozen places with short descriptions. */
const LOCAL_ACTIVE_MAX_TOKENS = 1200

/** Cap VisitJeju candidates so the compose prompt stays a sane size. */
const MAX_POOL_CANDIDATES = 90
/** Category-balanced fallback sample size when the keyword filter finds nothing. */
const FALLBACK_SAMPLE_SIZE = 70
/** Max web (sonar) candidates merged into the bank. */
const MAX_WEB_CANDIDATES = 16

const GENERIC_FAIL = '코스를 만들지 못했어요. 다시 시도해 주세요.'

export type CourseId = 'A' | 'B' | 'C' | 'D'

export interface CourseStop {
  order: number
  name: string
  timing: string | null
  category: string | null
  description: string
  durationHint: string | null
  source: 'visitjeju' | 'web'
}

export interface Course {
  id: CourseId
  theme: string
  concept: string
  stops: CourseStop[]
  note: string | null
}

/** A unified candidate the compose model can reference by index. */
interface Candidate {
  name: string
  category: string | null
  region: string | null
  source: 'visitjeju' | 'web'
}

/**
 * Throwaway Supabase client to satisfy runSingleAiProvider's required param.
 * With sessionId:null + userId:null the router does NO DB inserts and NO BYOK
 * reads, so this client is never dereferenced for I/O. Mirrors tourist-recommend.ts.
 */
function noDbSupabase(): SupabaseClient {
  return createClient('http://localhost', 'tourist-course-no-db') as unknown as SupabaseClient
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

/** Coerces an unknown into a trimmed string, or null when empty/absent/"null". */
function toStrOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s !== '' && s.toLowerCase() !== 'null' ? s : null
}

/** Splits query + area into substring filter keywords (drops trivially short tokens). */
function deriveKeywords(query: string, area?: string): string[] {
  return `${query} ${area ?? ''}`
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2)
}

/**
 * Category-balanced sample (round-robin by categoryCode) so the composer always
 * has a diverse bank — mirrors tourist-recommend.ts's balancedSample.
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

// ── Sonar supplement: local-hidden + active/marine/trail places ───────────────

function buildLocalActiveSystemPrompt(area?: string): string {
  return [
    '당신은 제주 현지 사정에 밝은 여행 안내자입니다.',
    '여행 코스 구성에 쓸 "실재하는" 제주 장소를 찾아 JSON으로만 답하세요.',
    area ? `가능하면 "${area}" 인근 위주로 찾아 주세요.` : '',
    '',
    '다음 두 종류를 골고루 포함하세요:',
    '- 로컬·숨은 명소: 관광객은 잘 모르지만 현지인이 즐겨 찾는 맛집·카페·자연 명소·골목.',
    '- 액티브 장소: 해양스포츠(스노클링·서핑·다이빙 등), 다이나믹 체험, 등산·오름·트래킹/둘레길.',
    '',
    '엄수 규칙:',
    '- 웹에서 실제로 확인되는 실재 장소만 포함하세요. 이름·위치가 불확실하면 빼세요. 지어내지 마세요.',
    '- 반드시 제주특별자치도 안의 장소만 포함하세요. 제주 밖(육지)은 절대 포함하지 마세요.',
    '- 반드시 한국어로만 작성하세요.',
    '',
    '출력 형식(엄수): 아래 형태의 JSON 객체 하나만 출력하세요. JSON 외의 설명·마크다운은 절대 출력하지 마세요.',
    '{ "places": [ { "name": "<장소명>", "category": "<종류(맛집/카페/오름/해양스포츠/트래킹 등), 모르면 null>", "area": "<지역, 모르면 null>", "description": "<한 줄 한국어 소개>" } ] }',
  ]
    .filter((s) => s !== '')
    .join('\n')
}

function buildLocalActiveUserPrompt(query: string): string {
  return [
    '[사용자 요청]',
    query,
    '',
    '위 요청을 참고하여, 제주 여행 코스에 넣을 만한 로컬·숨은 명소와 액티브(해양스포츠·체험·등산/오름/트래킹) 장소를 합쳐 10~14곳 찾아 JSON으로만 답하세요.',
  ].join('\n')
}

/**
 * ONE bounded sonar call returning local-hidden + active candidates. Non-fatal:
 * on any failure returns [] so course composition proceeds on VisitJeju alone.
 *
 * NOTE: 올레/오름/둘레길 공공 API (trail data) will be added here tomorrow to
 * enrich Course D and a dedicated trail course — plug that source in at this point
 * and merge its results into the returned candidate list.
 */
async function fetchLocalActivePlaces(query: string, area?: string): Promise<Candidate[]> {
  try {
    const r = await runSingleAiProvider({
      supabase: noDbSupabase(),
      sessionId: null,
      userId: null,
      provider: LOCAL_ACTIVE_PROVIDER,
      prompt: buildLocalActiveUserPrompt(query),
      systemPrompt: buildLocalActiveSystemPrompt(area),
      maxCompletionTokens: LOCAL_ACTIVE_MAX_TOKENS,
    })

    if (r.error || !r.text || !r.text.trim()) return []

    let parsed: unknown
    try {
      parsed = JSON.parse(extractJsonObject(r.text))
    } catch {
      return []
    }
    if (!parsed || typeof parsed !== 'object') return []

    const rawPlaces = (parsed as Record<string, unknown>).places
    if (!Array.isArray(rawPlaces)) return []

    const out: Candidate[] = []
    for (const item of rawPlaces) {
      if (!item || typeof item !== 'object') continue
      const o = item as Record<string, unknown>
      const name = typeof o.name === 'string' ? o.name.trim() : ''
      if (!name) continue
      out.push({
        name,
        category: toStrOrNull(o.category),
        region: toStrOrNull(o.area),
        source: 'web',
      })
      if (out.length >= MAX_WEB_CANDIDATES) break
    }
    return out
  } catch {
    return []
  }
}

// ── Compose: one sonnet call builds the 4 courses ─────────────────────────────

/** One compact line per candidate the composer may reference by index. */
function buildCandidateList(candidates: Candidate[]): string {
  return candidates
    .map((c, i) => {
      return [
        `${i}. ${c.name}`,
        c.category ? `[${c.category}]` : '',
        c.region ? `(${c.region})` : '',
        `{${c.source === 'web' ? '로컬/웹' : '공식'}}`,
      ]
        .filter((s) => s !== '')
        .join(' ')
    })
    .join('\n')
}

function buildComposeSystemPrompt(duration: '반나절' | '하루'): string {
  const stopsHint = duration === '반나절' ? '3~4곳' : '5~7곳'
  return [
    '당신은 제주 여행 코스를 설계하는 전문 플래너입니다.',
    '아래 후보 장소 목록만을 사용해, 성격이 분명히 다른 4개의 하루 코스를 설계하세요.',
    '',
    '4가지 코스 성격(각각 확실히 다르게):',
    '- A. 알찬 인기형: 제주 대표 인기 명소 위주로 효율적인 동선.',
    '- B. 힐링형: 자연·카페·온천/스파·삼림욕(숲) 위주로 느긋한 페이스.',
    '- C. 로컬·숨은형: 관광객이 잘 모르는 현지인 장소 위주(로컬/웹 후보를 적극 활용).',
    '- D. 액티브형: 해양스포츠·다이나믹 체험·등산/오름/트래킹 위주(액티브 후보를 우선).',
    '',
    '코스 구성 품질(중요 — 단순 나열이 아니라 "흐름"이 있어야 함):',
    `- 각 코스는 ${stopsHint} 정도의 스톱으로 구성하고, 방문 순서(order)를 1부터 매기세요.`,
    '- 각 스톱에 timing(예: "오전", "점심", "오후", "저녁")을 넣어 하루 흐름이 자연스럽게 이어지게 하세요. 식사 시간대에는 가능하면 맛집/카페를 배치하세요.',
    '- 각 스톱에 durationHint(예: "1~2시간")와 짧은 description(왜 이 코스에 들어가는지)을 넣으세요.',
    '- concept: 그 코스가 어떤 하루인지 1~2문장으로 분명히 설명하세요. 4개 코스의 concept이 서로 확실히 달라야 합니다.',
    '',
    '엄수 규칙(anti-hallucination):',
    '- 반드시 후보 목록에 있는 장소만 사용하세요. 목록에 없는 장소를 절대 지어내지 마세요.',
    '- 각 스톱은 후보 목록의 index(번호)로만 지정하세요. 존재하지 않는 번호는 절대 사용하지 마세요.',
    '- 같은 코스 안에서 같은 장소를 중복하지 마세요.',
    '- 어떤 코스에 잘 맞는 후보가 너무 적으면 무리하게 채우지 말고, 그 코스는 적게 구성하거나 생략해도 됩니다(억지로 끼워맞추지 마세요). 가능하면 4개를 모두 만드세요.',
    '- 반드시 한국어로만 작성하세요.',
    '',
    '출력 형식(엄수): 아래 형태의 JSON 객체 하나만 출력하세요. JSON 외의 설명·마크다운·인사말은 절대 출력하지 마세요.',
    '{ "courses": [ { "id": "A", "theme": "<짧은 코스 이름>", "concept": "<1~2문장 컨셉>", "note": "<참고 한 줄 또는 null>", "stops": [ { "index": <후보 번호 정수>, "order": 1, "timing": "오전", "durationHint": "1~2시간", "description": "<한 줄>" } ] } ] }',
  ].join('\n')
}

function buildComposeUserPrompt(
  query: string,
  duration: '반나절' | '하루',
  area: string | undefined,
  candidateList: string
): string {
  return [
    '[사용자 요청]',
    query || '제주 여행 코스를 추천해 주세요.',
    `[코스 길이] ${duration}`,
    area ? `[희망 지역] ${area}` : '',
    '',
    '[후보 장소 목록]',
    candidateList,
    '',
    '위 후보만 사용하여 성격이 분명히 다른 4개 코스(A 알찬 인기형 / B 힐링형 / C 로컬·숨은형 / D 액티브형)를 JSON으로만 설계하세요.',
  ]
    .filter((s) => s !== '')
    .join('\n')
}

const VALID_IDS: ReadonlySet<string> = new Set(['A', 'B', 'C', 'D'])

/** Builds validated CourseStops from raw AI stops, mapping indices to candidates. */
function buildStops(rawStops: unknown, candidates: Candidate[]): CourseStop[] {
  if (!Array.isArray(rawStops)) return []
  const seen = new Set<number>()
  const stops: CourseStop[] = []
  for (const item of rawStops) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const idxRaw = o.index
    const n = typeof idxRaw === 'number' ? idxRaw : Number(idxRaw)
    if (!Number.isInteger(n) || n < 0 || n >= candidates.length || seen.has(n)) continue
    seen.add(n)
    const cand = candidates[n]!
    const order =
      typeof o.order === 'number' && Number.isFinite(o.order) ? o.order : stops.length + 1
    stops.push({
      order,
      name: cand.name,
      timing: toStrOrNull(o.timing),
      category: cand.category,
      description: typeof o.description === 'string' ? o.description.trim() : '',
      durationHint: toStrOrNull(o.durationHint),
      source: cand.source,
    })
  }
  // Normalize ordering to the AI's intended sequence, then re-number 1..n.
  stops.sort((a, b) => a.order - b.order)
  stops.forEach((s, i) => {
    s.order = i + 1
  })
  return stops
}

export async function generateCourses({
  query,
  duration,
  area,
}: {
  query: string
  duration?: '반나절' | '하루'
  area?: string
}): Promise<{ ok: true; courses: Course[] } | { ok: false; error: string }> {
  try {
    const trimmedQuery = (query ?? '').trim()
    const dur: '반나절' | '하루' = duration === '반나절' ? '반나절' : '하루'
    const trimmedArea = area?.trim() || undefined

    // 1. VisitJeju pool — large cached pool, with the 32-place set as a safety net.
    let pool = await getVisitJejuPool()
    if (pool.length === 0) {
      const fallback = await fetchVisitJejuPlaces()
      pool = fallback.ok ? fallback.places : []
    }
    if (pool.length === 0) return { ok: false, error: GENERIC_FAIL }

    // 2. Reduce the pool to a diverse candidate bank (filter + balanced fill).
    const keywords = deriveKeywords(trimmedQuery, trimmedArea)
    let poolCandidates = keywords.length > 0 ? filterPlacesByQuery(pool, keywords) : []
    if (poolCandidates.length < FALLBACK_SAMPLE_SIZE) {
      // Top up with a category-balanced sample so every course type has options.
      const sample = balancedSample(pool, FALLBACK_SAMPLE_SIZE)
      const seenIds = new Set(poolCandidates.map((p) => p.contentsId))
      for (const p of sample) {
        if (p.contentsId && seenIds.has(p.contentsId)) continue
        if (p.contentsId) seenIds.add(p.contentsId)
        poolCandidates.push(p)
        if (poolCandidates.length >= MAX_POOL_CANDIDATES) break
      }
    }
    if (poolCandidates.length > MAX_POOL_CANDIDATES) {
      poolCandidates = poolCandidates.slice(0, MAX_POOL_CANDIDATES)
    }

    const visitJejuCandidates: Candidate[] = poolCandidates.map((p) => ({
      name: p.title,
      category: p.categoryLabel || null,
      region: p.region || null,
      source: 'visitjeju',
    }))

    // 3. Sonar supplement for local-hidden + active places (non-fatal on failure).
    const webCandidates = await fetchLocalActivePlaces(
      trimmedQuery || '제주 여행 코스',
      trimmedArea
    )

    // Unified, index-stable candidate bank: VisitJeju first, then web.
    const candidates: Candidate[] = [...visitJejuCandidates, ...webCandidates]
    if (candidates.length === 0) return { ok: false, error: GENERIC_FAIL }

    // 4. Compose the 4 courses (sonnet) — index-only, anti-hallucination.
    const r = await runSingleAiProvider({
      supabase: noDbSupabase(),
      sessionId: null,
      userId: null,
      provider: COMPOSE_PROVIDER,
      prompt: buildComposeUserPrompt(trimmedQuery, dur, trimmedArea, buildCandidateList(candidates)),
      systemPrompt: buildComposeSystemPrompt(dur),
      maxCompletionTokens: COMPOSE_MAX_TOKENS,
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

    const rawCourses = (parsed as Record<string, unknown>).courses
    if (!Array.isArray(rawCourses)) {
      return { ok: false, error: GENERIC_FAIL }
    }

    const seenIds = new Set<string>()
    const courses: Course[] = []
    for (const item of rawCourses) {
      if (!item || typeof item !== 'object') continue
      const o = item as Record<string, unknown>
      const id = typeof o.id === 'string' ? o.id.trim().toUpperCase() : ''
      if (!VALID_IDS.has(id) || seenIds.has(id)) continue

      const stops = buildStops(o.stops, candidates)
      if (stops.length === 0) continue // a course with no valid stops is unusable

      seenIds.add(id)
      courses.push({
        id: id as CourseId,
        theme: typeof o.theme === 'string' ? o.theme.trim() : '',
        concept: typeof o.concept === 'string' ? o.concept.trim() : '',
        stops,
        note: toStrOrNull(o.note),
      })
    }

    if (courses.length === 0) {
      return { ok: false, error: GENERIC_FAIL }
    }

    // Stable A→B→C→D ordering regardless of the order the AI emitted them.
    courses.sort((a, b) => a.id.localeCompare(b.id))

    return { ok: true, courses }
  } catch {
    return { ok: false, error: GENERIC_FAIL }
  }
}
