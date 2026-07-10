import 'server-only'

/**
 * SHARED Jeju daily price data layer — 도민(resident) mode 물가·생활 chip.
 * Consumed by GET /api/domin/prices. Pure proxy, no DB.
 *
 * Upstream: KAMIS dailySalesList (농수산물유통정보, kamis.or.kr).
 * Reuses lib/jeju/connectors.ts:
 *   - JEJU_KAMIS_ITEMS allowlist
 *   - connector's buildUrl() for the KAMIS endpoint + credentials
 *   - filterKamisJejuItems for the same subset the governance engine uses
 *
 * Perplexity (always-on enrichment + optional fallback):
 *   - ENRICHMENT: "제주 오늘 장바구니 물가 특이사항 {today}" → context + contextMeta.
 *   - FALLBACK: if KAMIS empty/fails, ask Perplexity for Jeju price highlights.
 *
 * ISOLATION: 'server-only'; sessionId/userId null; MUST NOT import
 * governance/synod/DEEP/Arena. Only shared helpers (fishery, connectors).
 * Never throws; sections degrade to [] with errors[] entries.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { runSingleAiProvider, type ExtendedAiProviderName } from '@/lib/ai/router'
import { JEJU_KAMIS_ITEMS } from '@/lib/jeju/connectors'
import {
  cleanPerplexityText,
  kstTodayIso,
  type ContextMeta,
} from '@/lib/jeju/fishery'
import { recordDebug, type DebugSink } from '@/lib/jeju/debug-capture'

// ── Constants ─────────────────────────────────────────────────────────────────

const KAMIS_URL = (() => {
  const certKey = process.env.KAMIS_CERT_KEY ?? ''
  const certId = process.env.KAMIS_CERT_ID ?? ''
  const params = new URLSearchParams({
    action: 'dailySalesList',
    p_cert_key: certKey,
    p_cert_id: certId,
    p_returntype: 'json',
  })
  return `http://www.kamis.or.kr/service/price/xml.do?${params.toString()}`
})

/** 15s (was 10s) — mobile networks add latency on top of upstream response time. */
const TIMEOUT_MS = 15_000
/** Backoff before the single automatic retry on a transient failure. */
const RETRY_DELAY_MS = 500
const BODY_SNIPPET = 300
const PERPLEXITY_PROVIDER: ExtendedAiProviderName = 'perplexity'
const CONTEXT_MAX_TOKENS = 450
/** 900 (was 380) — the JSON schema response needs more headroom than the old
 *  terse text lines did; too low truncates the JSON before its closing brackets. */
const FALLBACK_MAX_TOKENS = 900
const FRESHNESS_NOTE = 'KAMIS 일별 시세 (전일 기준)'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PriceItem {
  itemName: string
  unit: string
  /** 소매/도매 */
  cls: string
  /** 전일 가격 (dpr1) */
  retailPrice: number | null
  /** 1일 전 (dpr2) */
  dayAgo: number | null
  /** 1개월 전 (dpr3) */
  monthAgo: number | null
  /** 1년 전 (dpr4) */
  yearAgo: number | null
  /** 0 = 하락, 1 = 상승, null = 변동없음/모름 */
  direction: 0 | 1 | null
  /** 전일 대비 변동률 (%) */
  changePct: number | null
  /**
   * Explicit category from the JSON-structured Perplexity fallback — when
   * present, groupItems() uses this instead of keyword-based classifyItem().
   * undefined for KAMIS items (keyword classification still applies there).
   */
  category?: keyof PriceGroups
  /**
   * Upper bound of an AI-estimated price range (Perplexity fallback only).
   * retailPrice holds the conservative low estimate as the primary number.
   */
  priceHighEstimate?: number | null
}

export interface PriceGroups {
  농산물: PriceItem[]
  수산물: PriceItem[]
  가공축산: PriceItem[]
}

