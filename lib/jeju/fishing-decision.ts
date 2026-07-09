import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { runSingleAiProvider, type ExtendedAiProviderName } from '@/lib/ai/router'
import { getMarineData, type MarineWarning, type TideEvent, type SunInfo } from '@/lib/jeju/marine'
import {
  getFisheryPrice,
  cleanPerplexityText,
  kstTodayIso,
  type ContextMeta,
  type FisheryLatest,
} from '@/lib/jeju/fishery'
// Pure floor logic — no server-only, importable standalone for unit tests.
export {
  type Verdict,
  type FishingDecision,
  type SafetyFloor,
  verdictRank,
  computeSafetyFloor,
  clampToFloor,
} from '@/lib/jeju/fishing-floor'
import {
  type Verdict,
  type FishingDecision,
  type SafetyFloor,
  verdictRank,
  computeSafetyFloor,
  clampToFloor,
} from '@/lib/jeju/fishing-floor'

/**
 * 도민(resident) 농수산 AI 조업 판단 — the first AI-powered resident-mode widget.
 * Combines TWO upstream data layers (marine + fishery-price) and ONE AI synthesis
 * into a 3-level go/no-go decision for 40–60s fishers.
 *
 * Because it fans out to two multi-call routes + an AI call, it exceeds 30s and
 * runs behind the kick-off + polling job store (jeju_fishing_jobs), mirroring the
 * Arena/DEEP/tourist-course pattern. This module is the pure compute — the route
 * owns the job row.
 *
 * SAFETY-FIRST, DETERMINISTIC FLOOR (computed in code, not by the model):
 *   풍랑/태풍/폭풍해일 경보 active  OR  파고 ≥ 2.0m  →  verdict forced "오늘은 접자".
 * The floor is computed + re-clamped in code (see lib/jeju/fishing-floor.ts).
 *
 * ISOLATION: 'server-only'; sessionId/userId null (no DB/BYOK/credit); uses only
 * the shared AI provider + Perplexity utils + fishery date/label helpers. MUST
 * NOT import governance/synod/DEEP/Arena.
 */

const SYNTH_PROVIDER: ExtendedAiProviderName = 'anthropic' // Sonnet-tier (claude-sonnet-4-6)
const SYNTH_MAX_TOKENS = 700
const SYNTH_TIMEOUT_MS = 25_000

export interface MarineSummary {
  waveHeightM: number | null
  waterTempC: number | null
  warnings: MarineWarning[]
  lowTides: TideEvent[]
  highTides: TideEvent[]
  sun: SunInfo | null
  /** Sections that came back null/empty (for honest "정보 없음" rendering). */
  missing: string[]
}

export interface FisherySummary {
  source: 'datago' | 'perplexity'
  confidence: 'high' | 'low'
  latest: FisheryLatest | null
  context: string
}

export interface FishingDecisionPayload {
  ok: true
  species: string
  spot: string
  verdict: Verdict
  decision: FishingDecision
  safetyFloor: { forced: boolean; reasons: string[] }
  marine: MarineSummary
  fishery: FisherySummary
  contextMeta: ContextMeta
  updatedAt: string
  errors: string[]
}

export type FishingDecisionResult = FishingDecisionPayload | { ok: false; error: string }

// ── Helpers ─────────────────────────────────────────────────────────────────────

