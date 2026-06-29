import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { runSingleAiProvider, type ExtendedAiProviderName } from '@/lib/ai/router'
import { getVisitJejuPool, type VisitJejuPlace } from '@/lib/jeju/connectors'

/**
 * Jeju TOURIST mode — festivals/events chip.
 *
 * STRATEGY (verified 2026-06-29):
 *   - odcloud 비짓제주 축제행사콘텐츠: 792 items, corpus is stale (only 1 event active
 *     in 2026). NOT suitable for "currently running" queries.
 *   - VisitJeju searchList c5: 604 items but NO date fields at all (시작일/종료일
 *     absent from schema). Cannot date-filter.
 *   → Use Perplexity sonar with a tightly-constrained official-sources-only prompt.
 *     Sonar does real-time web retrieval against jeju.go.kr / visitjeju.net /
 *     city halls. We inject today, demand YYYY-MM-DD dates, reject campaigns/vague
 *     items, and filter server-side to endDate >= today.
 *   → Fallback to VisitJeju c5 (general festival list, no date filter) if sonar
 *     returns nothing, so the chip is never blank.
 *
 * ISOLATION: 'server-only', sessionId/userId null, noDbSupabase() never used for I/O.
 * Never throws.
 */

const FESTIVAL_PROVIDER: ExtendedAiProviderName = 'perplexity'
const FESTIVAL_MAX_TOKENS = 1400
const MAX_FALLBACK = 12

// ── Sonar item ────────────────────────────────────────────────────────────────

/** A festival/event sourced from Perplexity sonar (no guaranteed coords). */
export interface FestivalEvent {
  name: string
  startDate: string   // YYYY-MM-DD
  endDate: string     // YYYY-MM-DD
  venue: string | null
  intro: string
  source: 'sonar'
}

// ── API return type ────────────────────────────────────────────────────────────

export type FestivalResult =
  | { ok: true; type: 'sonar'; events: FestivalEvent[] }
  | { ok: true; type: 'fallback'; festivals: VisitJejuPlace[] }
  | { ok: false; error: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Throwaway Supabase client — sessionId/userId null means no DB I/O. */
function noDbSupabase(): SupabaseClient {
  return createClient(
    'http://localhost',
    'tourist-festivals-no-db'
  ) as unknown as SupabaseClient
}

/** Strips ``` fences then extracts the first JSON array substring. */
function extractJsonArray(raw: string): string {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i)
  if (fence?.[1]) text = fence[1].trim()
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  return start !== -1 && end > start ? text.slice(start, end + 1) : text
}

function toStrOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s !== '' && s.toLowerCase() !== 'null' ? s : null
}

function isDateStr(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())
}

// ── Sonar prompt ──────────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return [
    '당신은 제주도 공식 행사 정보를 찾아주는 도우미입니다.',
    '규칙(반드시 준수):',
    '- 반드시 시작일과 종료일이 명확한 실제 행사만. 날짜를 모르면 포함하지 마세요.',
    '- 제주도청(jeju.go.kr), 제주시청, 서귀포시청, 비짓제주(visitjeju.net) 공식 채널에서 확인 가능한 행사만.',
    '- "○○의 해", "○○ 캠페인" 같은 연중 사업이나 막연한 통칭은 제외.',
    '- 추측하거나 지어내지 마세요. 공식 채널에서 확인 가능한 것만.',
    '- 날짜 형식: 반드시 YYYY-MM-DD.',
    '- venue는 구체적인 장소명(예: 서귀포예술의전당, 제주돌문화공원). 명확하지 않으면 null.',
    '- 반드시 한국어로만 작성.',
    '',
    '출력: JSON 배열만. 예시: [{"name":"...","startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD","venue":"...","intro":"..."}]',
    '없으면 빈 배열 []. JSON 외의 설명·마크다운·인사말은 절대 출력하지 마세요.',
  ].join('\n')
}

function buildUserPrompt(today: string): string {
  return [
    `오늘은 ${today}입니다. 제주도청(jeju.go.kr), 제주시청, 서귀포시청, 비짓제주(visitjeju.net) 공식 채널 기준으로,`,
    `오늘 날짜에 '실제로 진행 중이거나 곧 시작하는(2주 이내)' 제주 축제·행사·전시를 알려주세요.`,
    '규칙:',
    '- 반드시 시작일과 종료일이 명확한 실제 행사만. 날짜를 모르면 포함하지 마세요.',
    "- '○○의 해', '○○ 캠페인' 같은 연중 사업이나 막연한 통칭은 제외.",
    '- 추측하거나 지어내지 마세요. 공식 채널에서 확인 가능한 것만.',
    '- 각 항목: 행사명, 시작일~종료일(YYYY-MM-DD), 장소(구체적 장소명), 한 줄 소개.',
    'JSON 배열로만: [{"name":"...","startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD","venue":"...","intro":"..."}]',
    '없으면 빈 배열 [].',
  ].join('\n')
}