export interface PricesPayload {
  ok: true
  source: 'kamis' | 'perplexity'
  confidence: 'high' | 'low'
  updated: string
  groups: PriceGroups
  context: string
  contextMeta: ContextMeta
  freshnessNote: string
  updatedAt: string
  errors: string[]
}

export type PricesResult = PricesPayload | { ok: false; error: string }

// ── Inline Jeju filter (mirrors connector's private filterKamisJejuItems) ────

/**
 * Keeps only KAMIS price rows whose item_name matches an entry in
 * JEJU_KAMIS_ITEMS. Mirrors the private function in connectors.ts.
 */
function filterKamisJejuItems(rawJson: unknown): { error_code: unknown; price: Record<string, unknown>[] } {
  const obj = rawJson && typeof rawJson === 'object' ? (rawJson as Record<string, unknown>) : {}
  const price = Array.isArray(obj.price) ? (obj.price as Record<string, unknown>[]) : []
  const kept = price.filter((row) => {
    const name = typeof row?.item_name === 'string' ? row.item_name : ''
    return JEJU_KAMIS_ITEMS.some((allowed) => name.includes(allowed))
  })
  return { error_code: obj.error_code, price: kept }
}

// ── Category classification ───────────────────────────────────────────────────

const FISHERY_KEYWORDS = ['갈치', '고등어', '전복', '오징어', '한치', '방어', '옥돔', '문어', '게', '새우', '멸치']
const LIVESTOCK_KEYWORDS = ['돼지', '계란', '닭', '소', '우유', '치즈', '버터']

