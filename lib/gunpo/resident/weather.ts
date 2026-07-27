import 'server-only'

/**
 * 날씨·재난 — Gunpo resident(시민) mode. Consumed by GET /api/gunpo/resident/weather.
 *
 * REUSES the already-registered gunpo governance connectors (lib/gunpo/connectors.ts)
 * instead of re-implementing KMA calls: kma-gunpo-weather (초단기실황), kma-gunpo-midterm
 * (중기예보), kma-gunpo-warning (기상특보). Those connectors still carry their own
 * nx/ny, regId, stnId TODOs — nothing here hardcodes a region parameter.
 *
 * Adds one Perplexity enrichment call (생활 기상 요약), mirroring the resident-chip
 * pattern used elsewhere in this file tree.
 *
 * ISOLATION: 'server-only'; sessionId/userId null. MUST NOT import lib/jeju or
 * lib/motie. Never throws; sections degrade to null + errors[].
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { runSingleAiProvider, type ExtendedAiProviderName } from '@/lib/ai/router'
import { fetchJejuSource } from '@/lib/gunpo/connectors'
import { cleanPerplexityText, extractAsOf, kstNowIso, kstTodayIso, type ContextMeta } from './shared'

const TIMEOUT_MS = 15_000
const PERPLEXITY_PROVIDER: ExtendedAiProviderName = 'perplexity'
const CONTEXT_MAX_TOKENS = 400

export interface WeatherSection {
  ok: boolean
  text: string | null
  error: string | null
}

export interface WeatherAlertPayload {
  ok: true
  region: string
  current: WeatherSection
  midterm: WeatherSection
  warning: WeatherSection
  context: string
  contextMeta: ContextMeta
  freshnessNote: string
  updatedAt: string
  errors: string[]
}

export type WeatherAlertResult = WeatherAlertPayload | { ok: false; error: string }

function noDbSupabase(): SupabaseClient {
  return createClient('http://localhost', 'gunpo-weather-no-db') as unknown as SupabaseClient
}

async function fetchSection(sourceId: string, label: string, errors: string[]): Promise<WeatherSection> {
  try {
    const r = await fetchJejuSource(sourceId)
    if (!r.ok) {
      errors.push(`${label}: ${r.error ?? 'unknown error'}`)
      return { ok: false, text: null, error: r.error ?? 'unknown error' }
    }
    return { ok: true, text: r.text, error: null }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    errors.push(`${label}: ${msg}`)
    return { ok: false, text: null, error: msg }
  }
}

/**
 * Builds the 특보 injection block for the living-summary prompt from the
 * ALREADY-FETCHED KMA warning section text (P1-1: the summary must never
 * contradict the actual 기상특보 lookup — so we hand the AI the real result
 * instead of letting it guess/search independently).
 */
function warningInjectionBlock(warning: WeatherSection): { block: string; hasActiveWarning: boolean } {
  const text = warning.ok ? warning.text ?? '' : ''
  const hasActiveWarning = /^기상특보(?!: 현재 발효 중인 기상특보 없음)/.test(text.trim())
  if (!warning.ok || !text) {
    return {
      block: '[기상특보 조회 결과] 조회 실패 — 특보 유무를 단정하지 말고 "특보 조회 결과를 확인할 수 없음"으로만 언급하세요.',
      hasActiveWarning: false,
    }
  }
  if (!hasActiveWarning) {
    return { block: `[기상특보 조회 결과]\n${text}`, hasActiveWarning: false }
  }
  return { block: `[기상특보 조회 결과 — 현재 발효 중]\n${text}`, hasActiveWarning: true }
}