// ── c5 fallback ───────────────────────────────────────────────────────────────

const SEASON_KEYWORDS: Record<number, string[]> = {
  1: ['겨울', '눈', '동백', '설'],
  2: ['겨울', '동백', '매화', '설'],
  3: ['봄', '벚꽃', '유채', '매화'],
  4: ['봄', '벚꽃', '유채', '튤립'],
  5: ['봄', '장미', '철쭉', '청보리'],
  6: ['여름', '수국', '루피너스'],
  7: ['여름', '해변', '해수욕', '수국'],
  8: ['여름', '해변', '해수욕', '밤'],
  9: ['가을', '메밀', '억새', '코스모스'],
  10: ['가을', '억새', '단풍', '메밀', '핑크뮬리', '국화'],
  11: ['가을', '단풍', '감귤', '국화'],
  12: ['겨울', '동백', '눈', '귤', '빛'],
}

function parseYearMonth(today: string): { year: number; month: number } {
  const m = today.match(/^(\d{4})-(\d{2})/)
  const now = new Date()
  return {
    year: m ? parseInt(m[1]!, 10) : now.getFullYear(),
    month: m ? parseInt(m[2]!, 10) : now.getMonth() + 1,
  }
}

function isExcludedPastOrCancelled(place: VisitJejuPlace, currentYear: number): boolean {
  const hay = `${place.title} ${place.introduction}`
  if (/취소/.test(hay)) return true
  const years = Array.from(hay.matchAll(/\b(20\d{2})\b/g)).map((mm) => parseInt(mm[1]!, 10))
  if (years.length === 0) return false
  return Math.max(...years) < currentYear
}

function isSeasonRelevant(place: VisitJejuPlace, month: number): boolean {
  const keywords = SEASON_KEYWORDS[month] ?? []
  const hay = `${place.title} ${place.introduction}`
  return keywords.some((k) => hay.includes(k))
}

async function c5Fallback(today: string): Promise<VisitJejuPlace[]> {
  try {
    const { year, month } = parseYearMonth(today)
    const pool = await getVisitJejuPool()
    const c5 = pool.filter((p) => p.categoryCode === 'c5')
    const eligible = c5.filter((p) => !isExcludedPastOrCancelled(p, year))
    const src = eligible.length > 0 ? eligible : c5
    const scored = src.map((place, idx) => ({
      place,
      tier: isSeasonRelevant(place, month) ? 1 : 0,
      idx,
    }))
    scored.sort((a, b) => b.tier - a.tier || a.idx - b.idx)
    return scored.slice(0, MAX_FALLBACK).map((s) => s.place)
  } catch {
    return []
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Returns currently-running/upcoming Jeju festivals via sonar, with c5 fallback.
 * Never throws.
 */
export async function getCurrentFestivals({
  today,
}: {
  today: string
}): Promise<FestivalResult> {
  try {
    const r = await runSingleAiProvider({
      supabase: noDbSupabase(),
      sessionId: null,
      userId: null,
      provider: FESTIVAL_PROVIDER,
      prompt: buildUserPrompt(today),
      systemPrompt: buildSystemPrompt(),
      maxCompletionTokens: FESTIVAL_MAX_TOKENS,
      timeoutMs: 30_000,
    })

    if (!r.error && r.text?.trim()) {
      try {
        const parsed = JSON.parse(extractJsonArray(r.text)) as unknown
        if (Array.isArray(parsed)) {
          const events: FestivalEvent[] = []
          for (const item of parsed) {
            if (!item || typeof item !== 'object') continue
            const o = item as Record<string, unknown>
            const name = typeof o.name === 'string' ? o.name.trim() : ''
            if (!name) continue
            if (!isDateStr(o.startDate) || !isDateStr(o.endDate)) continue
            const startDate = (o.startDate as string).trim()
            const endDate = (o.endDate as string).trim()
            // Only include events not yet ended
            if (endDate < today) continue
            events.push({
              name,
              startDate,
              endDate,
              venue: toStrOrNull(o.venue),
              intro: typeof o.intro === 'string' ? o.intro.trim() : '',
              source: 'sonar',
            })
          }
          events.sort((a, b) => a.startDate.localeCompare(b.startDate))
          if (events.length > 0) {
            return { ok: true, type: 'sonar', events }
          }
        }
      } catch {
        // JSON parse failed — fall through to c5 fallback
      }
    }

    // Sonar returned empty or failed → c5 fallback
    const fallback = await c5Fallback(today)
    if (fallback.length > 0) {
      return { ok: true, type: 'fallback', festivals: fallback }
    }
    return { ok: false, error: '축제 정보를 불러오지 못했어요. 다시 시도해 주세요.' }
  } catch {
    return { ok: false, error: '축제 정보를 불러오지 못했어요. 다시 시도해 주세요.' }
  }
}