function classifyItem(name: string): keyof PriceGroups {
  if (FISHERY_KEYWORDS.some((k) => name.includes(k))) return '수산물'
  if (LIVESTOCK_KEYWORDS.some((k) => name.includes(k))) return '가공축산'
  return '농산물'
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function noDbSupabase(): SupabaseClient {
  return createClient('http://localhost', 'prices-no-db') as unknown as SupabaseClient
}

function kstNowIso(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())}` +
    `T${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}:${pad(kst.getUTCSeconds())}+09:00`
  )
}

function redactKey(url: string): string {
  return url.replace(/p_cert_key=[^&]*/i, 'p_cert_key=***').replace(/p_cert_id=[^&]*/i, 'p_cert_id=***')
}

function parsePrice(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string' || !v.trim()) return null
  const n = Number(v.trim().replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

function extractAsOf(text: string): string | null {
  const full = text.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/)
  if (full) return `${full[1]}-${full[2].padStart(2, '0')}-${full[3].padStart(2, '0')}`
  const ymKo = text.match(/(\d{4})년\s*(\d{1,2})월/)
  if (ymKo) return `${ymKo[1]}-${ymKo[2].padStart(2, '0')}`
  return null
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

// ── Raw KAMIS row → PriceItem ─────────────────────────────────────────────────

function toItem(row: Record<string, unknown>): PriceItem | null {
  const itemName = str(row.item_name) || str(row.itemName)
  if (!itemName) return null

  // Confirm still in allowlist (defensive — filterKamisJejuItems already ran)
  if (!JEJU_KAMIS_ITEMS.some((k) => itemName.includes(k))) return null

  const unit = str(row.unit)
  // cls: "소매" (dpr1 = retail) or "도매" (dpr1 = wholesale)
  const cls = str(row.cls_nm) || str(row.clsNm) || str(row.cls) || ''

  const dpr1 = parsePrice(row.dpr1) // 전일 (current reference)
  const dpr2 = parsePrice(row.dpr2) // 1일 전
  const dpr3 = parsePrice(row.dpr3) // 1개월 전
  const dpr4 = parsePrice(row.dpr4) // 1년 전

  // direction from KAMIS: "1" = up, "0" = down (relative to previous day)
  const dirStr = str(row.direction)
  const direction: 0 | 1 | null =
    dirStr === '1' ? 1 : dirStr === '0' ? 0 : null

  let changePct: number | null = null
  if (dpr1 != null && dpr2 != null && dpr2 !== 0) {
    changePct = Math.round(((dpr1 - dpr2) / dpr2) * 1000) / 10
  }

  return { itemName, unit, cls, retailPrice: dpr1, dayAgo: dpr2, monthAgo: dpr3, yearAgo: dpr4, direction, changePct }
}

// ── KAMIS fetch ───────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type KamisAttempt =
  | { ok: true; items: PriceItem[] }
  | { ok: false; message: string; retryable: boolean }

async function fetchKamisAttempt(debugSink?: DebugSink): Promise<KamisAttempt> {
  const url = KAMIS_URL()
  console.log('[prices] kamis →', redactKey(url))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal, redirect: 'follow' })
    const bodyText = await res.text()
    if (debugSink?.enabled) {
      recordDebug(debugSink, {
        label: 'kamis',
        url: redactKey(url),
        status: res.status,
        bodySnippet: bodyText.slice(0, 1500),
      })
    }
    if (!res.ok) {
      return {
        ok: false,
        message: `HTTP ${res.status} — ${bodyText.slice(0, BODY_SNIPPET)}`,
        retryable: res.status >= 500,
      }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(bodyText)
    } catch {
      return {
        ok: false,
        message: `JSON parse failed — ${bodyText.slice(0, BODY_SNIPPET)}`,
        retryable: false,
      }
    }
    const obj = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
    // Dump the RAW price items (field names intact, before our filter/normalize)
    // so field-name mismatches (e.g. itemname vs item_name) are visible.
    if (debugSink?.enabled) {
      const rawItems = Array.isArray(obj?.price) ? (obj!.price as Record<string, unknown>[]) : []
      debugSink.entries.push({
        label: 'kamis-raw-items',
        url: redactKey(url),
        status: res.status,
        bodySnippet: JSON.stringify(rawItems.slice(0, 5)).slice(0, 1500),
      })
    }
    const errorCode = obj?.error_code
    if (typeof errorCode === 'string' && errorCode.trim() !== '' && errorCode.trim() !== '000') {
      return { ok: false, message: `error_code ${errorCode}`, retryable: false }
    }
    const filtered = filterKamisJejuItems(parsed)
    const filteredObj = filtered && typeof filtered === 'object' ? (filtered as Record<string, unknown>) : null
    const rows = Array.isArray(filteredObj?.price)
      ? (filteredObj!.price as Record<string, unknown>[])
      : []
    const items = rows.map(toItem).filter((it): it is PriceItem => it !== null)
    console.log(`[prices] kamis rows: ${rows.length} total → ${items.length} items after normalize`)
    return { ok: true, items }
  } catch (e: unknown) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    const msg = aborted ? `timeout (${TIMEOUT_MS}ms)` : e instanceof Error ? e.message : String(e)
    if (debugSink?.enabled) {
      recordDebug(debugSink, { label: 'kamis', url: redactKey(url), status: null, bodySnippet: '', error: msg })
    }
    // Network-level failures (fetch throwing TypeError) are transient too.
    const networkError = e instanceof Error && e.name === 'TypeError'
    return { ok: false, message: msg, retryable: aborted || networkError }
  } finally {
    clearTimeout(timer)
  }
}

/** fetchKamisAttempt + ONE automatic retry (after a short backoff) on transient failures. */
async function fetchKamis(errors: string[], debugSink?: DebugSink): Promise<PriceItem[]> {
  let attempt = await fetchKamisAttempt(debugSink)
  if (!attempt.ok && attempt.retryable) {
    await sleep(RETRY_DELAY_MS)
    attempt = await fetchKamisAttempt(debugSink)
  }
  if (attempt.ok) return attempt.items
  errors.push(`kamis: ${attempt.message}`)
  return []
}

// ── Perplexity enrichment ────────────────────────────────────────────────────

async function fetchContext(errors: string[]): Promise<{ text: string; meta: ContextMeta }> {
  const today = kstTodayIso()
  const retrievedAt = kstNowIso()
  const systemPrompt =
    `오늘은 ${today}입니다. 가장 최신 정보 위주로, 가능하면 오늘·최근 1주일 자료를 우선하라. ` +
    '당신은 제주 생활물가 분석 도우미입니다. 한국어로만, 군더더기 없이 3~4문장으로 답하세요. ' +
    '인용 번호([1][3] 등)를 쓰지 말고, 한자·중문·일문 문장부호(。「」 등)를 쓰지 마세요. ' +
    '장바구니 품목(채소·수산물·육류 등)의 가격 오름세·내림세와 그 이유를 사실 위주로 요약하세요.'
  const prompt =
    `제주 오늘(${today}) 장바구니 물가·생활물가 특이사항을 알려주세요. ` +
    '감귤, 갈치, 채소류 등 도민이 많이 사는 품목 위주로 뭐가 오르고 내렸는지, 이유도 간단히 설명해 주세요.'
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
    if (r.error || !r.text?.trim()) {
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

// ── Fallback JSON schema parsing ──────────────────────────────────────────────

function isValidGroupCategory(v: unknown): v is keyof PriceGroups {
  return v === '농산물' || v === '수산물' || v === '가공축산'
}

/** Strips accidental ```json fences and isolates the outermost {...} block. */
function extractJsonBlock(raw: string): string {
  const fenced = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  const start = fenced.indexOf('{')
  const end = fenced.lastIndexOf('}')
  return start >= 0 && end > start ? fenced.slice(start, end + 1) : fenced
}

