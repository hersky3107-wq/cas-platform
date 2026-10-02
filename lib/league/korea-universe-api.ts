/**
 * Pure helpers for GET /api/league/kr-universe.
 * No flags, trading values, or market caps in the client payload.
 */
import { encodeKrStockInstrument, type KrGroupId, type UniverseMarket } from './korea-equity-catalog'
import { encodeStockInstrument } from './gateway/adapters/stock-catalog'
import { admissionStockLane } from './stock-lane'
import type { JurisdictionInput } from './jurisdiction/resolve'
import type { UniverseRecord } from './korea-universe-apply'

export type KrUniverseClientRow = {
  market: UniverseMarket
  code: string
  name: string
  groupId: KrGroupId | null
  popularityRank: number | null
  instrument: string
}

export function parseUniverseMarketParam(raw: string | null | undefined): UniverseMarket | null {
  const v = raw?.trim().toUpperCase()
  if (v === 'KOSPI' || v === 'KOSDAQ' || v === 'US') return v
  return null
}

export function canReadKrUniverseApi(viewer: { isAdmin: boolean; jurisdiction: JurisdictionInput }): boolean {
  return viewer.isAdmin || admissionStockLane(viewer.jurisdiction) === 'korea'
}

export function instrumentForUniverseRow(row: Pick<UniverseRecord, 'market' | 'code' | 'exchange'>): string | null {
  if (row.market === 'KOSPI' || row.market === 'KOSDAQ') {
    return encodeKrStockInstrument(row.market, row.code)
  }
  if (!row.exchange) return null
  return encodeStockInstrument({ exchange: row.exchange, symbol: row.code })
}

export function toKrUniverseClientRow(row: UniverseRecord): KrUniverseClientRow | null {
  const instrument = instrumentForUniverseRow(row)
  if (!instrument) return null
  return {
    market: row.market,
    code: row.code,
    name: row.name,
    groupId: row.groupId,
    popularityRank: row.popularityRank,
    instrument,
  }
}
