import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { runSingleAiProvider, type ExtendedAiProviderName } from '@/lib/ai/router'
import { getVisitJejuPool, type JejuAttraction } from '@/lib/jeju/connectors'
import { getAttractionsByField, NATURE_FIELDS, CULTURE_FIELDS } from '@/lib/jeju/attraction-utils'

/**
 * Jeju TOURIST mode — "관광객은 잘 모르는" local-gems feature.
 *
 * DATA STRATEGY (blend to defeat sonar's food/cafe web bias):
 *   1. Sonar (Perplexity) — keeps its strength: local 맛집·카페·hidden spots.
 *      Ask for 4-5 items (fewer so food doesn't flood).
 *   2. Official attractions (odcloud 15111742) — GUARANTEED nature/culture/oreum
 *      with real coords. 3 자연·오름 + 2 문화·예술 sampled from 514+ real spots.
 *   3. Blend: dedupe by name, interleave official ↔ sonar for a true mix.
 *
 * ISOLATION: 'server-only', sessionId/userId null, noDbSupabase() never used for I/O.
 * Never throws.
 */

const LOCAL_PROVIDER: ExtendedAiProviderName = 'perplexity'

/** Tokens for 4-5 sonar gems (less than before — official supplements). */
const LOCAL_MAX_TOKENS = 900

const GENERIC_FAIL = '주변 정보를 불러오지 못했어요. 다시 시도해 주세요.'

/**
 * A local spot to show in the chip results.
 *   source:'web'      — came from sonar; no guaranteed coords.
 *   source:'official' — came from official odcloud attractions; lat/lng always present.
 *   verified          — name matches the VisitJeju pool (both web and official can be true).
 *   lat/lng           — always set for source:'official'; always absent for source:'web'.
 */
export interface LocalGem {
  name: string
  area: string | null
  description: string
  tags: string[]
  caution: string | null
  source: 'web' | 'official'
  verified: boolean
  lat?: number
  lng?: number
}

function noDbSupabase(): SupabaseClient {
  return createClient('http://localhost', 'tourist-local-no-db') as unknown as SupabaseClient
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

function buildSystemPrompt(today: string): string {
  return [
    '당신은 제주 현지 사정에 밝은 로컬 여행 안내자입니다.',
    `오늘은 ${today} 입니다. 반드시 최신(가능하면 최근 1년 이내) 정보를 우선해서 찾아주세요.`,
    '현지인이 아끼지만 관광객은 잘 모르거나 일반 관광 코스에서 빠지는 제주의 로컬 장소 4~5곳을 추천하세요.',
    '별도로 공식 자연·문화 명소를 이미 제공하므로, 여기서는 로컬 맛집·카페·작은 박물관·체험·숨은 문화공간 위주로 찾아주세요.',
    '알려져 있지만 관광객이 잘 들르지 않는 곳도 좋습니다 — 예: 엉또폭포(비 온 뒤에만 물이 흐름), 원앙폭포.',
    '',
    '엄수 규칙(매우 중요):',
    '- 반드시 한국어로만 작성하세요. 외국어(아랍어·영어 등)를 절대 섞지 마세요.',
    '- 정보가 거의 없는 무명 장소를 억지로 만들어내지 마세요. 웹에 실제 정보가 있는, 검증 가능한 실재 장소만 추천하세요.',
    '- 이름·위치가 확실하지 않으면 포함하지 마세요.',
    `- ${today} 기준으로 최신 정보를 우선하세요. 오래된(1년 이상 전) 정보로 의심되면 caution에 "정보가 오래됐을 수 있음"을 명시하세요.`,
    '- 폐업·이전 가능성이 있으면 caution에 명시하세요.',
    '- 위치가 불확실하면 caution에 솔직히 적으세요.',
    '- caution에는 방문에 도움되는 사실 기반 실용 정보만 적으세요 (예: 운영시간 변동 가능, 주차 어려움, 예약 권장, 도로 좁음, 위치 찾기 어려움). 특정 업소를 "광고·협찬·홍보성일 수 있다"거나 신뢰성을 의심하는 표현은 절대 쓰지 마세요. 추측성·부정적 평가 금지. 적을 실용 정보가 없으면 caution은 null로 두세요.',
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
    `오늘(${today}) 기준 최신 정보로, 위 요청에 맞는 제주의 로컬 장소(맛집·카페·체험·숨은 문화공간 등) 4~5곳을 찾아 JSON으로만 답하세요. 관광객이 잘 모르거나 코스에서 빠지지만 검증 가능한 실재 장소 위주로 골라 주세요.`,
  ].join('\n')
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '')
}

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

function toTags(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.trim().replace(/^#/, ''))
    .filter((t) => t !== '')
    .slice(0, 5)
}

function toStrOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s !== '' && s.toLowerCase() !== 'null' ? s : null
}

/**
 * Extracts a short area string from a Korean road address.
 * "제주특별자치도 서귀포시 안덕면 사계남로…" → "서귀포시 안덕면"
 */