/**
 * Primary parser: strict JSON schema
 *   { "items": [ { name, category, priceLow, priceHigh, unit } ] }
 * Returns null (never []) on any structural failure so the caller can fall
 * back to the legacy regex parser as a last resort.
 */
function parseFallbackJson(raw: string): PriceItem[] | null {
  try {
    const parsed = JSON.parse(extractJsonBlock(raw)) as unknown
    const obj = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
    const rawItems = Array.isArray(obj?.items) ? (obj!.items as unknown[]) : null
    if (!rawItems) return null

    const items: PriceItem[] = []
    for (const raw of rawItems) {
      if (!raw || typeof raw !== 'object') continue
      const it = raw as Record<string, unknown>
      const itemName = typeof it.name === 'string' ? it.name.trim() : ''
      if (!itemName) continue
      const priceLow = parsePrice(it.priceLow)
      if (priceLow == null) continue
      const priceHighEstimate = it.priceHigh == null ? null : parsePrice(it.priceHigh)
      const unit = typeof it.unit === 'string' && it.unit.trim() ? it.unit.trim() : 'kg'
      const category = isValidGroupCategory(it.category) ? it.category : undefined

      items.push({
        itemName,
        unit,
        cls: '소매(추정)',
        retailPrice: priceLow,
        dayAgo: null,
        monthAgo: null,
        yearAgo: null,
        direction: null,
        changePct: null,
        category,
        priceHighEstimate,
      })
    }
    return items.length > 0 ? items : null
  } catch {
    return null
  }
}

/**
 * LAST-RESORT legacy parser (pre-JSON-schema): loose "품목: NNN원/kg" line
 * matching. Kept as a fallback for when the model doesn't return valid JSON —
 * never deleted, only demoted to a secondary path.
 */
function parseLegacyFallbackLines(text: string): PriceItem[] {
  const lines = text.split('\n').filter(Boolean)
  const items: PriceItem[] = []
  for (const line of lines) {
    const priceMatch = line.match(/([\d,]+)\s*원/)
    const price = priceMatch ? parsePrice(priceMatch[1]) : null
    if (!price) continue
    const itemMatch = line.match(/([가-힣·A-Za-z ]+?)[:：]/)
    const itemName = itemMatch ? itemMatch[1].trim() : line.slice(0, 20)
    const unitMatch = line.match(/\/([가-힣A-Za-z]+)/)
    const unit = unitMatch ? unitMatch[1] : 'kg'
    items.push({
      itemName, unit, cls: '소매(추정)',
      retailPrice: price, dayAgo: null, monthAgo: null, yearAgo: null,
      direction: null, changePct: null,
    })
  }
  return items
}

