import 'server-only'

/**
 * OpenDART disclosures + fundamentals for the shared KRSTOCK packet.
 * Reads league_dart_corp / league_dart_cache. Never fetches when the cache
 * is fresh. Never logs the API key or a URL that contains it.
 */

import { supabaseAdmin } from '@/lib/supabase/server'
import {
  dartStatusKind,
  dartYmdWindow,
  deriveFundamentals,
  emptyFundamentals,
  formatKrDartPacket,
  fundamentalsActionAfterProbe,
  isDisclosurePayload,
  isFundamentalsPayload,
  listFilingsFromBody,
  newestPeriodicRceptNo,
  packetAfterDisclosureFetch,
  parseFnlttAccounts,
  planDartFetches,
  selectFinancialReports,
  type DisclosurePayload,
  type FundamentalsPayload,
} from './korea-dart-model'

const CORP_TABLE = 'league_dart_corp'
const CACHE_TABLE = 'league_dart_cache'
const DISCLOSURE_PERIOD = '30d'
const FUNDAMENTALS_PERIOD = 'latest'
const DART_API = 'https://opendart.fss.or.kr/api'

type Blocks = {
  disclosures: DisclosurePayload | 'unavailable'
  fundamentals: FundamentalsPayload | 'unavailable'
}

const inflight = new Map<string, Promise<Blocks>>()

function readKey(): string | null {
  const key = process.env.OPENDART_API_KEY?.trim()
  return key || null
}

async function dartGet(path: string, params: Record<string, string>): Promise<unknown | null> {
  const key = readKey()
  if (!key) return null
  const url = new URL(`${DART_API}/${path}`)
  url.searchParams.set('crtfc_key', key)
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value)
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

async function readCorpCode(stockCode: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from(CORP_TABLE)
    .select('corp_code')
    .eq('stock_code', stockCode)
    .maybeSingle()
  if (error || !data) return null
  const code = (data as { corp_code?: unknown }).corp_code
  return typeof code === 'string' && code.trim() ? code.trim() : null
}

async function readCache(
  corpCode: string,
  kind: 'disclosures' | 'fundamentals',
  period: string,
): Promise<{ payload: unknown; fetchedAt: string } | null> {
  const { data, error } = await supabaseAdmin
    .from(CACHE_TABLE)
    .select('payload, fetched_at')
    .eq('corp_code', corpCode)
    .eq('kind', kind)
    .eq('period', period)
    .maybeSingle()
  if (error || !data) return null
  const row = data as { payload?: unknown; fetched_at?: unknown }
  if (typeof row.fetched_at !== 'string') return null
  return { payload: row.payload, fetchedAt: row.fetched_at }
}

async function writeCache(
  corpCode: string,
  kind: 'disclosures' | 'fundamentals',
  period: string,
  payload: DisclosurePayload | FundamentalsPayload,
  now: Date,
): Promise<void> {
  const { error } = await supabaseAdmin.from(CACHE_TABLE).upsert({
    corp_code: corpCode,
    kind,
    period,
    payload,
    fetched_at: now.toISOString(),
  })
  if (error) {
    console.error(`[league/dart] cache write failed kind=${kind}`)
  }
}

async function touchCache(corpCode: string, now: Date): Promise<void> {
  const { error } = await supabaseAdmin
    .from(CACHE_TABLE)
    .update({ fetched_at: now.toISOString() })
    .eq('corp_code', corpCode)
    .eq('kind', 'fundamentals')
    .eq('period', FUNDAMENTALS_PERIOD)
  if (error) console.error('[league/dart] fundamentals touch failed')
}

async function fetchDisclosurePages(corpCode: string, now: Date): Promise<unknown | null> {
  const window = dartYmdWindow(now, 30)
  const first = await dartGet('list.json', {
    corp_code: corpCode,
    bgn_de: window.bgnDe,
    end_de: window.endDe,
    page_no: '1',
    page_count: '100',
  })
  if (first == null || dartStatusKind(first) === 'fail') return first
  if (dartStatusKind(first) !== 'ok' || !first || typeof first !== 'object') return first
  const totalPage = Number((first as { total_page?: unknown }).total_page ?? 1)
  if (!Number.isFinite(totalPage) || totalPage <= 1) return first
  const merged = [...(((first as { list?: unknown[] }).list as unknown[]) ?? [])]
  for (let page = 2; page <= Math.min(totalPage, 3); page++) {
    const next = await dartGet('list.json', {
      corp_code: corpCode,
      bgn_de: window.bgnDe,
      end_de: window.endDe,
      page_no: String(page),
      page_count: '100',
    })
    if (next == null || dartStatusKind(next) === 'fail') return null
    if (dartStatusKind(next) === 'ok' && next && typeof next === 'object' && Array.isArray((next as { list?: unknown }).list)) {
      merged.push(...((next as { list: unknown[] }).list))
    }
  }
  return { ...(first as object), list: merged, status: '000' }
}

async function fetchPeriodicList(corpCode: string, now: Date): Promise<unknown | null> {
  const window = dartYmdWindow(now, 500)
  return dartGet('list.json', {
    corp_code: corpCode,
    bgn_de: window.bgnDe,
    end_de: window.endDe,
    page_no: '1',
    page_count: '100',
    pblntf_ty: 'A',
  })
}

