import 'server-only'

/**
 * KRSTOCK ranked-round builder: KRX calendar resolves_at, official/TD/unavailable
 * anchor, Korean name from the visible universe row.
 */

import { cacheBucketFor, computeResolvesAt, type UiHorizon } from './horizon'
import { decodeKrStockInstrument, type KrMarket } from './korea-equity-catalog'
import { krStockPropositionEn, type KrStockAnchorSource } from './korea-stock-display'
import {
  getOfficialClose,
  type OfficialCloseResult,
} from './korea-market-data'
import { getVisibleUniverseRow } from './korea-universe-store'
import { fetchTwelveDataSessionClose } from './market-data'
import { krxSessionCloseIso, lastCompletedKrxSession } from './krx-calendar'
import type { CatalogRankedRoundInput } from './catalog'

export type KrStockRoundIo = {
  now: () => Date
  getVisibleRow: (market: KrMarket, code: string) => Promise<{ name: string } | null>
  getOfficialClose: (market: KrMarket, code: string, date: string) => Promise<OfficialCloseResult>
  getTwelveDataClose: (code: string, sessionDate: string) => Promise<number | null>
}

export type KrStockRankedRound =
  CatalogRankedRoundInput & {
    subject_label: string
    anchor_price: number
    anchor_price_at: string
    anchor_session_date: string
    anchor_source: Exclude<KrStockAnchorSource, 'krx_official_verified'>
  }

export type KrStockRoundBuildResult =
  | { ok: true; input: KrStockRankedRound }
  | { ok: false; reason: 'unknown_instrument' | 'krx_calendar_unverified' | 'anchor_unavailable' }

function liveIo(): KrStockRoundIo {
  return {
    now: () => new Date(),
    getVisibleRow: async (market, code) => {
      const row = await getVisibleUniverseRow(market, code)
      if (!row?.name.trim()) return null
      return { name: row.name.trim() }
    },
    getOfficialClose: (market, code, date) => getOfficialClose(market, code, date),
    getTwelveDataClose: (code, sessionDate) => fetchTwelveDataSessionClose(code, 'KRX', sessionDate),
  }
}

export async function resolveKrStockAnchor(
  market: KrMarket,
  code: string,
  anchorDate: string,
  io: KrStockRoundIo,
): Promise<
  | { ok: true; price: number; source: 'krx_official' | 'twelvedata' }
  | { ok: false; reason: 'anchor_unavailable' }
> {
  const official = await io.getOfficialClose(market, code, anchorDate)
  if (typeof official === 'number' && Number.isFinite(official) && official > 0) {
    return { ok: true, price: official, source: 'krx_official' }
  }
  const td = await io.getTwelveDataClose(code, anchorDate)
  if (typeof td === 'number' && Number.isFinite(td) && td > 0) {
    return { ok: true, price: td, source: 'twelvedata' }
  }
  return { ok: false, reason: 'anchor_unavailable' }
}

export async function buildKrStockRankedRoundInput(
  instrument: string,
  uiHorizon: UiHorizon,
  now: Date = new Date(),
  io?: Partial<KrStockRoundIo>,
): Promise<KrStockRoundBuildResult> {
  const parts = decodeKrStockInstrument(instrument)
  if (!parts) return { ok: false, reason: 'unknown_instrument' }

  const deps: KrStockRoundIo = { ...liveIo(), ...io, now: io?.now ?? (() => now) }
  const row = await deps.getVisibleRow(parts.market, parts.code)
  if (!row) return { ok: false, reason: 'unknown_instrument' }

  const computed = computeResolvesAt('stock', uiHorizon, now.toISOString(), instrument)
  if (!computed.ok) return { ok: false, reason: computed.reason }

  const last = lastCompletedKrxSession(now)
  if (!last.ok) return { ok: false, reason: last.reason }

  const anchor = await resolveKrStockAnchor(parts.market, parts.code, last.date, deps)
  if (!anchor.ok) return { ok: false, reason: 'anchor_unavailable' }

  const resolvesAt = computed.resolvesAt
  const resolveDate = resolvesAt.slice(0, 10)
  const name = row.name.replace(/[\r\n]/g, ' ').trim().slice(0, 80) || parts.code
  const bucket = cacheBucketFor(uiHorizon, now)
  const proposition_text = krStockPropositionEn({
    name,
    code: parts.code,
    resolveDate,
    anchorDate: last.date,
  })

  return {
    ok: true,
    input: {
      proposition_text,
      category: 'stock',
      instrument,
      horizon: uiHorizon,
      resolution_rule: `KRX ${parts.market} regular-session close (15:30 KST). Identity: ${name}.`,
      resolves_at: resolvesAt,
      item_type: 'ranked',
      cache_key: `daily|${instrument}|${uiHorizon}|${bucket}`,
      subject_label: name,
      anchor_price: anchor.price,
      anchor_price_at: krxSessionCloseIso(last.date),
      anchor_session_date: last.date,
      anchor_source: anchor.source,
    },
  }
}