async function fetchPriceFallback(errors: string[], debugSink?: DebugSink): Promise<PriceItem[]> {
  const today = kstTodayIso()
  const systemPrompt =
    `오늘은 ${today}입니다 (KST). 가장 최신 정보 위주로 답하라. ` +
    '당신은 제주 생활물가 조사원입니다. 반드시 순수 JSON 객체 하나만 응답하세요 — ' +
    '설명, 서론, 마크다운 문장, ```json 코드블록 없이 JSON만 출력하세요. ' +
    '스키마: {"items":[{"name":string,"category":"농산물"|"수산물"|"가공축산","priceLow":number,"priceHigh":number|null,"unit":string}]}. ' +
    '규칙: (1) 제주 지역 소매가 기준으로 답하세요. ' +
    '(2) name은 순수 품목명만 적으세요 — 단위·규격·괄호설명을 넣지 마세요 (예: "갈치"는 되지만 "갈치(1kg, 냉장)"은 안 됩니다). ' +
    '(3) category는 반드시 농산물/수산물/가공축산 중 하나로 정확히 분류하세요. ' +
    '(4) 가격은 원 단위 정수만 쓰세요. 가격이 범위로 알려져 있으면 priceLow와 priceHigh를 모두 채우고, ' +
    '단일 가격만 알면 priceHigh는 null로 두세요. ' +
    '(5) 최소 6개 이상의 품목을 포함하고, 농산물·수산물·가공축산 세 카테고리에 각각 최소 1개 이상 포함하세요. ' +
    '(6) JSON은 들여쓰기나 줄바꿈, 불필요한 공백 없이 한 줄로 압축해서 출력하세요 (토큰 절약 목적).'
  const prompt =
    `제주 또는 전국 시장 기준 ${today} 주요 식품 소매 시세를 위 JSON 스키마로만 응답하세요. ` +
    '갈치, 고등어, 감귤, 양배추, 당근, 무, 계란, 돼지고기 등 도민이 자주 사는 품목 위주로, ' +
    '농산물·수산물·가공축산 세 카테고리에 각각 최소 1개 이상 포함해 주세요.'
  try {
    const r = await runSingleAiProvider({
      supabase: noDbSupabase(),
      sessionId: null,
      userId: null,
      provider: PERPLEXITY_PROVIDER,
      prompt,
      systemPrompt,
      maxCompletionTokens: FALLBACK_MAX_TOKENS,
      timeoutMs: TIMEOUT_MS,
      skipLanguageInjection: true,
    })
    if (debugSink?.enabled) {
      recordDebug(debugSink, {
        label: 'perplexity-fallback-raw',
        url: 'perplexity://price-fallback (runSingleAiProvider)',
        status: r.error ? null : 200,
        bodySnippet: (r.text ?? '').slice(0, 2000),
        ...(r.error ? { error: r.error } : {}),
      })
    }
    if (r.error || !r.text?.trim()) {
      errors.push(`fallback: ${r.error || 'empty'}`)
      return []
    }
    const rawText = r.text

    // PRIMARY: strict JSON schema (also carries explicit category + range).
    const jsonItems = parseFallbackJson(rawText)
    let items: PriceItem[]
    let parsedVia: 'json' | 'legacy-regex'
    if (jsonItems) {
      items = jsonItems
      parsedVia = 'json'
    } else {
      // LAST RESORT: legacy markdown/regex line parser — kept for resilience
      // against a model that ignores the JSON-only instruction.
      errors.push('fallback: JSON parse failed — used legacy regex parser')
      items = parseLegacyFallbackLines(cleanPerplexityText(rawText))
      parsedVia = 'legacy-regex'
    }

    if (debugSink?.enabled) {
      recordDebug(debugSink, {
        label: 'perplexity-fallback-parsed-items',
        url: `perplexity://price-fallback (parsed:${parsedVia})`,
        status: 200,
        bodySnippet: JSON.stringify(items).slice(0, 4000),
      })
    }
    return items
  } catch (e: unknown) {
    if (debugSink?.enabled) {
      recordDebug(debugSink, {
        label: 'perplexity-fallback-raw',
        url: 'perplexity://price-fallback (runSingleAiProvider)',
        status: null,
        bodySnippet: '',
        error: e instanceof Error ? e.message : String(e),
      })
    }
    errors.push(`fallback: ${e instanceof Error ? e.message : String(e)}`)
    return []
  }
}

