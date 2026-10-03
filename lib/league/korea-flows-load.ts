import 'server-only'

/**
 * Batched reads for KR flow signals. One select per table for this stock's
 * date range (not a per-day loop). Same-market percentiles page a single
 * filtered select per table because PostgREST caps a response at 1000 rows.
 * This module never calls KRX.
 */

import { supabaseAdmin } from '@/lib/supabase/server'
import {
  computeKrFlowSignals,
  krFlowBasisPoints,
  krFlowSampleZ,
  type KrFlowForeignPoint,
  type KrFlowNetRow,
  type KrFlowShortPoint,
  type KrFlowSignals,
} from './korea-flows-signals'
import type { KrxFlowInvestor, KrxFlowMarket } from './korea-flows-data'
import { lastNKrxSessionDates, previousKrxSessionDate } from './krx-calendar'

const PAGE = 1000
const STOCK_LIMIT = 2000

type SbQuery = {
  eq(column: string, value: string): SbQuery
  gte(column: string, value: string): SbQuery
  lte(column: string, value: string): SbQuery
  in(column: string, values: readonly string[]): SbQuery
  limit(n: number): Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>
  range(from: number, to: number): Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>
}

function table(name: string, columns: string): SbQuery {
  return supabaseAdmin.from(name).select(columns) as unknown as SbQuery
}

async function selectStock(name: string, columns: string, apply: (query: SbQuery) => SbQuery): Promise<Record<string, unknown>[]> {
  const { data, error } = await apply(table(name, columns)).limit(STOCK_LIMIT)
  if (error) throw new Error('krx flows read failed')
  return data ?? []
}

/** One filtered select, continued by row offset. Not one query per session. */
async function selectPaged(
  name: string,
  columns: string,
  apply: (query: SbQuery) => SbQuery,
): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await apply(table(name, columns)).range(from, from + PAGE - 1)
    if (error) throw new Error('krx flows peer read failed')
    const rows = data ?? []
    all.push(...rows)
    if (rows.length < PAGE) break
  }
  return all
}