function extractAreaFromAddress(address: string): string | null {
  if (!address) return null
  const m = address.match(/제주(?:특별자치도)?\s+([^\s]+(?:시|군))(?:\s+([^\s]+(?:읍|면|동|리)))?/)
  if (!m) return null
  const city = m[1] ?? ''
  const district = m[2] ?? ''
  return district ? `${city} ${district}` : city
}

/** Maps a JejuAttraction to LocalGem (source:'official', coords always present). */
function attractionToGem(a: JejuAttraction): LocalGem {
  const intro = a.intro.trim()
  return {
    name: a.name,
    area: extractAreaFromAddress(a.roadAddress),
    description: intro.length > 100 ? `${intro.slice(0, 97)}…` : intro,
    tags: [a.field, ...(a.category && a.category !== a.field ? [a.category] : [])].filter(Boolean),
    caution: null,
    source: 'official',
    verified: true,
    lat: a.lat,
    lng: a.lng,
  }
}

/**
 * Simple hash of a string for daily seed rotation.
 * Different days → different starting offset in the attraction list.
 */
function dailySeed(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h, 33) ^ s.charCodeAt(i)
  }
  return Math.abs(h)
}

/**
 * Fetches 3 자연/오름 + 2 문화/예술 official attractions, rotated daily.
 * Never throws — returns [] on any failure.
 */
async function fetchOfficialGems(today: string): Promise<LocalGem[]> {
  try {
    const seed = dailySeed(today)

    const [naturePool, culturePool] = await Promise.all([
      getAttractionsByField([...NATURE_FIELDS], { limit: 400 }),
      getAttractionsByField([...CULTURE_FIELDS], { limit: 400 }),
    ])

    // Rotate starting position daily so the same 3 items don't always show.
    const pickN = (pool: JejuAttraction[], count: number): JejuAttraction[] => {
      if (pool.length === 0) return []
      const offset = seed % pool.length
      const rotated = [...pool.slice(offset), ...pool.slice(0, offset)]
      return rotated.slice(0, count)
    }

    const naturePicks = pickN(naturePool, 3)
    const culturePicks = pickN(culturePool, 2)

    return [...naturePicks, ...culturePicks].map(attractionToGem)
  } catch {
    return []
  }
}

/** Blends official + sonar gems: dedupes by name, interleaves, caps at 9. */
function blendGems(official: LocalGem[], sonar: LocalGem[]): LocalGem[] {
  const offNames = new Set(official.map((g) => normalizeName(g.name)))

  // Dedupe sonar: drop items whose name matches an official gem.
  const dedupedSonar = sonar.filter((g) => {
    const n = normalizeName(g.name)
    return !offNames.has(n) && !official.some(
      (o) => normalizeName(o.name).includes(n) || n.includes(normalizeName(o.name))
    )
  })

  // Interleave: official[0], sonar[0], official[1], sonar[1], ...
  const result: LocalGem[] = []
  const maxLen = Math.max(official.length, dedupedSonar.length)
  for (let i = 0; i < maxLen && result.length < 9; i++) {
    if (i < official.length) result.push(official[i]!)
    if (result.length < 9 && i < dedupedSonar.length) result.push(dedupedSonar[i]!)
  }
  return result
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

    // Run sonar + official attractions in parallel.
    const [sonarResult, officialGems] = await Promise.all([
      runSingleAiProvider({
        supabase: noDbSupabase(),
        sessionId: null,
        userId: null,
        provider: LOCAL_PROVIDER,
        prompt: buildUserPrompt(trimmed, today),
        systemPrompt: buildSystemPrompt(today),
        maxCompletionTokens: LOCAL_MAX_TOKENS,
      }),
      fetchOfficialGems(today),
    ])

    // Parse sonar output (non-fatal — official gems alone are still useful).
    let sonarGems: LocalGem[] = []
    if (!sonarResult.error && sonarResult.text?.trim()) {
      try {
        const parsed = JSON.parse(extractJsonObject(sonarResult.text)) as unknown
        if (parsed && typeof parsed === 'object') {
          const rawGems = (parsed as Record<string, unknown>).gems
          if (Array.isArray(rawGems)) {
            const isVerified = await buildVerifier()
            for (const item of rawGems) {
              if (!item || typeof item !== 'object') continue
              const o = item as Record<string, unknown>
              const name = typeof o.name === 'string' ? o.name.trim() : ''
              if (!name) continue
              sonarGems.push({
                name,
                area: toStrOrNull(o.area),
                description: typeof o.description === 'string' ? o.description.trim() : '',
                tags: toTags(o.tags),
                caution: toStrOrNull(o.caution),
                source: 'web',
                verified: isVerified(name),
              })
            }
          }
        }
      } catch {
        // sonar parse failed — official gems still shown
      }
    }

    const gems = blendGems(officialGems, sonarGems)

    if (gems.length === 0) {
      return { ok: false, error: GENERIC_FAIL }
    }

    return { ok: true, gems }
  } catch {
    return { ok: false, error: GENERIC_FAIL }
  }
}
