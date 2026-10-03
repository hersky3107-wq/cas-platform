/**
 * Map official KRX daily bars onto the shared price-series packet shape
 * so KRSTOCK reuses STOCK technicals without forking the calculators.
 */

import { decodeKrStockInstrument } from './korea-equity-catalog'

export const KRSTOCK_PACKET_SERIES_SOURCE = 'KRX league_krx_daily TDD_CLSPRC (정규장 종가)'

export type KrxPacketBar = {
  date: string
  close: number
  volume?: number | null
}

export function krxBarsToDataPacket(instrument: string, bars: readonly KrxPacketBar[]) {
  const series = bars
    .filter((b) => Number.isFinite(b.close) && b.close > 0 && /^\d{4}-\d{2}-\d{2}$/.test(b.date))
    .map((b) => ({
      date: b.date,
      close: b.close,
      ...(typeof b.volume === 'number' && Number.isFinite(b.volume) ? { volume: b.volume } : {}),
    }))
  const last = series[series.length - 1]
  const prev = series.length >= 2 ? series[series.length - 2] : undefined
  const parts = decodeKrStockInstrument(instrument)
  if (!last) {
    return { available: false as const, instrument, error: 'krx_series_empty' }
  }
  return {
    available: true as const,
    instrument,
    symbol: parts?.code,
    exchange: 'KRX',
    currency: 'KRW',
    asOf: last.date,
    latestClose: last.close,
    previousClose: prev?.close,
    series,
    seriesSource: KRSTOCK_PACKET_SERIES_SOURCE,
  }
}
