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
const FALLBACK_MAX_TOKENS = 380
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

async function fetchKamisAttempt(): Promise<KamisAttempt> {
  const url = KAMIS_URL()
  console.log('[prices] kamis →', redactKey(url))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal, redirect: 'follow' })
    const bodyText = await res.text()
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
    // Network-level failures (fetch throwing TypeError) are transient too.
    const networkError = e instanceof Error && e.name === 'TypeError'
    return { ok: false, message: msg, retryable: aborted || networkError }
  } finally {
    clearTimeout(timer)
  }
}

/** fetchKamisAttempt + ONE automatic retry (after a short backoff) on transient failures. */
async function fetchKamis(errors: string[]): Promise<PriceItem[]> {
  let attempt = await fetchKamisAttempt()
  if (!attempt.ok && attempt.retryable) {
    await sleep(RETRY_DELAY_MS)
    attempt = await fetchKamisAttempt()
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

async function fetchPriceFallback(errors: string[]): Promise<PriceItem[]> {
  const today = kstTodayIso()
  const retrievedAt = kstNowIso()
  const systemPrompt =
    `오늘은 ${today}입니다. 가장 최신 정보 위주로 답하라. ` +
    '당신은 제주 생활물가 조사원입니다. 한국어로만 답하세요. 인용 번호([1][3] 등)를 쓰지 마세요. ' +
    '제주 또는 전국 기준 최근 주요 품목(갈치, 감귤, 양배추, 당근, 무, 고등어, 계란 등)의 ' +
    'kg 또는 단위당 대략적인 소매 시세를 한 줄씩 나열하세요. 모르는 품목은 생략하세요.'
  const prompt = `제주 또는 전국 시장 기준 ${today} 주요 식품 소매 시세를 알려주세요.`
  const ret: ContextMeta = { source: '검색', retrievedAt, asOf: null }
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
    if (r.error || !r.text?.trim()) {
      errors.push(`fallback: ${r.error || 'empty'}`)
      return []
    }
    const text = cleanPerplexityText(r.text)
    ret.asOf = extractAsOf(text)
    // Parse loose "품목: NNN원/kg" lines into PriceItem stubs
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
  } catch (e: unknown) {
    errors.push(`fallback: ${e instanceof Error ? e.message : String(e)}`)
    return []
  }
}

// ── Group items ───────────────────────────────────────────────────────────────

function groupItems(items: PriceItem[]): PriceGroups {
  const groups: PriceGroups = { 농산물: [], 수산물: [], 가공축산: [] }
  for (const it of items) {
    groups[classifyItem(it.itemName)].push(it)
  }
  return groups
}

// ── Public entry ──────────────────────────────────────────────────────────────

/**
 * Fetch Jeju daily prices from KAMIS with mandatory Perplexity enrichment.
 * Never throws; sections degrade to [] with errors[] entries.
 */
export async function getPrices(): Promise<PricesResult> {
  const errors: string[] = []
  const today = kstTodayIso()

  // Run KAMIS and context enrichment in parallel.
  const [kamisSettled, contextSettled] = await Promise.allSettled([
    fetchKamis(errors),
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

  // FALLBACK: if KAMIS returned nothing, try Perplexity for prices.
  if (items.length === 0) {
    console.log('[prices] KAMIS empty — using Perplexity fallback')
    const fallbackItems = await fetchPriceFallback(errors)
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