// ── Group items ───────────────────────────────────────────────────────────────

function groupItems(items: PriceItem[]): PriceGroups {
  const groups: PriceGroups = { 농산물: [], 수산물: [], 가공축산: [] }
  for (const it of items) {
    // KAMIS items carry no `category` — unchanged keyword-based classification.
    // Perplexity-JSON fallback items carry an explicit `category` from the
    // model, which we trust over keyword matching (fixes 가공축산 dropping).
    const cat = it.category ?? classifyItem(it.itemName)
    groups[cat].push(it)
  }
  return groups
}

// ── Public entry ──────────────────────────────────────────────────────────────

/**
 * Fetch Jeju daily prices from KAMIS with mandatory Perplexity enrichment.
 * Never throws; sections degrade to [] with errors[] entries.
 *
 * `forceFallback` (diagnostic-only, gated by the caller behind ?debug=1) skips
 * the KAMIS call entirely and goes straight to the Perplexity fallback, so we
 * can capture the raw text the fallback parser chokes on. Never true unless a
 * caller explicitly opts in — normal behavior (KAMIS first) is unaffected.
 */
export async function getPrices(debugSink?: DebugSink, forceFallback = false): Promise<PricesResult> {
  const errors: string[] = []
  const today = kstTodayIso()

  // Run KAMIS and context enrichment in parallel (skip KAMIS when force-fallback).
  const [kamisSettled, contextSettled] = await Promise.allSettled([
    forceFallback ? Promise.resolve<PriceItem[]>([]) : fetchKamis(errors, debugSink),
    fetchContext(errors),
  ])

  let items: PriceItem[] = []
  let source: 'kamis' | 'perplexity' = 'kamis'
  let confidence: 'high' | 'low' = 'high'

  if (kamisSettled.status === 'fulfilled') {
    items = kamisSettled.value
  } else {
    errors.push(`kamis(settled): ${kamisSettled.reason instanceof Error ? kamisSettled.reason.message : String(kamisSettled.reason)}`)
  }

  let contextText = ''
  let contextMeta: ContextMeta = { source: '검색', retrievedAt: kstNowIso(), asOf: null }

  if (contextSettled.status === 'fulfilled') {
    contextText = contextSettled.value.text
    contextMeta = contextSettled.value.meta
  } else {
    errors.push(`context(settled): ${contextSettled.reason instanceof Error ? contextSettled.reason.message : String(contextSettled.reason)}`)
  }

  // FALLBACK: if KAMIS returned nothing (or was force-skipped), try Perplexity for prices.
  if (items.length === 0) {
    console.log(
      forceFallback
        ? '[prices] forceFallback=1 — skipping KAMIS, using Perplexity fallback'
        : '[prices] KAMIS empty — using Perplexity fallback',
    )
    const fallbackItems = await fetchPriceFallback(errors, debugSink)
    items = fallbackItems
    source = 'perplexity'
    confidence = 'low'
  }

  return {
    ok: true,
    source,
    confidence,
    updated: today,
    groups: groupItems(items),
    context: contextText,
    contextMeta,
    freshnessNote: FRESHNESS_NOTE,
    updatedAt: new Date().toISOString(),
    errors,
  }
}