async function fetchFundamentals(corpCode: string, now: Date): Promise<FundamentalsPayload | 'unavailable' | 'empty'> {
  const listBody = await fetchPeriodicList(corpCode, now)
  if (listBody == null || dartStatusKind(listBody) === 'fail') return 'unavailable'
  if (dartStatusKind(listBody) === 'empty') return 'empty'
  const filings = listFilingsFromBody(listBody)
  const selected = selectFinancialReports(filings)
  if (!selected.length) return 'empty'
  const accounts = []
  let anyOk = false
  let anyFail = false
  for (const report of selected) {
    const body = await dartGet('fnlttSinglAcnt.json', {
      corp_code: corpCode,
      bsns_year: report.bsnsYear,
      reprt_code: report.reprtCode,
    })
    const kind = dartStatusKind(body)
    if (kind === 'fail' || body == null) {
      anyFail = true
      continue
    }
    if (kind === 'empty') continue
    anyOk = true
    accounts.push(...parseFnlttAccounts(body))
  }
  if (!anyOk) return anyFail ? 'unavailable' : 'empty'
  const derived = deriveFundamentals(accounts)
  const newest = newestPeriodicRceptNo(filings)
  return { ...derived, newestRceptNo: newest ?? derived.newestRceptNo }
}

async function loadBlocks(stockCode: string, now: Date): Promise<Blocks> {
  const corpCode = await readCorpCode(stockCode)
  if (!corpCode || !readKey()) {
    return { disclosures: 'unavailable', fundamentals: 'unavailable' }
  }

  const [disclosureRow, fundamentalsRow] = await Promise.all([
    readCache(corpCode, 'disclosures', DISCLOSURE_PERIOD),
    readCache(corpCode, 'fundamentals', FUNDAMENTALS_PERIOD),
  ])
  const cachedDisclosures = disclosureRow && isDisclosurePayload(disclosureRow.payload) ? disclosureRow.payload : null
  const cachedFundamentals =
    fundamentalsRow && isFundamentalsPayload(fundamentalsRow.payload) ? fundamentalsRow.payload : null
  const plan = planDartFetches({
    now,
    disclosuresFetchedAt: cachedDisclosures ? disclosureRow!.fetchedAt : null,
    fundamentalsFetchedAt: cachedFundamentals ? fundamentalsRow!.fetchedAt : null,
    fundamentalsHavePayload: cachedFundamentals != null,
  })

  let disclosures: DisclosurePayload | 'unavailable'
  if (plan.disclosures === 'use_cache' && cachedDisclosures) {
    disclosures = cachedDisclosures
  } else {
    const body = await fetchDisclosurePages(corpCode, now)
    const kind = body == null ? 'fail' : dartStatusKind(body)
    disclosures = packetAfterDisclosureFetch({
      cacheFresh: false,
      cached: cachedDisclosures,
      fetchBody: body,
    })
    if (kind !== 'fail' && disclosures !== 'unavailable') {
      await writeCache(corpCode, 'disclosures', DISCLOSURE_PERIOD, disclosures, now)
    }
  }

  let fundamentals: FundamentalsPayload | 'unavailable'
  if (plan.fundamentals === 'use_cache' && cachedFundamentals) {
    fundamentals = cachedFundamentals
  } else if (plan.fundamentals === 'probe' && cachedFundamentals) {
    const listBody = await fetchPeriodicList(corpCode, now)
    const probe =
      listBody == null || dartStatusKind(listBody) === 'fail'
        ? ('fail' as const)
        : dartStatusKind(listBody) === 'empty'
          ? ('empty' as const)
          : { newestRceptNo: newestPeriodicRceptNo(listFilingsFromBody(listBody)) }
    const action = fundamentalsActionAfterProbe({
      cachedNewestRceptNo: cachedFundamentals.newestRceptNo,
      probe,
    })
    if (action === 'keep') {
      fundamentals = cachedFundamentals
      if (probe !== 'fail') await touchCache(corpCode, now)
    } else if (action === 'empty') {
      fundamentals = emptyFundamentals()
      await writeCache(corpCode, 'fundamentals', FUNDAMENTALS_PERIOD, fundamentals, now)
    } else if (action === 'unavailable') {
      fundamentals = 'unavailable'
    } else {
      const fetched = await fetchFundamentals(corpCode, now)
      if (fetched === 'unavailable') fundamentals = cachedFundamentals
      else if (fetched === 'empty') {
        fundamentals = emptyFundamentals()
        await writeCache(corpCode, 'fundamentals', FUNDAMENTALS_PERIOD, fundamentals, now)
      } else {
        fundamentals = fetched
        await writeCache(corpCode, 'fundamentals', FUNDAMENTALS_PERIOD, fundamentals, now)
      }
    }
  } else {
    const fetched = await fetchFundamentals(corpCode, now)
    if (fetched === 'unavailable') fundamentals = 'unavailable'
    else if (fetched === 'empty') {
      fundamentals = emptyFundamentals()
      await writeCache(corpCode, 'fundamentals', FUNDAMENTALS_PERIOD, fundamentals, now)
    } else {
      fundamentals = fetched
      await writeCache(corpCode, 'fundamentals', FUNDAMENTALS_PERIOD, fundamentals, now)
    }
  }

  return { disclosures, fundamentals }
}

export async function loadKrDartPacketSection(args: { stockCode: string; horizon: string; now?: Date }): Promise<string> {
  const now = args.now ?? new Date()
  const key = args.stockCode
  const pending = inflight.get(key)
  const blocks = pending ?? loadBlocks(args.stockCode, now)
  if (!pending) {
    inflight.set(key, blocks)
    blocks.finally(() => inflight.delete(key)).catch(() => inflight.delete(key))
  }
  try {
    const resolved = await blocks
    return formatKrDartPacket({ horizon: args.horizon, ...resolved })
  } catch {
    return formatKrDartPacket({ horizon: args.horizon, disclosures: 'unavailable', fundamentals: 'unavailable' })
  }
}