function num(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function day(value: unknown): string {
  return String(value).slice(0, 10)
}

const INVESTORS = new Set<string>(['foreign', 'institution', 'individual', 'pension', 'financial_investment'])

function flowRows(raw: readonly Record<string, unknown>[]): KrFlowNetRow[] {
  const out: KrFlowNetRow[] = []
  for (const row of raw) {
    const investor = String(row.investor ?? '')
    if (!INVESTORS.has(investor)) continue
    out.push({
      date: day(row.bas_dd),
      market: String(row.market ?? ''),
      code: String(row.code ?? ''),
      investor,
      netValue: num(row.net_value),
    })
  }
  return out
}

function shortRows(raw: readonly Record<string, unknown>[]): KrFlowShortPoint[] {
  return raw.map((row) => ({
    date: day(row.bas_dd),
    market: String(row.market ?? ''),
    code: String(row.code ?? ''),
    shortRatio: num(row.short_ratio),
    balanceRatio: num(row.balance_ratio),
  }))
}

function foreignRows(raw: readonly Record<string, unknown>[]): KrFlowForeignPoint[] {
  return raw.map((row) => ({
    date: day(row.bas_dd),
    market: String(row.market ?? ''),
    code: String(row.code ?? ''),
    foreignHoldingRatio: num(row.foreign_holding_ratio),
  }))
}

function absBpByCode(
  rows: readonly Record<string, unknown>[],
  investor: KrxFlowInvestor,
  dates: ReadonlySet<string>,
  mktcapByCode: ReadonlyMap<string, number>,
): number[] {
  const sums = new Map<string, number>()
  for (const row of rows) {
    if (String(row.investor ?? '') !== investor) continue
    const date = day(row.bas_dd)
    if (!dates.has(date)) continue
    const net = num(row.net_value)
    if (net == null) continue
    const code = String(row.code ?? '')
    sums.set(code, (sums.get(code) ?? 0) + net)
  }
  const out: number[] = []
  for (const [code, net] of sums) {
    const mktcap = mktcapByCode.get(code)
    if (mktcap == null) continue
    const bp = krFlowBasisPoints(net, mktcap)
    if (bp == null) continue
    out.push(Math.abs(bp))
  }
  return out
}

function shortZByCode(rows: readonly Record<string, unknown>[], sessions20: readonly string[]): number[] {
  const byCode = new Map<string, Map<string, number>>()
  for (const row of rows) {
    const ratio = num(row.short_ratio)
    if (ratio == null) continue
    const code = String(row.code ?? '')
    let dates = byCode.get(code)
    if (!dates) {
      dates = new Map()
      byCode.set(code, dates)
    }
    dates.set(day(row.bas_dd), ratio)
  }
  const asOf = sessions20[sessions20.length - 1]
  const out: number[] = []
  for (const dates of byCode.values()) {
    if (asOf == null || !dates.has(asOf)) continue
    const values: number[] = []
    for (const date of sessions20) {
      const value = dates.get(date)
      if (value != null) values.push(value)
    }
    const z = krFlowSampleZ(values)
    if (z != null) out.push(z)
  }
  return out
}

export async function loadKrFlowSignals(args: {
  market: KrxFlowMarket
  code: string
  asOf: string
}): Promise<KrFlowSignals> {
  const start = previousKrxSessionDate(previousKrxSessionDate(args.asOf, 2), 20)
  const stock = (query: SbQuery) =>
    query.eq('market', args.market).eq('code', args.code).gte('bas_dd', start).lte('bas_dd', args.asOf)
  const [flowRaw, shortRaw, foreignRaw, dailyRaw] = await Promise.all([
    selectStock('league_krx_flows', 'bas_dd,market,code,investor,net_value', stock),
    selectStock(
      'league_krx_short',
      'bas_dd,market,code,short_ratio,balance_ratio',
      stock,
    ),
    selectStock('league_krx_foreign_own', 'bas_dd,market,code,foreign_holding_ratio', stock),
    selectStock('league_krx_daily', 'bas_dd,close,mktcap', stock),
  ])
  const flows = flowRows(flowRaw)
  const fresh = flows.some((row) => row.date === args.asOf)
  const sessions5 = lastNKrxSessionDates(args.asOf, 5)
  const sessions20 = lastNKrxSessionDates(args.asOf, 20)
  let foreign5dAbsBp: number[] = []
  let institution5dAbsBp: number[] = []
  let shortZ: number[] = []
  if (fresh) {
    const [peerFlows, peerDaily, peerShorts] = await Promise.all([
      selectPaged('league_krx_flows', 'code,investor,bas_dd,net_value', (query) =>
        query.eq('market', args.market).in('investor', ['foreign', 'institution']).in('bas_dd', sessions5),
      ),
      selectPaged('league_krx_daily', 'code,mktcap', (query) =>
        query.eq('market', args.market).eq('bas_dd', args.asOf),
      ),
      selectPaged('league_krx_short', 'code,bas_dd,short_ratio', (query) =>
        query.eq('market', args.market).in('bas_dd', sessions20),
      ),
    ])
    const mktcapByCode = new Map<string, number>()
    for (const row of peerDaily) {
      const mktcap = num(row.mktcap)
      if (mktcap == null) continue
      mktcapByCode.set(String(row.code ?? ''), mktcap)
    }
    const dateSet = new Set(sessions5)
    foreign5dAbsBp = absBpByCode(peerFlows, 'foreign', dateSet, mktcapByCode)
    institution5dAbsBp = absBpByCode(peerFlows, 'institution', dateSet, mktcapByCode)
    shortZ = shortZByCode(peerShorts, sessions20)
  }
  return computeKrFlowSignals({
    market: args.market,
    code: args.code,
    asOf: args.asOf,
    flows,
    shorts: shortRows(shortRaw),
    foreign: foreignRows(foreignRaw),
    daily: dailyRaw.map((row) => ({
      date: day(row.bas_dd),
      close: num(row.close),
      mktcap: num(row.mktcap),
    })),
    peers: { foreign5dAbsBp, institution5dAbsBp, shortZ },
  })
}