function noDbSupabase(): SupabaseClient {
  return createClient('http://localhost', 'fishing-decision-no-db') as unknown as SupabaseClient
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

const VERDICTS: readonly string[] = ['나가도 좋음', '주의', '오늘은 접자']

function coerceVerdict(v: unknown): Verdict | null {
  return typeof v === 'string' && VERDICTS.includes(v) ? (v as Verdict) : null
}

function fmtWon(n: number | null | undefined): string {
  if (n == null) return '정보 없음'
  return `₩${n.toLocaleString('ko-KR')}`
}

function fmtTime(raw: string): string {
  const clean = raw.replace(/^.*T/, '').replace(/[+Z].*$/, '').trim()
  if (/^\d{4}$/.test(clean)) return `${clean.slice(0, 2)}:${clean.slice(2)}`
  if (/^\d{2}:\d{2}/.test(clean)) return clean.slice(0, 5)
  return raw.slice(0, 5)
}

// ── Marine normalization ─────────────────────────────────────────────────────────

function summarizeMarine(
  marine: Awaited<ReturnType<typeof getMarineData>>,
  errors: string[],
): MarineSummary {
  if (!marine.ok) {
    errors.push(`marine: ${marine.error}`)
    return {
      waveHeightM: null,
      waterTempC: null,
      warnings: [],
      lowTides: [],
      highTides: [],
      sun: null,
      missing: ['파고', '수온', '물때', '일몰', '기상특보'],
    }
  }
  const missing: string[] = []
  if (marine.wave?.heightM == null) missing.push('파고')
  if (marine.waterTempC == null) missing.push('수온')
  if (!marine.tide || (marine.tide.lowTides.length === 0 && marine.tide.highTides.length === 0))
    missing.push('물때')
  if (!marine.sun?.sunset) missing.push('일몰')
  if (marine.errors.length > 0) errors.push(...marine.errors.map((e) => `marine.${e}`))

  return {
    waveHeightM: marine.wave?.heightM ?? null,
    waterTempC: marine.waterTempC,
    warnings: marine.warnings,
    lowTides: marine.tide?.lowTides ?? [],
    highTides: marine.tide?.highTides ?? [],
    sun: marine.sun,
    missing,
  }
}

// ── AI synthesis ─────────────────────────────────────────────────────────────────

function buildFactSheet(
  species: string,
  spot: string,
  marine: MarineSummary,
  fishery: FisherySummary,
  floor: SafetyFloor,
): string {
  const lines: string[] = []
  lines.push(`대상 어종: ${species}`)
  lines.push(`지점: ${spot}`)
  lines.push('')
  lines.push('[바다 상황]')
  lines.push(`- 파고: ${marine.waveHeightM != null ? `${marine.waveHeightM.toFixed(1)}m` : '정보 없음'}`)
  lines.push(`- 수온: ${marine.waterTempC != null ? `${marine.waterTempC}°C` : '정보 없음'}`)
  lines.push(
    `- 기상특보: ${
      marine.warnings.length > 0
        ? marine.warnings.map((w) => `${w.type}${w.level}`).join(', ')
        : '없음'
    }`,
  )
  lines.push(
    `- 간조(물질/조업 좋은 시각): ${
      marine.lowTides.length > 0
        ? marine.lowTides.slice(0, 3).map((t) => fmtTime(t.time)).join(', ')
        : '정보 없음'
    }`,
  )
  lines.push(`- 일몰: ${marine.sun?.sunset ? fmtTime(marine.sun.sunset) : '정보 없음'}`)
  lines.push('')
  lines.push('[어가/시황]')
  lines.push(`- 자료 출처: ${fishery.source === 'datago' ? '위판 집계(공식)' : '검색(추정)'}`)
  if (fishery.latest) {
    lines.push(`- 최근 위판일: ${fishery.latest.date}`)
    lines.push(`- 평균가(kg): ${fmtWon(fishery.latest.avgPrice)}`)
    if (fishery.latest.highPrice != null) lines.push(`- 고가: ${fmtWon(fishery.latest.highPrice)}`)
    if (fishery.latest.lowPrice != null) lines.push(`- 저가: ${fmtWon(fishery.latest.lowPrice)}`)
    if (fishery.latest.market) lines.push(`- 위판장: ${fishery.latest.market}`)
  } else {
    lines.push('- 가격: 정보 없음')
  }
  if (fishery.context) lines.push(`- 시황 요약: ${fishery.context}`)
  lines.push('')
  lines.push('[안전 판정 하한선 — 반드시 준수]')
  if (floor.forced) {
    lines.push(`- 위험 조건 충족: ${floor.reasons.join('; ')}`)
    lines.push('- 따라서 verdict는 반드시 "오늘은 접자"여야 한다. 다른 값 금지.')
  } else {
    lines.push('- 강제 위험 조건 없음. "나가도 좋음" 또는 "주의" 중에서 선택하라.')
    lines.push('- "오늘은 접자"는 이 경우 선택하지 말라(위험 하한선 미충족).')
  }
  return lines.join('\n')
}

async function synthesize(
  species: string,
  spot: string,
  marine: MarineSummary,
  fishery: FisherySummary,
  floor: SafetyFloor,
  errors: string[],
): Promise<FishingDecision> {
  const today = kstTodayIso()
  const systemPrompt =
    `오늘은 ${today}입니다. 가장 최신 정보 위주로 판단하라. ` +
    '당신은 제주 어민을 돕는 조업 판단 도우미입니다. 40~60대 어민이 읽습니다. ' +
    '쉽고 짧은 한국어 문장만 쓰세요. 인용 번호([1][3] 등)와 한자·중문·일문 문장부호(。「」 등)를 쓰지 마세요. ' +
    '반드시 아래 JSON 형식만 출력하세요(설명·마크다운 금지):\n' +
    '{"verdict":"나가도 좋음|주의|오늘은 접자","headline":"한 문장","reasons":["짧은 근거 2~4개"],"priceNote":"가격 한 줄","safetyNote":"안전 한 줄"}\n' +
    'verdict는 반드시 안전 하한선을 따르라. 없는 숫자를 지어내지 말고, 정보가 없으면 "정보 없음"이라고 쓰라. ' +
    'reasons에는 실제 입력값(파고, 특보, 어가, 시황)을 인용하라. ' +
    'safetyNote는 물때 간조 시각이나 일몰 전 귀항 등 바다 안전과 연결하라.'
  const prompt =
    '아래 자료만 근거로 오늘 조업 여부를 판단해 JSON으로 답하세요.\n\n' + buildFactSheet(species, spot, marine, fishery, floor)

  let decision: FishingDecision | null = null
  try {
    const r = await runSingleAiProvider({
      supabase: noDbSupabase(),
      sessionId: null,
      userId: null,
      provider: SYNTH_PROVIDER,
      prompt,
      systemPrompt,
      maxCompletionTokens: SYNTH_MAX_TOKENS,
      timeoutMs: SYNTH_TIMEOUT_MS,
      temperature: 0.2,
      skipLanguageInjection: true,
    })
    if (r.error || !r.text || !r.text.trim()) {
      errors.push(`synthesis: ${r.error || 'empty'}`)
    } else {
      try {
        const parsed = JSON.parse(extractJsonObject(r.text)) as Record<string, unknown>
        decision = {
          verdict: coerceVerdict(parsed.verdict) ?? (floor.forced ? '오늘은 접자' : '주의'),
          headline: cleanPerplexityText(typeof parsed.headline === 'string' ? parsed.headline : ''),
          reasons: Array.isArray(parsed.reasons)
            ? parsed.reasons
                .filter((x): x is string => typeof x === 'string')
                .map((x) => cleanPerplexityText(x))
                .filter(Boolean)
                .slice(0, 4)
            : [],
          priceNote: cleanPerplexityText(typeof parsed.priceNote === 'string' ? parsed.priceNote : ''),
          safetyNote: cleanPerplexityText(typeof parsed.safetyNote === 'string' ? parsed.safetyNote : ''),
        }
      } catch {
        errors.push('synthesis: JSON parse failed')
      }
    }
  } catch (e: unknown) {
    errors.push(`synthesis: ${e instanceof Error ? e.message : String(e)}`)
  }

  // Deterministic fallback decision when the AI is unavailable/unparseable.
  if (!decision) {
    decision = buildFallbackDecision(marine, fishery, floor)
  }

  // Backfill any field the model left blank (esp. priceNote) from real data.
  decision = fillBlanks(decision, marine, fishery)

  // Re-clamp to the safety floor — the model can NEVER override it.
  decision = clampToFloor(decision, floor)
  return decision
}

/** Deterministic price line from official/fallback data. */
function defaultPriceNote(fishery: FisherySummary): string {
  if (fishery.latest?.avgPrice == null) return '어가 정보 없음'
  const tag = fishery.source === 'datago' ? '위판 평균' : '추정 시세'
  return `${tag} ${fmtWon(fishery.latest.avgPrice)}/kg (${fishery.latest.date} 기준)`
}

/** Guarantee no user-facing field is empty; fill from real inputs when blank. */
function fillBlanks(
  decision: FishingDecision,
  marine: MarineSummary,
  fishery: FisherySummary,
): FishingDecision {
  const sunset = marine.sun?.sunset ? fmtTime(marine.sun.sunset) : null
  return {
    ...decision,
    headline: decision.headline || '오늘 조업 판단 결과입니다.',
    reasons: decision.reasons.length > 0 ? decision.reasons : ['입력 자료가 부족해요'],
    priceNote: decision.priceNote || defaultPriceNote(fishery),
    safetyNote:
      decision.safetyNote ||
      (sunset ? `일몰 ${sunset} 전에 반드시 귀항하세요.` : '바다 상황을 한 번 더 확인하세요.'),
  }
}

/** Non-AI decision from raw facts, used if the model call fails/parses badly. */
function buildFallbackDecision(
  marine: MarineSummary,
  fishery: FisherySummary,
  floor: SafetyFloor,
): FishingDecision {
  const reasons: string[] = []
  if (marine.waveHeightM != null) reasons.push(`파고 ${marine.waveHeightM.toFixed(1)}m`)
  if (marine.warnings.length > 0) {
    reasons.push(marine.warnings.map((w) => `${w.type}${w.level}`).join(', '))
  }
  if (fishery.latest?.avgPrice != null) reasons.push(`어가 평균 ${fmtWon(fishery.latest.avgPrice)}/kg`)
  if (marine.missing.length > 0) reasons.push(`${marine.missing.join('·')} 정보 없음`)

  const verdict: Verdict = floor.forced ? '오늘은 접자' : '주의'
  const priceNote = fishery.latest?.avgPrice != null
    ? `${fmtWon(fishery.latest.avgPrice)}/kg (${fishery.latest.date} 기준)`
    : '어가 정보 없음'
  const sunset = marine.sun?.sunset ? fmtTime(marine.sun.sunset) : null
  const safetyNote = sunset
    ? `일몰 ${sunset} 전에 반드시 귀항하세요.`
    : '바다 상황을 한 번 더 확인하고 나가세요.'

  return {
    verdict,
    headline: floor.forced
      ? '오늘은 바다가 위험해요. 조업을 미루세요.'
      : '자동 판단입니다. 상황을 직접 한 번 더 확인하세요.',
    reasons: reasons.length > 0 ? reasons : ['입력 자료가 부족해요'],
    priceNote,
    safetyNote,
  }
}

/** The safety floor is absolute — delegated to lib/jeju/fishing-floor.ts (pure). */
// clampToFloor is imported from @/lib/jeju/fishing-floor above.

// ── Public entry ──────────────────────────────────────────────────────────────

/**
 * Run the full fishing-decision compute. Never throws.
 * Marine + fishery fetch in parallel, safety floor is computed in code, one
 * Sonnet-tier AI call synthesizes the verdict, then the code re-clamps to floor.
 */
export async function runFishingDecision(
  speciesInput?: string | null,
  spotInput?: string | null,
): Promise<FishingDecisionResult> {
  const species = (speciesInput ?? '').trim()
  const spot = (spotInput ?? '').trim() || '이호테우'
  if (!species) {
    return { ok: false, error: 'species는 필수입니다.' }
  }

  const errors: string[] = []

  const [marineRaw, fisheryRaw] = await Promise.all([
    getMarineData(spot).catch((e: unknown) => ({
      ok: false as const,
      error: e instanceof Error ? e.message : String(e),
    })),
    getFisheryPrice(species).catch((e: unknown) => ({
      ok: false as const,
      error: e instanceof Error ? e.message : String(e),
    })),
  ])

  const marine = summarizeMarine(marineRaw, errors)

  let fishery: FisherySummary
  let contextMeta: ContextMeta
  if (fisheryRaw.ok) {
    fishery = {
      source: fisheryRaw.source,
      confidence: fisheryRaw.confidence,
      latest: fisheryRaw.latest,
      context: fisheryRaw.context,
    }
    contextMeta = fisheryRaw.contextMeta
  } else {
    errors.push(`fishery: ${fisheryRaw.error}`)
    fishery = { source: 'perplexity', confidence: 'low', latest: null, context: '' }
    contextMeta = { source: '검색', retrievedAt: new Date().toISOString(), asOf: null }
  }

  const floor = computeSafetyFloor(marine)
  const decision = await synthesize(species, spot, marine, fishery, floor, errors)

  return {
    ok: true,
    species,
    spot,
    verdict: decision.verdict,
    decision,
    safetyFloor: { forced: floor.forced, reasons: floor.reasons },
    marine,
    fishery,
    contextMeta,
    updatedAt: new Date().toISOString(),
    errors,
  }
}
