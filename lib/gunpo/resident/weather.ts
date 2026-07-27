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

async function fetchContext(errors: string[]): Promise<{ text: string; meta: ContextMeta }> {
  const today = kstTodayIso()
  const retrievedAt = kstNowIso()
  const systemPrompt =
    `오늘은 ${today}입니다. 가장 최신 정보 위주로, 가능하면 최근 1주일 이내 자료를 우선하라. ` +
    '당신은 경기도 군포시 생활 기상 안내원입니다. 한국어로만, 군더더기 없이 3~4문장으로 답하세요. ' +
    '인용 번호([1][3] 등)를 쓰지 말고, 한자·중문·일문 문장부호(。「」 등)를 쓰지 마세요. ' +
    '기온·강수·바람·특보 등 생활 기상 특이사항만 사실 위주로 요약하세요.'
  const prompt =
    `경기도 군포시 오늘(${today}) 날씨·기상 특이사항을 알려주세요. ` +
    '기온, 비/바람, 특보·주의사항, 외출에 참고할 생활 기상 요약을 해주세요.'
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
 * All three KMA sections + the Perplexity context run in parallel.
 */
export async function getGunpoWeatherAlert(): Promise<WeatherAlertResult> {
  const errors: string[] = []

  const [currentSettled, midtermSettled, warningSettled, contextSettled] = await Promise.allSettled([
    fetchSection('kma-gunpo-weather', 'current', errors),
    fetchSection('kma-gunpo-midterm', 'midterm', errors),
    fetchSection('kma-gunpo-warning', 'warning', errors),
    fetchContext(errors),
  ])

  const current: WeatherSection =
    currentSettled.status === 'fulfilled' ? currentSettled.value : { ok: false, text: null, error: 'settled-rejected' }
  const midterm: WeatherSection =
    midtermSettled.status === 'fulfilled' ? midtermSettled.value : { ok: false, text: null, error: 'settled-rejected' }
  const warning: WeatherSection =
    warningSettled.status === 'fulfilled' ? warningSettled.value : { ok: false, text: null, error: 'settled-rejected' }

  let context = ''
  let contextMeta: ContextMeta = { source: '검색', retrievedAt: kstNowIso(), asOf: null }
  if (contextSettled.status === 'fulfilled') {
    context = contextSettled.value.text
    contextMeta = contextSettled.value.meta
  } else {
    errors.push(`context(settled): ${String(contextSettled.reason)}`)
  }

  return {
    ok: true,
    region: '경기도 군포시', // TODO(군포): nx/ny·regId·stnId가 채워지면 정확한 하위 지역명으로 교체
    current,
    midterm,
    warning,
    context,
    contextMeta,
    freshnessNote: '기상청 초단기실황·중기예보·기상특보 기준 (지역 파라미터 TODO — lib/gunpo/connectors.ts 참고)',
    updatedAt: new Date().toISOString(),
    errors,
  }
}