async function fetchContext(
  errors: string[],
  warning: WeatherSection
): Promise<{ text: string; meta: ContextMeta }> {
  const today = kstTodayIso()
  const retrievedAt = kstNowIso()
  const { block: warningBlock, hasActiveWarning } = warningInjectionBlock(warning)
  const systemPrompt =
    `오늘은 ${today}입니다. 가장 최신 정보 위주로, 가능하면 최근 1주일 이내 자료를 우선하라. ` +
    '당신은 경기도 군포시 생활 기상 안내원입니다. 한국어로만, 군더더기 없이 3~4문장으로 답하세요. ' +
    '인용 번호([1][3] 등)를 쓰지 말고, 한자·중문·일문 문장부호(。「」 등)를 쓰지 마세요. ' +
    '기온·강수·바람·특보 등 생활 기상 특이사항만 사실 위주로 요약하세요. ' +
    '아래 [기상특보 조회 결과]는 실제 기상청 조회값이므로 반드시 그 내용을 그대로 신뢰하고 반영하세요. ' +
    (hasActiveWarning
      ? '특보가 발효 중이므로 요약의 첫 문장에서 특보명을 명시하세요. "특보가 확인되지 않았지만" 같은, 조회 결과와 배치되는 표현은 절대 쓰지 마세요.'
      : '조회 결과 발효 중인 특보가 없으므로, 없는 특보를 지어내거나 "발효 중"이라고 쓰지 마세요.')
  const prompt =
    `경기도 군포시 오늘(${today}) 날씨·기상 특이사항을 알려주세요. ` +
    '기온, 비/바람, 특보·주의사항, 외출에 참고할 생활 기상 요약을 해주세요.\n\n' +
    warningBlock
  try {
    const r = await runSingleAiProvider({
      supabase: noDbSupabase(),
      sessionId: null,
      userId: null,
      provider: PERPLEXITY_PROVIDER,
      prompt,
      systemPrompt,
      maxCompletionTokens: CONTEXT_MAX_TOKENS,
      timeoutMs: TIMEOUT_MS,
      skipLanguageInjection: true,
    })
    if (r.error || !r.text || !r.text.trim()) {
      errors.push(`context: ${r.error || 'empty'}`)
      return { text: '', meta: { source: '검색', retrievedAt, asOf: null } }
    }
    const text = cleanPerplexityText(r.text)
    return { text, meta: { source: '검색', retrievedAt, asOf: extractAsOf(text) } }
  } catch (e: unknown) {
    errors.push(`context: ${e instanceof Error ? e.message : String(e)}`)
    return { text: '', meta: { source: '검색', retrievedAt, asOf: null } }
  }
}

/**
 * Fetch Gunpo weather + disaster info. Never throws.
 *
 * The three KMA sections run in parallel first. The Perplexity 생활 기상 요약
 * runs AFTER, because it MUST be given the real 기상특보 lookup result to
 * inject into its prompt (P1-1) — otherwise the AI can contradict the actual
 * warning section (e.g. claiming "특보 없음" while one is active).
 */
export async function getGunpoWeatherAlert(): Promise<WeatherAlertResult> {
  const errors: string[] = []

  const [currentSettled, midtermSettled, warningSettled] = await Promise.allSettled([
    fetchSection('kma-gunpo-weather', 'current', errors),
    fetchSection('kma-gunpo-midterm', 'midterm', errors),
    fetchSection('kma-gunpo-warning', 'warning', errors),
  ])

  const current: WeatherSection =
    currentSettled.status === 'fulfilled' ? currentSettled.value : { ok: false, text: null, error: 'settled-rejected' }
  const midterm: WeatherSection =
    midtermSettled.status === 'fulfilled' ? midtermSettled.value : { ok: false, text: null, error: 'settled-rejected' }
  const warning: WeatherSection =
    warningSettled.status === 'fulfilled' ? warningSettled.value : { ok: false, text: null, error: 'settled-rejected' }

  let context = ''
  let contextMeta: ContextMeta = { source: '검색', retrievedAt: kstNowIso(), asOf: null }
  try {
    const ctx = await fetchContext(errors, warning)
    context = ctx.text
    contextMeta = ctx.meta
  } catch (e: unknown) {
    errors.push(`context(settled): ${e instanceof Error ? e.message : String(e)}`)
  }

  return {
    ok: true,
    region: '경기도 군포시',
    current,
    midterm,
    warning,
    context,
    contextMeta,
    freshnessNote: '경기도 군포시 · 기상청 기준',
    updatedAt: new Date().toISOString(),
    errors,
  }
}
